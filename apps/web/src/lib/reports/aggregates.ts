import { z } from 'zod';
import type { LocalEntry, CachedPaymentMethod } from '$lib/db';

export const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Invalid month format. Expected YYYY-MM');

export interface MethodChargeSummary {
  methodId: string;
  methodCode: string;
  entryCount: number;
  totalGrossPoisha: bigint;
  totalBusinessChargePoisha: bigint;
  totalCustomerChargePoisha: bigint;
  totalChargePoisha: bigint;
}

export interface DailyBreakdown {
  date: string; // YYYY-MM-DD
  entryCount: number;
  subQty: number;
  grossPoisha: bigint;
  vatPoisha: bigint;
  commissionPoisha: bigint;
  businessChargePoisha: bigint;
  customerChargePoisha: bigint;
  netPoisha: bigint;
}

export interface MonthlyReportData {
  month: string; // YYYY-MM-01
  totalEntries: number;
  vatEntriesCount: number;
  pendingEntriesCount: number;
  totalSubQty: number;
  totalGrossPoisha: bigint;
  totalVatPoisha: bigint;
  totalCommissionPoisha: bigint;
  totalChargePoisha: bigint;
  totalBusinessChargesPoisha: bigint;
  totalCustomerChargesPoisha: bigint;
  totalNetPoisha: bigint;
  methodCharges: MethodChargeSummary[];
  dailyBreakdowns: DailyBreakdown[];
}

export interface MonthOverMonthDelta {
  grossDeltaPoisha: bigint;
  grossDeltaPercent: number | null;
  netDeltaPoisha: bigint;
  netDeltaPercent: number | null;
  commissionDeltaPoisha: bigint;
  commissionDeltaPercent: number | null;
}

/**
 * Computes monthly financial aggregates strictly from active, non-rejected entries.
 * Voided, superseded, and server-rejected entries are completely excluded.
 * Customer-borne provider charges are isolated in totalCustomerChargesPoisha
 * and excluded from merchant settlement liabilities (Hard Rule 3, PRD §8.3, §10).
 */
export function computeMonthlyAggregates(
  entries: LocalEntry[],
  monthPrefix: string,
  methodsMap: Record<string, CachedPaymentMethod> = {}
): MonthlyReportData {
  MonthSchema.parse(monthPrefix);

  // Filter strictly for active entries in target month, excluding rejected sync ops (PRD §8.3, §10)
  const activeEntries = entries.filter(
    (e) => e.status === 'active' && e.sync_status !== 'rejected' && e.entry_date.startsWith(monthPrefix)
  );

  let gross = 0n;
  let vat = 0n;
  let commission = 0n;
  let totalCharge = 0n;
  let businessCharges = 0n;
  let customerCharges = 0n;
  let net = 0n;
  let subQty = 0;
  let pendingCount = 0;
  let vatCount = 0;

  const methodMap = new Map<string, { count: number; gross: bigint; business: bigint; customer: bigint; charge: bigint }>();
  const dailyMap = new Map<string, { count: number; subQty: number; gross: bigint; vat: bigint; comm: bigint; biz: bigint; cust: bigint; net: bigint }>();

  for (const e of activeEntries) {
    if (e.sync_status === 'pending') {
      pendingCount += 1;
    }

    const entryGross = BigInt(e.gross_poisha);
    const entryVat = BigInt(e.vat_poisha);
    if (entryVat > 0n) {
      vatCount += 1;
    }
    const entryComm = BigInt(e.commission_poisha);
    const entryBizCharge = BigInt(e.business_charge_poisha);
    const entryCustCharge = BigInt(e.customer_charge_poisha);
    const entryNet = BigInt(e.net_poisha);
    const entryCharge = entryBizCharge + entryCustCharge;

    gross += entryGross;
    vat += entryVat;
    commission += entryComm;
    totalCharge += entryCharge;
    businessCharges += entryBizCharge;
    customerCharges += entryCustCharge;
    net += entryNet;
    subQty += e.sub_qty;

    // Method breakdown (Volume & Charges)
    const m = methodMap.get(e.method_id) ?? { count: 0, gross: 0n, business: 0n, customer: 0n, charge: 0n };
    m.count += 1;
    m.gross += entryGross;
    m.business += entryBizCharge;
    m.customer += entryCustCharge;
    m.charge += entryCharge;
    methodMap.set(e.method_id, m);

    // Daily breakdown for cash reconciliation
    const d = dailyMap.get(e.entry_date) ?? { count: 0, subQty: 0, gross: 0n, vat: 0n, comm: 0n, biz: 0n, cust: 0n, net: 0n };
    d.count += 1;
    d.subQty += e.sub_qty;
    d.gross += entryGross;
    d.vat += entryVat;
    d.comm += entryComm;
    d.biz += entryBizCharge;
    d.cust += entryCustCharge;
    d.net += entryNet;
    dailyMap.set(e.entry_date, d);
  }

  const methodCharges: MethodChargeSummary[] = Array.from(methodMap.entries()).map(([id, stats]) => {
    const cachedMethod = methodsMap[id];
    return {
      methodId: id,
      methodCode: cachedMethod?.code ?? id,
      entryCount: stats.count,
      totalGrossPoisha: stats.gross,
      totalBusinessChargePoisha: stats.business,
      totalCustomerChargePoisha: stats.customer,
      totalChargePoisha: stats.charge,
    };
  });

  const dailyBreakdowns: DailyBreakdown[] = Array.from(dailyMap.entries())
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, d]) => ({
      date,
      entryCount: d.count,
      subQty: d.subQty,
      grossPoisha: d.gross,
      vatPoisha: d.vat,
      commissionPoisha: d.comm,
      businessChargePoisha: d.biz,
      customerChargePoisha: d.cust,
      netPoisha: d.net,
    }));

  return {
    month: `${monthPrefix}-01`,
    totalEntries: activeEntries.length,
    vatEntriesCount: vatCount,
    pendingEntriesCount: pendingCount,
    totalSubQty: subQty,
    totalGrossPoisha: gross,
    totalVatPoisha: vat,
    totalCommissionPoisha: commission,
    totalChargePoisha: totalCharge,
    totalBusinessChargesPoisha: businessCharges,
    totalCustomerChargesPoisha: customerCharges,
    totalNetPoisha: net,
    methodCharges,
    dailyBreakdowns,
  };
}

/**
 * Computes Month-over-Month (MoM) delta percentages and poisha differences.
 */
export function computeMonthOverMonthDelta(
  current: MonthlyReportData,
  prior: MonthlyReportData
): MonthOverMonthDelta {
  const calcPct = (curr: bigint, prev: bigint): number | null => {
    if (prev === 0n) return null;
    const diff = Number(curr - prev);
    const base = Math.abs(Number(prev));
    return Math.round((diff / base) * 1000) / 10; // 1 decimal place
  };

  return {
    grossDeltaPoisha: current.totalGrossPoisha - prior.totalGrossPoisha,
    grossDeltaPercent: calcPct(current.totalGrossPoisha, prior.totalGrossPoisha),
    netDeltaPoisha: current.totalNetPoisha - prior.totalNetPoisha,
    netDeltaPercent: calcPct(current.totalNetPoisha, prior.totalNetPoisha),
    commissionDeltaPoisha: current.totalCommissionPoisha - prior.totalCommissionPoisha,
    commissionDeltaPercent: calcPct(current.totalCommissionPoisha, prior.totalCommissionPoisha),
  };
}
