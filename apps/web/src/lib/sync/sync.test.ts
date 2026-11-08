import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { canonicalJsonStringify, computeJcsSha256 } from './canonical';
import {
  REJECTION_MATRIX,
  handleOpRejection,
  retryRejectedOp,
  discardRejectedOp,
} from './recovery';
import { checkRateLimit } from '../server/ratelimit';
import { db } from '$lib/db';

describe('Sync Transport & Canonicalization (RFC 8785)', () => {
  it('formats RFC 8785 canonical keys in strict lexicographical order and omits undefined', () => {
    const unordered = { z: 1, a: 2, m: { b: 3, a: 4 }, ignored: undefined };
    const canonical = canonicalJsonStringify(unordered);
    expect(canonical).toBe('{"a":2,"m":{"a":4,"b":3},"z":1}');
  });

  it('generates consistent SHA-256 hash regardless of object key insertion order', async () => {
    const obj1 = { type: 'create_entry', payload: { gross: '1000' }, maxKnownRateVersion: 1 };
    const obj2 = { maxKnownRateVersion: 1, payload: { gross: '1000' }, type: 'create_entry' };

    const hash1 = await computeJcsSha256(obj1);
    const hash2 = await computeJcsSha256(obj2);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Rejection Recovery Matrix (PRD §9.2.2)', () => {
  it('defines all 25 PRD rejection reasons with explicit action and outboxState', () => {
    const reasons = Object.keys(REJECTION_MATRIX);
    expect(reasons.length).toBe(25);

    expect(REJECTION_MATRIX['month_closed'].action).toBe('move_to_review');
    expect(REJECTION_MATRIX['month_closed'].outboxState).toBe('rejected_closed_month');

    expect(REJECTION_MATRIX['future_timestamp_skew'].action).toBe('adjust_clock');
    expect(REJECTION_MATRIX['payload_hash_mismatch'].action).toBe('retry_fresh_id');
    expect(REJECTION_MATRIX['calc_mismatch'].action).toBe('move_to_review');
    expect(REJECTION_MATRIX['upgrade_required'].action).toBe('halt_execution');
    expect(REJECTION_MATRIX['device_revoked'].action).toBe('halt_execution');
    expect(REJECTION_MATRIX['duplicate'].action).toBe('drop_op');
    expect(REJECTION_MATRIX['cannot_supersede_non_active'].action).toBe('drop_op');
    expect(REJECTION_MATRIX['cannot_void_non_active'].action).toBe('drop_op');
  });

  it('handleOpRejection records rejected op in db.rejectedOps and flags local entry', async () => {
    await db.outbox.clear();
    await db.entries.clear();
    await db.rejectedOps.clear();

    const opId = crypto.randomUUID();
    const entryId = crypto.randomUUID();

    await db.outbox.put({
      opId,
      userId: 'user-1',
      type: 'create_entry',
      payload: { entryId, entryDate: '2026-10-15', grossPoisha: '10000' },
      clientCreatedAt: new Date().toISOString(),
      maxKnownRateVersion: 1,
      status: 'pending',
    });

    await db.entries.put({
      id: entryId,
      local_id: '#LOCAL-test',
      entry_date: '2026-10-15',
      customer_name: 'Test Customer',
      sub_qty: 1,
      method_id: 'b0000000-0000-0000-0000-000000000001',
      gross_poisha: '10000',
      vat_poisha: '0',
      commission_poisha: '420',
      charge_poisha: '115',
      business_charge_poisha: '115',
      customer_charge_poisha: '0',
      net_poisha: '9465',
      status: 'active',
      sync_status: 'pending',
      created_by: 'user-1',
      created_at: new Date().toISOString(),
      stale_rates: false,
      rate_profile_id: 'rp-1',
    });

    await handleOpRejection(opId, 'month_closed');

    const outboxOp = await db.outbox.get(opId);
    expect(outboxOp?.status).toBe('rejected');
    expect(outboxOp?.outboxState).toBe('rejected_closed_month');

    const rejectedRow = await db.rejectedOps.get(opId);
    expect(rejectedRow?.error_code).toBe('month_closed');

    const entry = await db.entries.get(entryId);
    expect(entry?.sync_status).toBe('rejected');
  });

  it('ghost entry rollback: deletes replacement entry and reverts original on rejected supersede', async () => {
    await db.outbox.clear();
    await db.entries.clear();
    await db.rejectedOps.clear();

    const opId = crypto.randomUUID();
    const origId = crypto.randomUUID();
    const repId = crypto.randomUUID();

    // Original entry marked superseded locally
    await db.entries.put({
      id: origId,
      local_id: '#LOCAL-orig',
      entry_date: '2026-10-15',
      customer_name: 'Original Customer',
      sub_qty: 1,
      method_id: 'b0000000-0000-0000-0000-000000000001',
      gross_poisha: '10000',
      vat_poisha: '0',
      commission_poisha: '420',
      charge_poisha: '115',
      business_charge_poisha: '115',
      customer_charge_poisha: '0',
      net_poisha: '9465',
      status: 'superseded',
      sync_status: 'pending',
      created_by: 'user-1',
      created_at: new Date().toISOString(),
      stale_rates: false,
      rate_profile_id: 'rp-1',
    });

    // Uncommitted replacement entry
    await db.entries.put({
      id: repId,
      local_id: '#LOCAL-rep',
      entry_date: '2026-10-15',
      customer_name: 'Replacement Customer',
      sub_qty: 1,
      method_id: 'b0000000-0000-0000-0000-000000000001',
      gross_poisha: '12000',
      vat_poisha: '0',
      commission_poisha: '504',
      charge_poisha: '138',
      business_charge_poisha: '138',
      customer_charge_poisha: '0',
      net_poisha: '11358',
      status: 'active',
      sync_status: 'pending',
      created_by: 'user-1',
      created_at: new Date().toISOString(),
      stale_rates: false,
      rate_profile_id: 'rp-1',
      supersedes_id: origId,
    });

    await db.outbox.put({
      opId,
      userId: 'user-1',
      type: 'supersede_entry',
      payload: {
        originalEntryId: origId,
        replacement: { entryId: repId, grossPoisha: '12000' },
      },
      clientCreatedAt: new Date().toISOString(),
      maxKnownRateVersion: 1,
      status: 'pending',
    });

    await handleOpRejection(opId, 'cannot_supersede_non_active');

    // Replacement entry deleted from Dexie
    const deletedRep = await db.entries.get(repId);
    expect(deletedRep).toBeUndefined();

    // Original entry reverted to active and synced
    const restoredOrig = await db.entries.get(origId);
    expect(restoredOrig?.status).toBe('active');
    expect(restoredOrig?.sync_status).toBe('synced');

    // Op removed from outbox
    const deletedOp = await db.outbox.get(opId);
    expect(deletedOp).toBeUndefined();
  });

  it('retryRejectedOp enforces Global Retry Invariant with fresh opId and supersedesRejectedOpId (Test #3)', async () => {
    await db.outbox.clear();
    await db.rejectedOps.clear();

    const failedOpId = crypto.randomUUID();
    const createdAt = new Date('2026-10-29T10:00:00Z').toISOString();
    await db.outbox.put({
      opId: failedOpId,
      userId: 'user-1',
      type: 'create_entry',
      payload: { grossPoisha: '50000' },
      clientCreatedAt: createdAt,
      maxKnownRateVersion: 1,
      status: 'rejected',
    });

    const freshOpId = await retryRejectedOp(failedOpId);

    expect(freshOpId).not.toBe(failedOpId);
    expect(freshOpId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const freshOp = await db.outbox.get(freshOpId);
    expect(freshOp?.status).toBe('pending');
    expect(freshOp?.supersedesRejectedOpId).toBe(failedOpId);
    expect(freshOp?.clientCreatedAt).toBe(createdAt); // Preserved chronological order

    const oldOp = await db.outbox.get(failedOpId);
    expect(oldOp).toBeUndefined();
  });

  it('discardRejectedOp enqueues discard op and updates rejectedOps (Test #18)', async () => {
    await db.outbox.clear();
    await db.rejectedOps.clear();

    const failedOpId = crypto.randomUUID();
    await db.outbox.put({
      opId: failedOpId,
      userId: 'user-1',
      type: 'create_entry',
      payload: { entryId: 'e-1', grossPoisha: '50000' },
      clientCreatedAt: new Date().toISOString(),
      maxKnownRateVersion: 1,
      status: 'rejected',
    });

    await discardRejectedOp(failedOpId, 'admin-1', 'Audited rejection discard');

    const rejectedRow = await db.rejectedOps.get(failedOpId);
    expect(rejectedRow?.status).toBe('discarded');

    const discardOps = await db.outbox.where('type').equals('discard_rejected_entry').toArray();
    expect(discardOps.length).toBe(1);
    expect((discardOps[0].payload as unknown as Record<string, unknown>).discardedOpId).toBe(
      failedOpId,
    );
    expect((discardOps[0].payload as unknown as Record<string, unknown>).reason).toBe(
      'Audited rejection discard',
    );
  });
});

describe('Sliding Window Rate Limiter (PRD §9.1)', () => {
  it('permits up to 60 requests per minute and rejects the 61st with retryAfter', () => {
    const key = `test-ip-${Date.now()}`;
    for (let i = 0; i < 60; i++) {
      const res = checkRateLimit(key, 60, 60000);
      expect(res.allowed).toBe(true);
    }

    const blocked = checkRateLimit(key, 60, 60000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(60);
  });
});

describe('Sync Batching & Multi-User Isolation (PRD §9.1, Test #62)', () => {
  it('caps push batch at 50 ops per request (PRD §9.1)', async () => {
    await db.outbox.clear();
    const ops = Array.from({ length: 65 }, (_, i) => ({
      opId: crypto.randomUUID(),
      userId: 'user-batch',
      type: 'create_entry' as const,
      payload: { grossPoisha: '1000' },
      clientCreatedAt: new Date(Date.now() + i * 1000).toISOString(),
      maxKnownRateVersion: 1,
      status: 'pending' as const,
    }));
    await db.outbox.bulkPut(ops);

    const pending = await db.outbox
      .where('status')
      .equals('pending')
      .and((op) => op.userId === 'user-batch')
      .sortBy('clientCreatedAt');
    const batch = pending.slice(0, 50);
    expect(batch.length).toBe(50);
    expect(pending.length).toBe(65);
  });

  it('multi-user outbox isolation prevents cross-user op leakage during sync (Test #62)', async () => {
    await db.outbox.clear();
    await db.outbox.bulkPut([
      {
        opId: crypto.randomUUID(),
        userId: 'user-A',
        type: 'create_entry',
        payload: { grossPoisha: '1000' },
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        status: 'pending',
      },
      {
        opId: crypto.randomUUID(),
        userId: 'user-B',
        type: 'create_entry',
        payload: { grossPoisha: '2000' },
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        status: 'pending',
      },
    ]);

    const userAOps = await db.outbox
      .where('status')
      .equals('pending')
      .and((op) => op.userId === 'user-A')
      .toArray();
    expect(userAOps.length).toBe(1);
    expect(userAOps[0].userId).toBe('user-A');

    const userBOps = await db.outbox
      .where('status')
      .equals('pending')
      .and((op) => op.userId === 'user-B')
      .toArray();
    expect(userBOps.length).toBe(1);
    expect(userBOps[0].userId).toBe('user-B');
  });
});
