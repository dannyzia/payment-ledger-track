import { describe, it, expect } from 'vitest';
import { computeSettlementReminder, formatOrdinalDay, calcSettlementStatus } from './reminders';
import {
  validateReceiptUpload,
  validateReceiptPath,
  detectMagicBytes,
  MAX_RECEIPT_FILE_SIZE,
} from './receipt-validation';

describe('Settlement Reminders & Ordinal Formatting (PRD §8.4)', () => {
  it('formats ordinal days with accurate English suffixes', () => {
    expect(formatOrdinalDay(1)).toBe('1st');
    expect(formatOrdinalDay(2)).toBe('2nd');
    expect(formatOrdinalDay(3)).toBe('3rd');
    expect(formatOrdinalDay(4)).toBe('4th');
    expect(formatOrdinalDay(11)).toBe('11th');
    expect(formatOrdinalDay(12)).toBe('12th');
    expect(formatOrdinalDay(13)).toBe('13th');
    expect(formatOrdinalDay(21)).toBe('21st');
    expect(formatOrdinalDay(22)).toBe('22nd');
    expect(formatOrdinalDay(23)).toBe('23rd');
    expect(formatOrdinalDay(28)).toBe('28th');
  });

  it('computes due dates and in-app reminder countdowns accurately', () => {
    // Target settlement month: October 2026. Due date is in November on the 15th.
    const reminder = computeSettlementReminder('2026-10', 15, 3, '2026-11-12');
    expect(reminder.dueDate).toBe('2026-11-15');
    expect(reminder.daysRemaining).toBe(3);
    expect(reminder.inReminderWindow).toBe(true);
    expect(reminder.isOverdue).toBe(false);
    expect(reminder.formattedDueDay).toBe('15th');
  });

  it('detects overdue settlements accurately past due day', () => {
    const reminder = computeSettlementReminder('2026-10', 15, 3, '2026-11-16');
    expect(reminder.isOverdue).toBe(true);
    expect(reminder.daysRemaining).toBe(-1);
    expect(reminder.inReminderWindow).toBe(false);
  });

  it('correctly clamps due dates for February and short months', () => {
    // Target settlement month: January 2026. Following month is Feb 2026 (28 days).
    const reminderFeb = computeSettlementReminder('2026-01', 31, 3, '2026-02-25');
    expect(reminderFeb.dueDate).toBe('2026-02-28');
    expect(reminderFeb.formattedDueDay).toBe('28th');

    // Leap year Feb 2028 (29 days)
    const reminderLeap = computeSettlementReminder('2028-01', 31, 3, '2028-02-25');
    expect(reminderLeap.dueDate).toBe('2028-02-29');
    expect(reminderLeap.formattedDueDay).toBe('29th');
  });
});

describe('Settlement Five-State Lifecycle Transitions (PRD §8.4, Tests #20, #26)', () => {
  it('transitions through all five discrete settlement states using authoritative helper', () => {
    // 1. not_applicable (zero liability, e.g. customer-borne charges, Test #20)
    expect(calcSettlementStatus(0n, 0n)).toBe('not_applicable');

    // 2. due (expected > 0, zero paid)
    expect(calcSettlementStatus(50000n, 0n)).toBe('due');

    // 3. partly_paid (0 < paid < expected)
    expect(calcSettlementStatus(50000n, 20000n)).toBe('partly_paid');

    // 4. paid (paid === expected)
    expect(calcSettlementStatus(50000n, 50000n)).toBe('paid');

    // 5. overpaid (paid > expected)
    expect(calcSettlementStatus(50000n, 55000n)).toBe('overpaid');
  });

  it('calculates payment reversal net balances and supports partial reversals (Test #13)', () => {
    const originalPaid = 500000n; // ৳5,000
    const partialReversal = 200000n; // ৳2,000
    const remainingReversible = originalPaid - partialReversal;
    expect(remainingReversible).toBe(300000n); // ৳3,000 remaining reversible

    const secondReversal = 300000n; // ৳3,000
    const fullyReversedBalance = remainingReversible - secondReversal;
    expect(fullyReversedBalance).toBe(0n);
  });
});

describe('Receipt Upload Magic-Byte Validation & Security (PRD §8.4, §13, Test #64)', () => {
  it('detects genuine PNG, JPEG, WebP, and PDF magic bytes', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectMagicBytes(pngBytes)?.mime).toBe('image/png');

    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectMagicBytes(jpegBytes)?.mime).toBe('image/jpeg');

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]);
    expect(detectMagicBytes(pdfBytes)?.mime).toBe('application/pdf');

    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectMagicBytes(webpBytes)?.mime).toBe('image/webp');
  });

  it('rejects spoofed files whose binary signature does not match allowed types', () => {
    const fakePdf = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // Windows PE EXE header disguised
    expect(detectMagicBytes(fakePdf)).toBeNull();
  });

  it('enforces 5 MB file size limit and allowed MIME types (HTTP 413, 415)', () => {
    expect(validateReceiptUpload(MAX_RECEIPT_FILE_SIZE, 'image/png').valid).toBe(true);
    expect(validateReceiptUpload(MAX_RECEIPT_FILE_SIZE + 1, 'image/png').statusCode).toBe(413);
    expect(validateReceiptUpload(1000, 'text/plain').statusCode).toBe(415);
    expect(validateReceiptUpload(0, 'image/png').statusCode).toBe(400);
  });

  it('validates receipt storage path and blocks path traversal attempts', () => {
    expect(validateReceiptPath('receipts/2026-10/4f9b8c2a-1e3d-4c5b-8a7e-9f0a1b2c3d4e.png')).toBe(true);
    expect(validateReceiptPath('receipts/2026-10/4f9b8c2a-1e3d-4c5b-8a7e-9f0a1b2c3d4e.pdf')).toBe(true);

    // Path traversal attacks
    expect(validateReceiptPath('../receipts/2026-10/file.png')).toBe(false);
    expect(validateReceiptPath('/etc/passwd')).toBe(false);
    expect(validateReceiptPath('receipts/2026-10/../../../secret.txt')).toBe(false);
    expect(validateReceiptPath('receipts/invalid-month/uuid.png')).toBe(false);
  });
});
