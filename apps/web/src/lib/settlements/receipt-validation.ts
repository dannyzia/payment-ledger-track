export const MAX_RECEIPT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB (PRD §8.4, Test #64)

export const ALLOWED_RECEIPT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type AllowedMimeType = (typeof ALLOWED_RECEIPT_MIME_TYPES)[number];

/**
 * Inspects leading binary bytes to determine true file MIME type and extension,
 * defeating MIME-type spoofing attacks (e.g. executable disguised as .png or .pdf).
 */
export function detectMagicBytes(buffer: Uint8Array): { mime: AllowedMimeType; ext: string } | null {
  if (buffer.length < 4) return null;

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  // PDF: 25 50 44 46 (%PDF)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { mime: 'application/pdf', ext: 'pdf' };
  }

  // WebP: RIFF ... WEBP (offset 0: 52 49 46 46, offset 8: 57 45 42 50)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }

  return null;
}

export interface ValidationResult {
  valid: boolean;
  error?: string | undefined;
  statusCode?: number | undefined;
}

/**
 * Pure validation helper for receipt file uploads.
 */
export function validateReceiptUpload(size: number, mimeType: string): ValidationResult {
  if (size <= 0) {
    return { valid: false, error: 'Empty file payload', statusCode: 400 };
  }
  if (size > MAX_RECEIPT_FILE_SIZE) {
    return { valid: false, error: 'File size exceeds maximum 5 MB limit', statusCode: 413 };
  }
  if (!ALLOWED_RECEIPT_MIME_TYPES.includes(mimeType as AllowedMimeType)) {
    return { valid: false, error: 'Unsupported media type. Allowed: JPEG, PNG, WebP, PDF', statusCode: 415 };
  }
  return { valid: true };
}

/**
 * Validates receipt storage path to prevent path traversal and arbitrary bucket reads.
 */
export function validateReceiptPath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  if (path.includes('..') || path.startsWith('/') || path.includes('\\')) return false;
  return /^receipts\/\d{4}-\d{2}\/[a-f0-9\-]+\.(jpg|jpeg|png|webp|pdf)$/i.test(path);
}
