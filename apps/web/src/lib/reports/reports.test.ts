import { describe, it, expect } from 'vitest';
import { computeMonthlyAggregates, computeMonthOverMonthDelta, MonthSchema } from './aggregates';
import { formatMonthlyReportCsv, formatPoishaForCsv, escapeCsvField } from './export-csv';
import { formatMonthlyReportXmlSpreadsheet } from './export-xlsx';
import type { LocalEntry, CachedPaymentMethod } from '$lib/db';

describe('Reports Aggregates & Parity Verification', () => {
  // 10 fixture rows from PRD §6.6 using exact PRD customer labels (Ayash, Abida, Ahiyan, etc.)
  const fixtures: LocalEntry[] = [
    { id: '1', entry_date: '2026-10-01', customer_name: 'Ayash', sub_qty: 2, method_id: 'bkash', gross_poisha: '590900', vat_poisha: '50900', commission_poisha: '226800', charge_poisha: '6795', business_charge_poisha: '6795', customer_charge_poisha: '0', net_poisha: '306405', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L1' },
    { id: '2', entry_date: '2026-10-02', customer_name: 'Abida', sub_qty: 1, method_id: 'cash', gross_poisha: '330000', vat_poisha: '30000', commission_poisha: '126000', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '174000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L2' },
    { id: '3', entry_date: '2026-10-03', customer_name: 'Ahiyan', sub_qty: 2, method_id: 'cash', gross_poisha: '590900', vat_poisha: '50900', commission_poisha: '226800', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '313200', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L3' },
    { id: '4', entry_date: '2026-10-04', customer_name: 'Suhaima (H)', sub_qty: 2, method_id: 'visa', gross_poisha: '838400', vat_poisha: '58400', commission_poisha: '327600', charge_poisha: '12576', business_charge_poisha: '12576', customer_charge_poisha: '0', net_poisha: '439824', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L4' },
    { id: '5', entry_date: '2026-10-05', customer_name: 'Tahra', sub_qty: 2, method_id: 'visa', gross_poisha: '590900', vat_poisha: '50900', commission_poisha: '226800', charge_poisha: '8864', business_charge_poisha: '8864', customer_charge_poisha: '0', net_poisha: '304336', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L5' },
    { id: '6', entry_date: '2026-10-06', customer_name: 'Aaan', sub_qty: 2, method_id: 'visa', gross_poisha: '590900', vat_poisha: '50900', commission_poisha: '226800', charge_poisha: '8864', business_charge_poisha: '8864', customer_charge_poisha: '0', net_poisha: '304336', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L6' },
    { id: '7', entry_date: '2026-10-07', customer_name: 'Azlan', sub_qty: 1, method_id: 'visa', gross_poisha: '330000', vat_poisha: '30000', commission_poisha: '126000', charge_poisha: '4950', business_charge_poisha: '4950', customer_charge_poisha: '0', net_poisha: '169050', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L7' },
    { id: '8', entry_date: '2026-10-08', customer_name: 'Mandisha', sub_qty: 1, method_id: 'cash', gross_poisha: '330000', vat_poisha: '30000', commission_poisha: '126000', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '174000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L8' },
    { id: '9', entry_date: '2026-10-09', customer_name: 'Autnika', sub_qty: 1, method_id: 'cash', gross_poisha: '330000', vat_poisha: '30000', commission_poisha: '126000', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '174000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L9' },
    { id: '10', entry_date: '2026-10-10', customer_name: 'Tridha', sub_qty: 2, method_id: 'visa', gross_poisha: '590900', vat_poisha: '50900', commission_poisha: '226800', charge_poisha: '8864', business_charge_poisha: '8864', customer_charge_poisha: '0', net_poisha: '304336', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L10' },
  ];

  it('reproduces exact paper ledger fixture totals and verifies conservation identity (PRD §6.6, §10)', () => {
    const report = computeMonthlyAggregates(fixtures, '2026-10');

    // Assert exact PRD §6.6 totals
    expect(report.totalEntries).toBe(10);
    expect(report.totalSubQty).toBe(16);
    expect(report.totalGrossPoisha).toBe(5112900n);
    expect(report.totalVatPoisha).toBe(432900n);
    expect(report.totalCommissionPoisha).toBe(1965600n);
    expect(report.totalBusinessChargesPoisha).toBe(50913n); // bKash 6,795 + Card 44,118
    expect(report.totalNetPoisha).toBe(2663487n);

    // Conservation check: vat + commission + fee + net === gross
    const componentSum = report.totalVatPoisha + report.totalCommissionPoisha + report.totalBusinessChargesPoisha + report.totalNetPoisha;
    expect(componentSum).toBe(report.totalGrossPoisha);
  });

  it('computes daily breakdowns whose sums equal monthly summary totals (PRD §8.3)', () => {
    const report = computeMonthlyAggregates(fixtures, '2026-10');

    expect(report.dailyBreakdowns.length).toBe(10);

    const sumDailyGross = report.dailyBreakdowns.reduce((acc, d) => acc + d.grossPoisha, 0n);
    const sumDailyVat = report.dailyBreakdowns.reduce((acc, d) => acc + d.vatPoisha, 0n);
    const sumDailyComm = report.dailyBreakdowns.reduce((acc, d) => acc + d.commissionPoisha, 0n);
    const sumDailyFee = report.dailyBreakdowns.reduce((acc, d) => acc + d.businessChargePoisha, 0n);
    const sumDailyNet = report.dailyBreakdowns.reduce((acc, d) => acc + d.netPoisha, 0n);
    const sumDailyQty = report.dailyBreakdowns.reduce((acc, d) => acc + d.subQty, 0);

    expect(sumDailyGross).toBe(report.totalGrossPoisha);
    expect(sumDailyVat).toBe(report.totalVatPoisha);
    expect(sumDailyComm).toBe(report.totalCommissionPoisha);
    expect(sumDailyFee).toBe(report.totalBusinessChargesPoisha);
    expect(sumDailyNet).toBe(report.totalNetPoisha);
    expect(sumDailyQty).toBe(report.totalSubQty);
  });

  it('computes method volumes and charges accurately (PRD §8.3)', () => {
    const report = computeMonthlyAggregates(fixtures, '2026-10');

    const bkash = report.methodCharges.find((m) => m.methodId === 'bkash');
    expect(bkash).toBeDefined();
    expect(bkash?.entryCount).toBe(1);
    expect(bkash?.totalGrossPoisha).toBe(590900n);
    expect(bkash?.totalBusinessChargePoisha).toBe(6795n);

    const visa = report.methodCharges.find((m) => m.methodId === 'visa');
    expect(visa).toBeDefined();
    expect(visa?.entryCount).toBe(5);
    expect(visa?.totalGrossPoisha).toBe(2941100n); // 838400 + 590900*3 + 330000
    expect(visa?.totalBusinessChargePoisha).toBe(44118n);

    const cash = report.methodCharges.find((m) => m.methodId === 'cash');
    expect(cash).toBeDefined();
    expect(cash?.entryCount).toBe(4);
    expect(cash?.totalGrossPoisha).toBe(1580900n); // 330000*3 + 590900
    expect(cash?.totalBusinessChargePoisha).toBe(0n);
  });

  it('isolates customer-paid fees and excludes voided, superseded, and rejected entries (PRD §8.3, §10)', () => {
    const entries: LocalEntry[] = [
      {
        id: 'e1',
        entry_date: '2026-10-15',
        customer_name: 'Active Customer',
        sub_qty: 1,
        method_id: 'bkash',
        gross_poisha: '100000',
        vat_poisha: '0',
        commission_poisha: '42000',
        charge_poisha: '1850',
        business_charge_poisha: '0',
        customer_charge_poisha: '1850', // Borne by customer
        net_poisha: '58000',
        status: 'active',
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '',
        stale_rates: false,
        rate_profile_id: 'p1',
        local_id: '#L1',
      },
      {
        id: 'e2',
        entry_date: '2026-10-16',
        customer_name: 'Voided Customer',
        sub_qty: 2,
        method_id: 'bkash',
        gross_poisha: '200000',
        vat_poisha: '0',
        commission_poisha: '84000',
        charge_poisha: '2300',
        business_charge_poisha: '2300',
        customer_charge_poisha: '0',
        net_poisha: '113700',
        status: 'voided', // Must be excluded
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '',
        stale_rates: false,
        rate_profile_id: 'p1',
        local_id: '#L2',
      },
      {
        id: 'e3',
        entry_date: '2026-10-17',
        customer_name: 'Superseded Customer',
        sub_qty: 1,
        method_id: 'visa',
        gross_poisha: '50000',
        vat_poisha: '0',
        commission_poisha: '21000',
        charge_poisha: '750',
        business_charge_poisha: '750',
        customer_charge_poisha: '0',
        net_poisha: '28250',
        status: 'superseded', // Must be excluded
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '',
        stale_rates: false,
        rate_profile_id: 'p1',
        local_id: '#L3',
      },
      {
        id: 'e4',
        entry_date: '2026-10-18',
        customer_name: 'Rejected Push Customer',
        sub_qty: 1,
        method_id: 'cash',
        gross_poisha: '80000',
        vat_poisha: '0',
        commission_poisha: '33600',
        charge_poisha: '0',
        business_charge_poisha: '0',
        customer_charge_poisha: '0',
        net_poisha: '46400',
        status: 'active',
        sync_status: 'rejected', // Rejected by server: MUST be excluded from reports
        created_by: 'u1',
        created_at: '',
        stale_rates: false,
        rate_profile_id: 'p1',
        local_id: '#L4',
      },
    ];

    const report = computeMonthlyAggregates(entries, '2026-10');

    expect(report.totalEntries).toBe(1);
    expect(report.totalGrossPoisha).toBe(100000n);
    expect(report.totalBusinessChargesPoisha).toBe(0n);
    expect(report.totalCustomerChargesPoisha).toBe(1850n);
    expect(report.totalNetPoisha).toBe(58000n);
  });

  it('computes month-over-month deltas with directional indicators (PRD §8.3)', () => {
    const current = computeMonthlyAggregates(fixtures, '2026-10');
    // Prior month with half the volume
    const priorFixtures = fixtures.slice(0, 5).map((f) => ({ ...f, entry_date: '2026-09-01' }));
    const prior = computeMonthlyAggregates(priorFixtures, '2026-09');

    const delta = computeMonthOverMonthDelta(current, prior);

    expect(delta.grossDeltaPoisha).toBeGreaterThan(0n);
    expect(delta.grossDeltaPercent).toBeGreaterThan(0);
    expect(delta.commissionDeltaPoisha).toBeGreaterThan(0n);
    expect(delta.netDeltaPoisha).toBeGreaterThan(0n);

    // Zero prior month edge case
    const zeroPrior = computeMonthlyAggregates([], '2026-09');
    const zeroDelta = computeMonthOverMonthDelta(current, zeroPrior);
    expect(zeroDelta.grossDeltaPercent).toBeNull();
  });

  it('validates month format using Zod MonthSchema (Hard Rule 11)', () => {
    expect(() => MonthSchema.parse('2026-10')).not.toThrow();
    expect(() => MonthSchema.parse('2026-01')).not.toThrow();
    expect(() => MonthSchema.parse('')).toThrow();
    expect(() => MonthSchema.parse('2026-13')).toThrow();
    expect(() => MonthSchema.parse('invalid')).toThrow();
  });

  it('generates RFC 4180 CSV export with UTF-8 BOM, formula injection defense, and totals row (PRD §8.3, §16.3 #2)', () => {
    const methodsMap: Record<string, CachedPaymentMethod> = {
      'm-bkash-uuid': {
        id: 'm-bkash-uuid',
        code: 'bkash',
        name: 'bKash Merchant',
        requires_txn_ref: true,
        display_order: 1,
        active: true,
      },
    };

    const entries: LocalEntry[] = [
      {
        id: '1',
        entry_number: 'E-202610-000001',
        local_id: '#LOCAL-000001',
        entry_date: '2026-10-01',
        customer_name: '=cmd|"/C calc"!A0', // Potential CSV formula injection attack
        sub_qty: 2,
        method_id: 'm-bkash-uuid',
        gross_poisha: '590900', // 5909.00
        vat_poisha: '50900', // 509.00
        commission_poisha: '226800', // 2268.00
        charge_poisha: '6795', // 67.95
        business_charge_poisha: '6795', // 67.95 (must NOT truncate to 67)
        customer_charge_poisha: '0',
        net_poisha: '306405', // 3064.05 (must NOT truncate to 3064)
        txn_ref: 'TXN-001,REF',
        notes: 'Line 1\r\nLine 2',
        status: 'active',
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '',
        stale_rates: false,
        rate_profile_id: 'p1',
      },
    ];

    // Assert exact 2-decimal formatting helper
    expect(formatPoishaForCsv('6795')).toBe('67.95');
    expect(formatPoishaForCsv('306405')).toBe('3064.05');
    expect(formatPoishaForCsv('100')).toBe('1.00');
    expect(formatPoishaForCsv('5')).toBe('0.05');

    // Assert formula injection defense
    expect(escapeCsvField('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    expect(escapeCsvField('+1234')).toBe("'+1234");
    expect(escapeCsvField('-4567')).toBe("'-4567");
    expect(escapeCsvField('@special')).toBe("'@special");

    // Assert RFC 4180 escaping
    expect(escapeCsvField('Hello, World')).toBe('"Hello, World"');
    expect(escapeCsvField('He said "Hi"')).toBe('"He said ""Hi"""');
    expect(escapeCsvField('Line1\rLine2')).toBe('"Line1\rLine2"');

    const csv = formatMonthlyReportCsv(entries, methodsMap);

    // Verify UTF-8 BOM
    expect(csv.startsWith('\uFEFF')).toBe(true);

    // Verify CSV headers
    expect(csv).toContain(
      'Entry Number,Date,Status,Customer,Sub Qty,Method,Gross (BDT),VAT Mode,VAT (BDT),Commission (BDT),Merchant Fee (BDT),Customer Fee (BDT),Net (BDT),Rate Version,Txn Ref,Notes'
    );

    // Verify formula injection sanitized with prepended single quote
    expect(csv).toContain("'=cmd");

    // Verify method name and 2-decimal money
    expect(csv).toContain('bKash Merchant');
    expect(csv).toContain('5909.00,manual,509.00,2268.00,67.95,0.00,3064.05');

    // Verify fixed Totals row present in CSV matching summary totals
    expect(csv).toContain('TOTALS,,,,2,,5909.00,,509.00,2268.00,67.95,0.00,3064.05,,,');
  });

  it('generates XML Spreadsheet 2003 (.xlsx/.xls) export with styled headers and totals (PRD §8.3)', () => {
    const xml = formatMonthlyReportXmlSpreadsheet(fixtures, '2026-10');

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"');
    expect(xml).toContain('<Worksheet ss:Name="Statement-2026-10">');
    expect(xml).toContain('<Row ss:StyleID="BoldHeader">');
    expect(xml).toContain('<Data ss:Type="String">Entry Number</Data>');
    expect(xml).toContain('<Data ss:Type="String">TOTALS</Data>');
    expect(xml).toContain('51129.00'); // Total gross BDT
    expect(xml).toContain('26634.87'); // Total net BDT
  });
});
