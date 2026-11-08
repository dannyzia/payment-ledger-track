import { db, type LocalEntry } from '$lib/db';
import { getMaxKnownRateVersion } from '$lib/db/rates';

export interface VoidActionResult {
  success: boolean;
  opId: string;
  action: 'void_requested' | 'entry_voided';
}

/**
 * Executes Staff "Request Void" workflow (PRD §8.2, Finding A7).
 * Marks local entry with void_requested_by, void_reason, and void_requested_at,
 * and enqueues request_void operation to Dexie outbox.
 */
export async function requestEntryVoid(
  entry: LocalEntry,
  userId: string,
  reason: string,
): Promise<VoidActionResult> {
  if (entry.status !== 'active') {
    throw new Error('Only active entries can be requested for void');
  }
  if (!reason || reason.trim() === '') {
    throw new Error('A mandatory audit reason is required to request void');
  }

  // Hard Rule 10: Closed-Month Action Lockout
  const monthKey = entry.entry_date.substring(0, 7) + '-01';
  const closeRow = await db.monthCloses.get(monthKey);
  if (closeRow?.status === 'closed') {
    throw new Error(`Month ${entry.entry_date.substring(0, 7)} is closed. Voids are locked.`);
  }

  const trimmedReason = reason.trim();
  const requestedAt = new Date().toISOString();
  const maxRateVersion = await getMaxKnownRateVersion();
  const opId = crypto.randomUUID().toLowerCase();

  // Optimistic local update with sync_status: pending
  await db.entries.update(entry.id, {
    void_requested_by: userId,
    void_reason: trimmedReason,
    sync_status: 'pending',
  });

  // Enqueue outbox operation
  await db.outbox.put({
    opId,
    userId,
    type: 'request_void',
    payload: {
      entryId: entry.id,
      reason: trimmedReason,
      requestedAt,
    },
    clientCreatedAt: requestedAt,
    maxKnownRateVersion: maxRateVersion,
    status: 'pending',
  });

  return { success: true, opId, action: 'void_requested' };
}

/**
 * Executes Admin/Owner direct "Void Entry" or "Approve Void" workflow (PRD §8.2, Finding A7).
 * Marks local entry status = 'voided', sets voided_at and voided_by,
 * and enqueues void_entry operation to Dexie outbox.
 */
export async function executeEntryVoid(
  entry: LocalEntry,
  adminId: string,
  reason: string,
): Promise<VoidActionResult> {
  if (entry.status !== 'active') {
    throw new Error('Only active entries can be voided');
  }
  if (!reason || reason.trim() === '') {
    throw new Error('A mandatory audit reason is required to void an entry');
  }

  // Hard Rule 10: Closed-Month Action Lockout
  const monthKey = entry.entry_date.substring(0, 7) + '-01';
  const closeRow = await db.monthCloses.get(monthKey);
  if (closeRow?.status === 'closed') {
    throw new Error(`Month ${entry.entry_date.substring(0, 7)} is closed. Voids are locked.`);
  }

  const trimmedReason = reason.trim();
  const voidedAt = new Date().toISOString();
  const maxRateVersion = await getMaxKnownRateVersion();
  const opId = crypto.randomUUID().toLowerCase();

  // Optimistic local update: marks voided immediately so strikethrough applies
  await db.entries.update(entry.id, {
    status: 'voided',
    void_reason: trimmedReason,
    sync_status: 'pending',
  });

  // Enqueue outbox operation
  await db.outbox.put({
    opId,
    userId: adminId,
    type: 'void_entry',
    payload: {
      entryId: entry.id,
      reason: trimmedReason,
      voidedAt,
    },
    clientCreatedAt: voidedAt,
    maxKnownRateVersion: maxRateVersion,
    status: 'pending',
  });

  return { success: true, opId, action: 'entry_voided' };
}
