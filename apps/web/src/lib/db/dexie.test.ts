import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './index';
import { saveLocalEntry } from './entries';
import type { RateSnapshot } from '@clt/calc';

describe('Local-First Dexie Storage & Performance', () => {
  const defaultSnapshot: RateSnapshot = {
    rateProfileId: 'a0000000-0000-0000-0000-000000000001',
    version: 1,
    engineVersion: 1,
    vat: { mode: 'manual', bp: 0 },
    commission: { bp: 4200, base: 'gross_minus_vat' },
    chargeBp: 115,
    chargesBorneBy: 'business',
    rounding: 'half_up',
  };

  beforeEach(async () => {
    await db.entries.clear();
    await db.outbox.clear();
    await db.rateProfiles.clear();
    await db.methods.clear();

    await db.rateProfiles.put({
      id: 'a0000000-0000-0000-0000-000000000001',
      version: 1,
      status: 'published',
      effective_from: '2026-01-01',
      vat_mode: 'manual',
      vat_bp: 0,
      commission_bp: 4200,
      commission_base: 'gross_minus_vat',
      method_rates: {
        'b0000000-0000-0000-0000-000000000001': { fee_bp: 115, charges_borne_by: 'business' },
        'b0000000-0000-0000-0000-000000000002': { fee_bp: 150, charges_borne_by: 'customer' },
      },
    });

    await db.methods.bulkPut([
      {
        id: 'b0000000-0000-0000-0000-000000000001',
        code: 'bkash',
        name: 'bKash Merchant',
        requires_txn_ref: true,
        display_order: 1,
        active: true,
      },
      {
        id: 'b0000000-0000-0000-0000-000000000002',
        code: 'visa',
        name: 'Visa Card',
        requires_txn_ref: false,
        display_order: 2,
        active: true,
      },
    ]);
  });

  it('completes local entry save within 100 milliseconds', async () => {
    const start = performance.now();

    const saved = await saveLocalEntry({
      entryDate: '2026-10-29',
      customerName: 'Ziaur Rahman',
      subQty: 1,
      methodId: 'b0000000-0000-0000-0000-000000000001',
      grossPoisha: 590900n,
      vatPoisha: 50900n,
      commissionPoisha: 226800n,
      businessChargePoisha: 6795n,
      customerChargePoisha: 0n,
      netPoisha: 306405n,
      snapshot: defaultSnapshot,
      rateProfileId: 'a0000000-0000-0000-0000-000000000001',
      userId: 'u1',
    });

    const elapsed = performance.now() - start;
    expect(elapsed, `Save duration ${elapsed}ms must be < 100ms`).toBeLessThan(100);
    expect(saved.local_id).toMatch(/^#LOCAL-[0-9a-f]{6}$/);

    const outboxOps = await db.outbox.toArray();
    expect(outboxOps.length).toBe(1);
    expect(outboxOps[0].userId).toBe('u1');
    expect(outboxOps[0].maxKnownRateVersion).toBe(1);
    expect((outboxOps[0].payload as unknown as Record<string, string>).id).toBe(saved.id);
    expect((outboxOps[0].payload as unknown as Record<string, string>).grossPoisha).toBe('590900');
  });

  it('guarantees decimal strings for all monetary amounts in storage', async () => {
    await saveLocalEntry({
      entryDate: '2026-10-29',
      customerName: 'Test Customer',
      subQty: 2,
      methodId: 'b0000000-0000-0000-0000-000000000001',
      grossPoisha: 100000n,
      vatPoisha: 0n,
      commissionPoisha: 42000n,
      businessChargePoisha: 1150n,
      customerChargePoisha: 0n,
      netPoisha: 56850n,
      snapshot: defaultSnapshot,
      rateProfileId: 'a0000000-0000-0000-0000-000000000001',
      userId: 'u1',
    });

    const stored = await db.entries.toArray();
    expect(typeof stored[0].gross_poisha).toBe('string');
    expect(stored[0].gross_poisha).toBe('100000');
    expect(stored[0].snapshot).toBeDefined();
    expect(stored[0].charge_poisha).toBe('1150');
  });

  it('correctly records customer-borne fee without merchant deduction in outbox', async () => {
    const cardSnapshot: RateSnapshot = {
      ...defaultSnapshot,
      chargeBp: 150,
      chargesBorneBy: 'customer',
    };

    await saveLocalEntry({
      entryDate: '2026-10-29',
      customerName: 'Card Customer',
      subQty: 1,
      methodId: 'b0000000-0000-0000-0000-000000000002',
      grossPoisha: 100000n,
      vatPoisha: 0n,
      commissionPoisha: 42000n,
      businessChargePoisha: 0n,
      customerChargePoisha: 1500n,
      netPoisha: 58000n,
      snapshot: cardSnapshot,
      rateProfileId: 'a0000000-0000-0000-0000-000000000001',
      userId: 'u1',
    });

    const outboxOps = await db.outbox.toArray();
    expect(outboxOps[0].userId).toBe('u1');
    expect((outboxOps[0].payload as unknown as Record<string, string>).businessChargePoisha).toBe(
      '0',
    );
    expect((outboxOps[0].payload as unknown as Record<string, string>).customerChargePoisha).toBe(
      '1500',
    );
    expect(
      (outboxOps[0].payload as unknown as Record<string, string>).netAfterDeductionsPoisha,
    ).toBe('58000');
  });

  it('marks original entry locally as superseded when created in supersede mode', async () => {
    const orig = await saveLocalEntry({
      entryDate: '2026-10-29',
      customerName: 'Original Customer',
      subQty: 1,
      methodId: 'b0000000-0000-0000-0000-000000000001',
      grossPoisha: 200000n,
      vatPoisha: 0n,
      commissionPoisha: 84000n,
      businessChargePoisha: 2300n,
      customerChargePoisha: 0n,
      netPoisha: 113700n,
      snapshot: defaultSnapshot,
      rateProfileId: 'a0000000-0000-0000-0000-000000000001',
      userId: 'u1',
    });

    expect(orig.status).toBe('active');

    // Create replacement superseding orig
    const replacement = await saveLocalEntry({
      entryDate: '2026-10-29',
      customerName: 'Corrected Customer',
      subQty: 1,
      methodId: 'b0000000-0000-0000-0000-000000000001',
      grossPoisha: 200000n,
      vatPoisha: 0n,
      commissionPoisha: 84000n,
      businessChargePoisha: 2300n,
      customerChargePoisha: 0n,
      netPoisha: 113700n,
      snapshot: defaultSnapshot,
      rateProfileId: 'a0000000-0000-0000-0000-000000000001',
      userId: 'u1',
      supersedesOriginalId: orig.id,
    });

    const updatedOrig = await db.entries.get(orig.id);
    expect(updatedOrig?.status).toBe('superseded');
    expect(replacement.status).toBe('active');
  });
});
