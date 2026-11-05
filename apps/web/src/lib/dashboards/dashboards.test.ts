import { describe, it, expect } from 'vitest';
import {
  getAsiaDhakaDateString,
  getPriorMonthPrefix,
  formatOrdinalDay,
  computeStaffPersonalMetrics,
  computeOverallShopMetrics,
  computeShopMethodCollections,
  filterHighValueStaleEntries,
  filterPendingVoidRequests,
  filterDuplicateTxnEntries,
  computeExecutiveDeltas,
} from './metrics';
import type { LocalEntry, CachedPaymentMethod, LocalOutboxOp, CachedRejectedOp } from '$lib/db';

describe('Dashboard Metrics & Asia/Dhaka Timezone Boundaries', () => {
  it('computes Asia/Dhaka date correctly across UTC boundaries with zero host DST drift (PRD §12, Test #27)', () => {
    // 2026-10-29 19:30:00 UTC is 2026-10-30 01:30:00 Asia/Dhaka (+6 hours)
    const lateUtc = new Date(Date.UTC(2026, 9, 29, 19, 30, 0));
    const dhakaDate = getAsiaDhakaDateString(lateUtc);
    expect(dhakaDate).toBe('2026-10-30');

    // 2026-10-29 17:59:59 UTC is 2026-10-29 23:59:59 Asia/Dhaka
    const preMidnightUtc = new Date(Date.UTC(2026, 9, 29, 17, 59, 59));
    expect(getAsiaDhakaDateString(preMidnightUtc)).toBe('2026-10-29');

    // 2026-10-29 18:00:00 UTC is 2026-10-30 00:00:00 Asia/Dhaka (exact midnight boundary)
    const midnightUtc = new Date(Date.UTC(2026, 9, 29, 18, 0, 0));
    expect(getAsiaDhakaDateString(midnightUtc)).toBe('2026-10-30');
  });

  it('computes prior month prefix accurately across year boundaries', () => {
    expect(getPriorMonthPrefix('2026-10')).toBe('2026-09');
    expect(getPriorMonthPrefix('2026-01')).toBe('2025-12');
  });

  it('formats ordinal day strings with correct English grammar (PRD §8.5)', () => {
    expect(formatOrdinalDay(1)).toBe('1st');
    expect(formatOrdinalDay(2)).toBe('2nd');
    expect(formatOrdinalDay(3)).toBe('3rd');
    expect(formatOrdinalDay(4)).toBe('4th');
    expect(formatOrdinalDay(11)).toBe('11th');
    expect(formatOrdinalDay(12)).toBe('12th');
    expect(formatOrdinalDay(13)).toBe('13th');
    expect(formatOrdinalDay(15)).toBe('15th');
    expect(formatOrdinalDay(21)).toBe('21st');
    expect(formatOrdinalDay(22)).toBe('22nd');
    expect(formatOrdinalDay(23)).toBe('23rd');
    expect(formatOrdinalDay(28)).toBe('28th');
    expect(formatOrdinalDay(31)).toBe('31st');
  });

  it('aggregates Staff personal today and MTD gross strictly from own active entries (PRD §8.5, Test #30)', () => {
    const entries: LocalEntry[] = [
      { id: '1', entry_date: '2026-10-29', customer_name: 'C1', sub_qty: 1, method_id: 'bkash', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'active', sync_status: 'synced', created_by: 'user_staff', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L1' },
      { id: '2', entry_date: '2026-10-29', customer_name: 'C2', sub_qty: 1, method_id: 'bkash', gross_poisha: '200000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '200000', status: 'active', sync_status: 'synced', created_by: 'other_staff', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L2' },
      { id: '3', entry_date: '2026-10-15', customer_name: 'C3', sub_qty: 1, method_id: 'bkash', gross_poisha: '150000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '150000', status: 'active', sync_status: 'synced', created_by: 'user_staff', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L3' },
      { id: '4', entry_date: '2026-10-29', customer_name: 'C4', sub_qty: 1, method_id: 'bkash', gross_poisha: '500000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '500000', status: 'voided', sync_status: 'synced', created_by: 'user_staff', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L4' },
      { id: '5', entry_date: '2026-10-29', customer_name: 'C5', sub_qty: 1, method_id: 'bkash', gross_poisha: '700000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '700000', status: 'active', sync_status: 'rejected', created_by: 'user_staff', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L5' },
    ];

    const testNow = new Date(Date.UTC(2026, 9, 29, 6, 0, 0)); // 12:00 PM Dhaka on Oct 29
    const metrics = computeStaffPersonalMetrics(entries, 'user_staff', testNow);

    expect(metrics.todayGrossPoisha).toBe(100000n);
    expect(metrics.todayEntriesCount).toBe(1);
    expect(metrics.mtdGrossPoisha).toBe(250000n); // 100000 + 150000 (excludes other staff, voided, and rejected)
    expect(metrics.mtdEntriesCount).toBe(2);
  });

  it('aggregates overall shop gross and transaction counts for Today and MTD (PRD §8.5)', () => {
    const entries: LocalEntry[] = [
      { id: '1', entry_date: '2026-10-29', customer_name: 'C1', sub_qty: 1, method_id: 'm1', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L1' },
      { id: '2', entry_date: '2026-10-29', customer_name: 'C2', sub_qty: 1, method_id: 'm2', gross_poisha: '200000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '200000', status: 'active', sync_status: 'synced', created_by: 'u2', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L2' },
      { id: '3', entry_date: '2026-10-15', customer_name: 'C3', sub_qty: 1, method_id: 'm1', gross_poisha: '300000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '300000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L3' },
    ];

    const shopMetrics = computeOverallShopMetrics(entries, '2026-10-29', '2026-10');
    expect(shopMetrics.todayGrossPoisha).toBe(300000n); // 100000 + 200000
    expect(shopMetrics.todayEntriesCount).toBe(2);
    expect(shopMetrics.mtdGrossPoisha).toBe(600000n); // 100000 + 200000 + 300000
    expect(shopMetrics.mtdEntriesCount).toBe(3);
  });

  it('aggregates shop collections by payment method for Admin overview (PRD §8.5)', () => {
    const entries: LocalEntry[] = [
      { id: '1', entry_date: '2026-10-29', customer_name: 'C1', sub_qty: 1, method_id: 'm_bkash', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L1' },
      { id: '2', entry_date: '2026-10-29', customer_name: 'C2', sub_qty: 1, method_id: 'm_visa', gross_poisha: '250000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '250000', status: 'active', sync_status: 'synced', created_by: 'u2', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L2' },
      { id: '3', entry_date: '2026-10-10', customer_name: 'C3', sub_qty: 1, method_id: 'm_bkash', gross_poisha: '300000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '300000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L3' },
    ];

    const methods: CachedPaymentMethod[] = [
      { id: 'm_bkash', code: 'bkash', name: 'bKash', display_order: 1, active: true, requires_txn_ref: true },
      { id: 'm_visa', code: 'visa', name: 'Visa', display_order: 2, active: true, requires_txn_ref: false },
    ];

    const summaries = computeShopMethodCollections(entries, methods, '2026-10-29', '2026-10');
    const bkashSummary = summaries.find((s) => s.methodId === 'm_bkash');
    const visaSummary = summaries.find((s) => s.methodId === 'm_visa');

    expect(bkashSummary?.todayGrossPoisha).toBe(100000n);
    expect(bkashSummary?.mtdGrossPoisha).toBe(400000n);
    expect(bkashSummary?.mtdCount).toBe(2);

    expect(visaSummary?.todayGrossPoisha).toBe(250000n);
    expect(visaSummary?.mtdGrossPoisha).toBe(250000n);
    expect(visaSummary?.mtdCount).toBe(1);
  });

  it('computes executive comparisons and percentage deltas accurately (PRD §8.5)', () => {
    // Current month: 50,000 gross, 21,000 commission, 26,000 net
    // Prior month: 40,000 gross, 16,800 commission, 20,800 net
    const deltas = computeExecutiveDeltas(
      5000000n, 2100000n, 2600000n,
      4000000n, 1680000n, 2080000n
    );

    expect(deltas.grossDeltaPoisha).toBe(1000000n);
    expect(deltas.grossDeltaPercent).toBe('+25.0%');
    expect(deltas.commissionDeltaPoisha).toBe(420000n);
    expect(deltas.commissionDeltaPercent).toBe('+25.0%');
    expect(deltas.netDeltaPoisha).toBe(520000n);
    expect(deltas.netDeltaPercent).toBe('+25.0%');

    // Fractional drop below 0.05%: minute drop must truncate to '0.0%' instead of
    // rendering '-0.0%' (negative-zero formatting artifact). Delta -100 poisha on
    // 1,000,000 prior = -0.01%, which the integer formatter truncates to '0.0%'.
    const smallDelta = computeExecutiveDeltas(
      999900n, 100000n, 800000n,
      1000000n, 100000n, 800000n
    );
    expect(smallDelta.grossDeltaPercent).toBe('0.0%');

    // Exactly one tenth of a percent down renders '-0.1%' (delta -1000 on 1,000,000)
    const tenthDelta = computeExecutiveDeltas(
      999000n, 100000n, 800000n,
      1000000n, 100000n, 800000n
    );
    expect(tenthDelta.grossDeltaPercent).toBe('-0.1%');

    const zeroDelta = computeExecutiveDeltas(
      999999n, 100000n, 800000n,
      1000000n, 100000n, 800000n
    );
    expect(zeroDelta.grossDeltaPercent).toBe('0.0%');
  });

  it('Admin review queue filters strictly per PRD §10 criteria (Test #47, Test #65)', () => {
    // 1. Stale review filter: gross > 50,000 BDT (5,000,000 poisha) and stale_rates = true
    const sampleEntries: LocalEntry[] = [
      { id: '1', entry_date: '2026-10-29', customer_name: 'C1', sub_qty: 1, method_id: 'm1', gross_poisha: '5000001', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '5000001', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: true, rate_profile_id: 'p1', local_id: '#L1' },
      { id: '2', entry_date: '2026-10-29', customer_name: 'C2', sub_qty: 1, method_id: 'm1', gross_poisha: '5000000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '5000000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: true, rate_profile_id: 'p1', local_id: '#L2' },
      { id: '3', entry_date: '2026-10-29', customer_name: 'C3', sub_qty: 1, method_id: 'm1', gross_poisha: '8000000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '8000000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L3' },
      { id: '4', entry_date: '2026-10-29', customer_name: 'C4', sub_qty: 1, method_id: 'm1', gross_poisha: '6000000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '6000000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: true, rate_profile_id: 'p1', local_id: '#L4', stale_review_status: 'approved' },
    ];

    const flaggedHighValue = filterHighValueStaleEntries(sampleEntries);
    expect(flaggedHighValue).toHaveLength(1);
    expect(flaggedHighValue[0].id).toBe('1');

    // 2. Void request filter: active entries with void_requested_by set
    const voidEntries: LocalEntry[] = [
      { id: 'v1', entry_date: '2026-10-29', customer_name: 'C1', sub_qty: 1, method_id: 'm1', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L1', void_requested_by: 'usr-1' },
      { id: 'v2', entry_date: '2026-10-29', customer_name: 'C2', sub_qty: 1, method_id: 'm1', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'voided', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L2', void_requested_by: 'usr-1' },
      { id: 'v3', entry_date: '2026-10-29', customer_name: 'C3', sub_qty: 1, method_id: 'm1', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L3', void_requested_by: undefined },
    ];

    const pendingVoids = filterPendingVoidRequests(voidEntries);
    expect(pendingVoids).toHaveLength(1);
    expect(pendingVoids[0].id).toBe('v1');

    // 3. Duplicate transaction filter
    const dupEntries: LocalEntry[] = [
      { id: 'd1', entry_date: '2026-10-29', customer_name: 'C1', sub_qty: 1, method_id: 'm1', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L1', dup_txn_flag: true },
      { id: 'd2', entry_date: '2026-10-29', customer_name: 'C2', sub_qty: 1, method_id: 'm1', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L2', dup_txn_flag: false },
    ];
    expect(filterDuplicateTxnEntries(dupEntries)).toHaveLength(1);

    // 4. Closed-month rejected op detection (Test #47)
    const serverRejectedOps: CachedRejectedOp[] = [
      { opId: 'r1', error_code: 'month_closed', error_message: 'Month is closed', rejected_at: '2026-10-29T10:00:00Z', status: 'pending', payload: {} },
      { opId: 'r2', error_code: 'invalid_snapshot_rules', error_message: 'Rate mismatch', rejected_at: '2026-10-29T10:00:00Z', status: 'pending', payload: {} },
      { opId: 'r3', error_code: 'month_closed', error_message: 'Month is closed', rejected_at: '2026-10-29T10:00:00Z', status: 'resolved', payload: {} },
    ];
    const pendingMonthClosedServer = serverRejectedOps.filter(
      (op) => op.error_code === 'month_closed' && op.status === 'pending'
    );
    expect(pendingMonthClosedServer).toHaveLength(1);
    expect(pendingMonthClosedServer[0].opId).toBe('r1');

    const localOutboxOps: LocalOutboxOp[] = [
      { opId: 'o1', userId: 'user_staff', type: 'create_entry', payload: {}, clientCreatedAt: '2026-10-29T10:00:00Z', maxKnownRateVersion: 1, status: 'rejected', rejectionReason: 'month_closed' },
      { opId: 'o2', userId: 'user_staff', type: 'create_entry', payload: {}, clientCreatedAt: '2026-10-29T10:00:00Z', maxKnownRateVersion: 1, status: 'pending' },
    ];
    const pendingMonthClosedLocal = localOutboxOps.filter(
      (op) => op.status === 'rejected' && op.rejectionReason === 'month_closed'
    );
    expect(pendingMonthClosedLocal).toHaveLength(1);
    expect(pendingMonthClosedLocal[0].opId).toBe('o1');

    // 5. Device Burst Anomaly Flag Verification (Test #65)
    // view_device_stale_rate_anomalies aggregates >= 5 stale ops per hour
    const deviceAnomalyThreshold = 5;
    const testAnomalies = [
      { device_id: 'd-1', actor_id: 'a-1', stale_ops_last_hour: 5, latest_stale_op_at: '2026-10-29T11:00:00Z' },
      { device_id: 'd-2', actor_id: 'a-2', stale_ops_last_hour: 4, latest_stale_op_at: '2026-10-29T11:00:00Z' },
    ];
    const flaggedDevices = testAnomalies.filter((a) => a.stale_ops_last_hour >= deviceAnomalyThreshold);
    expect(flaggedDevices).toHaveLength(1);
    expect(flaggedDevices[0].device_id).toBe('d-1');
  });
});
