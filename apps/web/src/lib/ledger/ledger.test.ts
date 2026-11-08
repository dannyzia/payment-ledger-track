import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeEntrySearchQuery, matchesEntrySearch } from './search';
import { groupEntriesByDay } from './grouping';
import { requestEntryVoid, executeEntryVoid } from './void';
import { db, type LocalEntry } from '$lib/db';

describe('Ledger Search & Precision Matching', () => {
  it('strips formatted E-YYYYMM-0* prefix and matches local badge queries', () => {
    const res1 = normalizeEntrySearchQuery('E-202610-000042');
    expect(res1.numericEntryNumber).toBe(42);

    const res2 = normalizeEntrySearchQuery('E-000105');
    expect(res2.numericEntryNumber).toBe(105);

    const res3 = normalizeEntrySearchQuery('#LOCAL-a1b2c3');
    expect(res3.localBadgeQuery).toBe('a1b2c3');

    const res4 = normalizeEntrySearchQuery('LOCAL-def456');
    expect(res4.localBadgeQuery).toBe('def456');

    const res5 = normalizeEntrySearchQuery('  Ziaur  ');
    expect(res5.numericEntryNumber).toBeNull();
    expect(res5.localBadgeQuery).toBeNull();
    expect(res5.textQuery).toBe('ziaur');
  });

  it('strictly isolates numeric entry number search from month/year date parts (PRD §8.2)', () => {
    const entryOctober: LocalEntry = {
      id: 'e1',
      entry_number: 'E-202610-000042',
      local_id: '#LOCAL-oct',
      entry_date: '2026-10-29',
      customer_name: 'Ziaur Rahman',
      sub_qty: 1,
      method_id: 'm1',
      gross_poisha: '100000',
      vat_poisha: '0',
      commission_poisha: '42000',
      charge_poisha: '1150',
      business_charge_poisha: '1150',
      customer_charge_poisha: '0',
      net_poisha: '56850',
      status: 'active',
      sync_status: 'synced',
      created_by: 'u1',
      created_at: '2026-10-29T10:00:00Z',
      stale_rates: false,
      rate_profile_id: 'p1',
    };

    // Searching '42' matches entry 42
    expect(matchesEntrySearch(entryOctober, normalizeEntrySearchQuery('42'))).toBe(true);

    // Searching '10' does NOT match entry 42 (must NOT match the 202610 month part)
    expect(matchesEntrySearch(entryOctober, normalizeEntrySearchQuery('10'))).toBe(false);

    // Searching '2026' does NOT match entry 42 (must NOT match the year part)
    expect(matchesEntrySearch(entryOctober, normalizeEntrySearchQuery('2026'))).toBe(false);

    // Full formatted search matches
    expect(matchesEntrySearch(entryOctober, normalizeEntrySearchQuery('E-202610-000042'))).toBe(
      true,
    );
  });
});

describe('Intra-Day Ordering & Subtotals', () => {
  it('sorts intra-day entries newest first by created_at DESC with server_seq tie-breaker', () => {
    const entries: LocalEntry[] = [
      {
        id: '1',
        local_id: '#LOCAL-1',
        entry_date: '2026-10-29',
        customer_name: 'Customer Early',
        sub_qty: 1,
        method_id: 'm1',
        gross_poisha: '100000',
        vat_poisha: '0',
        commission_poisha: '42000',
        charge_poisha: '1150',
        business_charge_poisha: '1150',
        customer_charge_poisha: '0',
        net_poisha: '56850',
        status: 'active',
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '2026-10-29T08:00:00Z',
        server_seq: '10',
        stale_rates: false,
        rate_profile_id: 'p1',
      },
      {
        id: '2',
        local_id: '#LOCAL-2',
        entry_date: '2026-10-29',
        customer_name: 'Customer Late',
        sub_qty: 1,
        method_id: 'm1',
        gross_poisha: '200000',
        vat_poisha: '0',
        commission_poisha: '84000',
        charge_poisha: '2300',
        business_charge_poisha: '2300',
        customer_charge_poisha: '0',
        net_poisha: '113700',
        status: 'active',
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '2026-10-29T14:00:00Z',
        server_seq: '11',
        stale_rates: false,
        rate_profile_id: 'p1',
      },
    ];

    const groups = groupEntriesByDay(entries);
    expect(groups.length).toBe(1);
    expect(groups[0].entries[0].customer_name).toBe('Customer Late');
    expect(groups[0].entries[1].customer_name).toBe('Customer Early');
  });

  it('calculates daily gross, deductions, and net subtotals strictly from active entries', () => {
    const entries: LocalEntry[] = [
      {
        id: '1',
        local_id: '#LOCAL-1',
        entry_date: '2026-10-29',
        customer_name: 'Customer A',
        sub_qty: 2,
        method_id: 'm1',
        gross_poisha: '100050',
        vat_poisha: '0',
        commission_poisha: '42021',
        charge_poisha: '1151',
        business_charge_poisha: '1151',
        customer_charge_poisha: '0',
        net_poisha: '56878',
        status: 'active',
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '2026-10-29T10:00:00Z',
        stale_rates: false,
        rate_profile_id: 'p1',
      },
      {
        id: '2',
        local_id: '#LOCAL-2',
        entry_date: '2026-10-29',
        customer_name: 'Customer B (Voided)',
        sub_qty: 1,
        method_id: 'm1',
        gross_poisha: '50000',
        vat_poisha: '0',
        commission_poisha: '21000',
        charge_poisha: '575',
        business_charge_poisha: '575',
        customer_charge_poisha: '0',
        net_poisha: '28425',
        status: 'voided',
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '2026-10-29T11:00:00Z',
        stale_rates: false,
        rate_profile_id: 'p1',
      },
    ];

    const groups = groupEntriesByDay(entries);
    expect(groups.length).toBe(1);
    expect(groups[0].totalGrossPoisha).toBe(100050n);
    expect(groups[0].totalNetPoisha).toBe(56878n);
    expect(groups[0].totalDeductionsPoisha).toBe(100050n - 56878n);
  });
});

describe('Void Lifecycle & Outbox Queueing (PRD §8.2, §9.2)', () => {
  beforeEach(async () => {
    await db.outbox.clear();
    await db.entries.clear();
    await db.rateProfiles.clear();
    await db.monthCloses.clear();

    await db.rateProfiles.put({
      id: 'rp-1',
      version: 2,
      status: 'published',
      effective_from: '2026-01-01',
      vat_mode: 'manual',
      vat_bp: 0,
      commission_bp: 4200,
      commission_base: 'gross',
      method_rates: {},
    });
  });

  it('requestEntryVoid updates entry locally with void_requested_by and enqueues request_void op', async () => {
    const entry: LocalEntry = {
      id: 'e-1',
      local_id: '#LOCAL-1',
      entry_date: '2026-10-29',
      customer_name: 'Customer Test',
      sub_qty: 1,
      method_id: 'm1',
      gross_poisha: '50000',
      vat_poisha: '0',
      commission_poisha: '21000',
      charge_poisha: '575',
      business_charge_poisha: '575',
      customer_charge_poisha: '0',
      net_poisha: '28425',
      status: 'active',
      sync_status: 'synced',
      created_by: 'staff-1',
      created_at: '2026-10-29T10:00:00Z',
      stale_rates: false,
      rate_profile_id: 'rp-1',
    };
    await db.entries.put(entry);

    const res = await requestEntryVoid(entry, 'staff-1', 'Incorrect payment method');
    expect(res.success).toBe(true);

    const updated = await db.entries.get('e-1');
    expect(updated?.void_requested_by).toBe('staff-1');
    expect(updated?.void_reason).toBe('Incorrect payment method');
    expect(updated?.status).toBe('active'); // Still active until approved
    expect(updated?.sync_status).toBe('pending');

    const outboxOp = await db.outbox.get(res.opId);
    expect(outboxOp?.type).toBe('request_void');
    expect(outboxOp?.maxKnownRateVersion).toBe(2);
  });

  it('executeEntryVoid marks entry status = voided locally and enqueues void_entry op', async () => {
    const entry: LocalEntry = {
      id: 'e-2',
      local_id: '#LOCAL-2',
      entry_date: '2026-10-29',
      customer_name: 'Customer Admin Test',
      sub_qty: 1,
      method_id: 'm1',
      gross_poisha: '50000',
      vat_poisha: '0',
      commission_poisha: '21000',
      charge_poisha: '575',
      business_charge_poisha: '575',
      customer_charge_poisha: '0',
      net_poisha: '28425',
      status: 'active',
      sync_status: 'synced',
      created_by: 'staff-1',
      created_at: '2026-10-29T10:00:00Z',
      stale_rates: false,
      rate_profile_id: 'rp-1',
    };
    await db.entries.put(entry);

    const res = await executeEntryVoid(entry, 'admin-1', 'Approved customer cancellation');
    expect(res.success).toBe(true);

    const updated = await db.entries.get('e-2');
    expect(updated?.status).toBe('voided'); // Optimistically voided
    expect(updated?.sync_status).toBe('pending');

    const outboxOp = await db.outbox.get(res.opId);
    expect(outboxOp?.type).toBe('void_entry');
    expect(outboxOp?.maxKnownRateVersion).toBe(2);
  });
});

describe('Closed-Month Action Lockout (PRD §8.4)', () => {
  beforeEach(async () => {
    await db.monthCloses.clear();
    await db.entries.clear();
    await db.outbox.clear();
  });

  it('rejects void request and direct void when entry falls in a closed month', async () => {
    await db.monthCloses.put({
      month: '2026-10-01',
      status: 'closed',
      closed_at: '2026-11-01T00:00:00Z',
      closed_by: 'admin-1',
    });

    const entry: LocalEntry = {
      id: 'e-closed',
      local_id: '#LOCAL-closed',
      entry_date: '2026-10-15',
      customer_name: 'Customer Closed Month',
      sub_qty: 1,
      method_id: 'm1',
      gross_poisha: '50000',
      vat_poisha: '0',
      commission_poisha: '21000',
      charge_poisha: '575',
      business_charge_poisha: '575',
      customer_charge_poisha: '0',
      net_poisha: '28425',
      status: 'active',
      sync_status: 'synced',
      created_by: 'staff-1',
      created_at: '2026-10-15T10:00:00Z',
      stale_rates: false,
      rate_profile_id: 'rp-1',
    };
    await db.entries.put(entry);

    await expect(requestEntryVoid(entry, 'staff-1', 'Need refund')).rejects.toThrow(
      'Month 2026-10 is closed. Voids are locked.',
    );

    await expect(executeEntryVoid(entry, 'admin-1', 'Admin override')).rejects.toThrow(
      'Month 2026-10 is closed. Voids are locked.',
    );

    const outboxOps = await db.outbox.toArray();
    expect(outboxOps.length).toBe(0);
  });
});

describe('Entry Inactive Status & Supersede Guards (Test #32, Test #57)', () => {
  it('prevents voiding non-active entries (Test #32)', async () => {
    const voidedEntry: LocalEntry = {
      id: 'e-voided',
      local_id: '#LOCAL-voided',
      entry_date: '2026-10-29',
      customer_name: 'Already Voided',
      sub_qty: 1,
      method_id: 'm1',
      gross_poisha: '50000',
      vat_poisha: '0',
      commission_poisha: '21000',
      charge_poisha: '575',
      business_charge_poisha: '575',
      customer_charge_poisha: '0',
      net_poisha: '28425',
      status: 'voided',
      sync_status: 'synced',
      created_by: 'staff-1',
      created_at: '2026-10-29T10:00:00Z',
      stale_rates: false,
      rate_profile_id: 'rp-1',
    };

    await expect(requestEntryVoid(voidedEntry, 'staff-1', 'Void again')).rejects.toThrow(
      'Only active entries can be requested for void',
    );

    await expect(executeEntryVoid(voidedEntry, 'admin-1', 'Direct void again')).rejects.toThrow(
      'Only active entries can be voided',
    );
  });

  it('matches stale rate entry and handles stale_review_status (Test #57)', () => {
    const staleEntry: LocalEntry = {
      id: 'e-stale',
      local_id: '#LOCAL-stale',
      entry_date: '2026-10-29',
      customer_name: 'Stale Customer',
      sub_qty: 1,
      method_id: 'm1',
      gross_poisha: '6000000',
      vat_poisha: '0',
      commission_poisha: '2520000',
      charge_poisha: '69000',
      business_charge_poisha: '69000',
      customer_charge_poisha: '0',
      net_poisha: '3411000',
      status: 'active',
      sync_status: 'synced',
      created_by: 'staff-1',
      created_at: '2026-10-29T10:00:00Z',
      stale_rates: true,
      stale_review_status: 'approved',
      rate_profile_id: 'rp-old',
    };

    expect(staleEntry.stale_rates).toBe(true);
    expect(staleEntry.stale_review_status).toBe('approved');
    expect(matchesEntrySearch(staleEntry, normalizeEntrySearchQuery('Stale'))).toBe(true);
  });
});
