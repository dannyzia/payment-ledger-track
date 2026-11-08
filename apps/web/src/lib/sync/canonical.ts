/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) serializer.
 * Enforces strict lexicographical sorting of object keys, omission of undefined values,
 * and canonical serialization of primitives and arrays.
 */
export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'number') {
      if (isNaN(obj) || !isFinite(obj)) {
        throw new TypeError('NaN and Infinity are not permitted in RFC 8785 JCS');
      }
    }
    if (typeof obj === 'bigint') {
      return JSON.stringify(obj.toString());
    }
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }

  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec)
    .filter((key) => rec[key] !== undefined)
    .sort();

  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(rec[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Computes deterministic SHA-256 hexadecimal hash of any payload formatted via RFC 8785 JCS.
 * Uses globalThis.crypto.subtle (natively available in modern browsers and Node 22 LTS)
 * without bundler externalization warnings.
 */
export async function computeJcsSha256(canonicalPayload: unknown): Promise<string> {
  const jsonStr = canonicalJsonStringify(canonicalPayload);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(jsonStr);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Web Cryptography subtle API is not available');
}
