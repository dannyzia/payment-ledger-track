import { db, type LocalEntry } from './index';
import { enqueueCreateEntry, enqueueSupersedeEntry } from './outbox';
import { getMaxKnownRateVersion } from './rates';
import type { RateSnapshot } from '@clt/calc';

export interface SaveEntryInput {
  entryDate: string;
  customerName: string;
  subQty: number;
  subDescription?: string | undefined;
  methodId: string;
  grossPoisha: bigint;
  vatPoisha: bigint;
  commissionPoisha: bigint;
  businessChargePoisha: bigint;
  customerChargePoisha: bigint;
  netPoisha: bigint;
  snapshot: RateSnapshot;
  vatInputPoisha?: bigint | undefined;
  vatOverridePoisha?: bigint | undefined;
  commissionOverridePoisha?: bigint | undefined;
  txnRef?: string | undefined;
  notes?: string | undefined;
  rateProfileId: string;
  userId: string;
  supersedesOriginalId?: string | undefined;
}

export async function saveLocalEntry(input: SaveEntryInput): Promise<LocalEntry> {
  const entryId = crypto.randomUUID().toLowerCase();
  const localBadge = `#LOCAL-${entryId.substring(0, 6)}`;
  const maxRateVersion = await getMaxKnownRateVersion();
  const totalCharge = input.businessChargePoisha + input.customerChargePoisha;

  const entryRecord: LocalEntry = {
    id: entryId,
    local_id: localBadge,
    entry_date: input.entryDate,
    customer_name: input.customerName,
    sub_qty: input.subQty,
    sub_description: input.subDescription ?? undefined,
    method_id: input.methodId,
    gross_poisha: input.grossPoisha.toString(),
    vat_poisha: input.vatPoisha.toString(),
    commission_poisha: input.commissionPoisha.toString(),
    charge_poisha: totalCharge.toString(),
    business_charge_poisha: input.businessChargePoisha.toString(),
    customer_charge_poisha: input.customerChargePoisha.toString(),
    net_poisha: input.netPoisha.toString(),
    txn_ref: input.txnRef ?? undefined,
    notes: input.notes ?? undefined,
    status: 'active',
    sync_status: 'pending',
    created_by: input.userId,
    created_at: new Date().toISOString(),
    stale_rates: false,
    rate_profile_id: input.rateProfileId,
    snapshot: input.snapshot,
    vat_input_poisha:
      input.vatInputPoisha !== undefined ? input.vatInputPoisha.toString() : undefined,
    supersedes_id: input.supersedesOriginalId ?? undefined,
  };

  // Wire payload conforming to rpc_push_sync_op, entryDtoSchema, and canonical RFC 8785 hash format
  // PRD §6.3 (F20) & chk_vat_input_mode_exclusivity: vatInputPoisha MUST be null when not manual
  const wirePayload = {
    id: entryId, // Explicit ID required by server create_entry
    entryId,
    entryDate: input.entryDate,
    customerName: input.customerName,
    subQty: input.subQty,
    subDescription: input.subDescription ?? null,
    methodId: input.methodId,
    grossPoisha: input.grossPoisha.toString(),
    snapshot: input.snapshot,
    rateSnapshot: input.snapshot,
    vatInputPoisha: input.vatInputPoisha !== undefined ? input.vatInputPoisha.toString() : null,
    vatOverridePoisha:
      input.vatOverridePoisha !== undefined ? input.vatOverridePoisha.toString() : null,
    commissionOverridePoisha:
      input.commissionOverridePoisha !== undefined
        ? input.commissionOverridePoisha.toString()
        : null,
    vatPoisha: input.vatPoisha.toString(),
    commissionPoisha: input.commissionPoisha.toString(),
    chargePoisha: totalCharge.toString(),
    businessChargePoisha: input.businessChargePoisha.toString(),
    customerChargePoisha: input.customerChargePoisha.toString(),
    netPoisha: input.netPoisha.toString(),
    netAfterDeductionsPoisha: input.netPoisha.toString(),
    txnRef: input.txnRef ?? null,
    notes: input.notes ?? null,
    rateProfileId: input.rateProfileId,
  };

  await db.transaction('rw', [db.entries, db.outbox], async () => {
    await db.entries.put(entryRecord);

    if (input.supersedesOriginalId) {
      // Mark original entry locally as superseded to prevent double-counting in offline ledger/reports
      await db.entries.update(input.supersedesOriginalId, {
        status: 'superseded',
      });

      await enqueueSupersedeEntry({
        opId: crypto.randomUUID().toLowerCase(),
        userId: input.userId,
        payload: {
          originalEntryId: input.supersedesOriginalId,
          replacement: wirePayload,
        },
        maxKnownRateVersion: maxRateVersion,
      });
    } else {
      await enqueueCreateEntry({
        opId: crypto.randomUUID().toLowerCase(),
        userId: input.userId,
        payload: wirePayload,
        maxKnownRateVersion: maxRateVersion,
      });
    }
  });

  return entryRecord;
}

export async function checkDuplicate(input: {
  entryDate: string;
  methodId: string;
  txnRef?: string | undefined;
  customerName: string;
  grossPoisha: bigint;
  excludeEntryId?: string | undefined;
}): Promise<boolean> {
  let activeEntries = await db.entries
    .where('entry_date')
    .equals(input.entryDate)
    .filter((e) => e.status === 'active')
    .toArray();

  if (input.excludeEntryId) {
    activeEntries = activeEntries.filter((e) => e.id !== input.excludeEntryId);
  }

  if (input.txnRef) {
    const normRef = input.txnRef.trim().toUpperCase();
    const hasRefMatch = activeEntries.some(
      (e) => e.method_id === input.methodId && e.txn_ref?.toUpperCase() === normRef,
    );
    if (hasRefMatch) return true;
  }

  const grossStr = input.grossPoisha.toString();
  return activeEntries.some(
    (e) =>
      e.customer_name.toLowerCase() === input.customerName.toLowerCase() &&
      e.gross_poisha === grossStr,
  );
}
