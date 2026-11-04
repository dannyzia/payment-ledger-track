import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const methodRateItemSchema = z.object({
  payment_method_id: z.string().uuid(),
  fee_bp: z.number().int().min(0).max(10000),
  charges_borne_by: z.enum(['business', 'customer']).default('business'),
});

const draftRateSchema = z.object({
  draftId: z.string().uuid().optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vat: z.object({
    mode: z.enum(['manual', 'percent_of_gross', 'percent_inclusive']),
    rateBp: z.number().int().min(0).max(10000).optional(),
  }),
  commission: z.object({
    rateBp: z.number().int().min(0).max(10000),
    base: z.enum(['gross_minus_vat', 'gross']),
  }),
  methodRates: z.array(methodRateItemSchema).min(1),
  note: z.string().optional(),
});

const manageMethodSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  active: z.boolean(),
  requires_txn_ref: z.boolean(),
  sort_order: z.number().int().min(0).default(0),
});

const managePayableSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  kind: z.enum(['vat', 'method_charge']),
  method_id: z.string().uuid().nullable().optional(),
  due_day: z.number().int().min(1).max(28),
  remind_days_before: z.number().int().min(0).max(14).default(3),
  active: z.boolean(),
});

const updateSettingsSchema = z.object({
  net_label: z.string().min(1).max(100),
  reconcile_tolerance_poisha: z.number().int().min(0),
});

const staleReviewSchema = z.object({
  entryId: z.string().uuid(),
  action: z.enum(['approved', 'rejected']),
  reason: z.string().min(1).max(500),
});

const manageDeviceSchema = z.object({
  deviceId: z.string().uuid().transform((s) => s.toLowerCase()),
  action: z.enum(['revoke', 'unrevoke']),
});

function validateTotalDeductions(
  vatMode: string,
  vatBp: number,
  commBp: number,
  methodRates: { fee_bp: number }[]
): boolean {
  const effectiveVat = vatMode === 'manual' ? 0 : vatBp;
  const maxCharge = methodRates.length > 0 ? Math.max(...methodRates.map((m) => m.fee_bp)) : 0;
  return effectiveVat + commBp + maxCharge <= 10000;
}

function validateDueDay(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= 28;
}

describe('Admin Panel Validation & Guard Rules', () => {
  describe('Deduction Upper Bounds (10,000 bp ceiling)', () => {
    it('blocks submissions where total deductions exceed 100% (10,000 bp)', () => {
      const vatMode = 'percent_of_gross';
      const vatBp = 500; // 5%
      const commissionBp = 9000; // 90%
      const methodRates = [{ fee_bp: 600 }]; // 6% -> total 101%

      expect(validateTotalDeductions(vatMode, vatBp, commissionBp, methodRates)).toBe(false);
    });

    it('permits submissions where total deductions are exactly 100% (10,000 bp)', () => {
      const vatMode = 'percent_of_gross';
      const vatBp = 500; // 5%
      const commissionBp = 9000; // 90%
      const methodRates = [{ fee_bp: 500 }]; // 5% -> total 100%

      expect(validateTotalDeductions(vatMode, vatBp, commissionBp, methodRates)).toBe(true);
    });

    it('ignores VAT bp in manual mode when computing deduction ceiling', () => {
      const vatMode = 'manual';
      const vatBp = 1500; // should be ignored
      const commissionBp = 8500; // 85%
      const methodRates = [{ fee_bp: 1500 }]; // 15% -> total 100%

      expect(validateTotalDeductions(vatMode, vatBp, commissionBp, methodRates)).toBe(true);
    });
  });

  describe('Payable Due Day Constraints (1 to 28)', () => {
    it('validates payable due day strictly within 1 to 28', () => {
      expect(validateDueDay(1)).toBe(true);
      expect(validateDueDay(15)).toBe(true);
      expect(validateDueDay(28)).toBe(true);

      expect(validateDueDay(0)).toBe(false);
      expect(validateDueDay(29)).toBe(false);
      expect(validateDueDay(30)).toBe(false);
      expect(validateDueDay(31)).toBe(false);
      expect(validateDueDay(-5)).toBe(false);
    });

    it('validates managePayableSchema schema parsing', () => {
      const validPayable = {
        code: 'vat_nbr',
        name: 'National Board of Revenue VAT Account',
        kind: 'vat',
        due_day: 15,
        remind_days_before: 3,
        active: true,
      };
      expect(managePayableSchema.safeParse(validPayable).success).toBe(true);

      // Rejects invalid due_day
      expect(managePayableSchema.safeParse({ ...validPayable, due_day: 30 }).success).toBe(false);
      // Rejects invalid remind_days_before
      expect(managePayableSchema.safeParse({ ...validPayable, remind_days_before: 20 }).success).toBe(false);
      // Rejects empty code
      expect(managePayableSchema.safeParse({ ...validPayable, code: '' }).success).toBe(false);
    });
  });

  describe('Payment Method Schema Validation', () => {
    it('validates manageMethodSchema parsing and defaults sort_order', () => {
      const valid = {
        code: 'bkash',
        name: 'bKash Merchant',
        active: true,
        requires_txn_ref: true,
      };
      const parsed = manageMethodSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.sort_order).toBe(0);
      }

      // Rejects negative sort_order
      expect(manageMethodSchema.safeParse({ ...valid, sort_order: -1 }).success).toBe(false);
      // Rejects empty name
      expect(manageMethodSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    });
  });

  describe('Application Settings Schema Validation', () => {
    it('validates updateSettingsSchema with net_label and non-negative tolerance', () => {
      const valid = {
        net_label: 'Final Net after Deductions',
        reconcile_tolerance_poisha: 100,
      };
      expect(updateSettingsSchema.safeParse(valid).success).toBe(true);

      // Rejects negative tolerance
      expect(updateSettingsSchema.safeParse({ ...valid, reconcile_tolerance_poisha: -1 }).success).toBe(false);
      // Rejects empty label
      expect(updateSettingsSchema.safeParse({ ...valid, net_label: '' }).success).toBe(false);
    });
  });

  describe('Stale Review and Device Management Schemas', () => {
    it('validates staleReviewSchema requires mandatory reason', () => {
      const valid = {
        entryId: 'a0000000-0000-0000-0000-000000000001',
        action: 'approved',
        reason: 'Verified against merchant slip',
      };
      expect(staleReviewSchema.safeParse(valid).success).toBe(true);

      // Rejects empty reason
      expect(staleReviewSchema.safeParse({ ...valid, reason: '' }).success).toBe(false);
      // Rejects invalid action
      expect(staleReviewSchema.safeParse({ ...valid, action: 'dismissed' }).success).toBe(false);
    });

    it('validates manageDeviceSchema actions and lowercases deviceId', () => {
      const valid = {
        deviceId: 'A0000000-0000-0000-0000-000000000001',
        action: 'revoke',
      };
      const parsed = manageDeviceSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.deviceId).toBe('a0000000-0000-0000-0000-000000000001');
      }

      // Rejects legacy invalid action 'restore'
      expect(manageDeviceSchema.safeParse({ ...valid, action: 'restore' }).success).toBe(false);
      // Accepts 'unrevoke'
      expect(manageDeviceSchema.safeParse({ ...valid, action: 'unrevoke' }).success).toBe(true);
    });
  });

  describe('Rate Profile Draft Schema Validation', () => {
    it('parses valid rate profile draft payloads with method rates array and charges_borne_by', () => {
      const validPayload = {
        effectiveFrom: '2026-11-01',
        vat: { mode: 'percent_of_gross', rateBp: 500 },
        commission: { rateBp: 4200, base: 'gross_minus_vat' },
        methodRates: [
          {
            payment_method_id: 'a0000000-0000-0000-0000-000000000001',
            fee_bp: 150,
            charges_borne_by: 'business',
          },
          {
            payment_method_id: 'a0000000-0000-0000-0000-000000000002',
            fee_bp: 115,
            charges_borne_by: 'customer',
          },
        ],
        note: 'Updated card fee structure',
      };

      const parsed = draftRateSchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);
    });
  });
});
