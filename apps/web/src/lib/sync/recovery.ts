import { db } from '$lib/db';
import { calculateEntry, type RateSnapshot } from '@clt/calc';
import { getOrGenerateDeviceId } from '$lib/auth/device';
import { syncRunner } from './runner.svelte';

export type OutboxRecoveryState =
  | 'rejected_closed_month'
  | 'error_rate_profile'
  | 'error_clock_skew'
  | 'needs_admin_review'
  | 'error_hash_mismatch'
  | 'error_id_conflict'
  | 'error_calc_mismatch'
  | 'error_invalid_snapshot'
  | 'error_missing_ref'
  | 'error_deactivated'
  | 'failed_needs_review'
  | 'error_device_id'
  | 'blocked_upgrade_required'
  | 'error_reconcile_mismatch'
  | 'error_variance_tolerance'
  | 'blocked_device_revoked'
  | 'error_missing_watermark'
  | 'error_no_profile_for_date'
  | 'error_invalid_superseded_op'
  | 'error_missing_discard_reason'
  | 'synced';

export type RejectionAction =
  | 'retry_fresh_id'
  | 'adjust_clock'
  | 'move_to_review'
  | 'halt_execution'
  | 'drop_op'
  | 're_snapshot'
  | 'refresh_pull';

export interface RejectionResolution {
  action: RejectionAction;
  outboxState: OutboxRecoveryState;
  uiMessage: string;
}

/**
 * Complete 25-reason Rejection Recovery Matrix conforming verbatim to PRD §9.2.2.
 */
export const REJECTION_MATRIX: Record<string, RejectionResolution> = {
  month_closed: {
    action: 'move_to_review',
    outboxState: 'rejected_closed_month',
    uiMessage: 'Needs Attention: Historical month closed by Owner',
  },
  rate_profile_date_mismatch: {
    action: 'move_to_review',
    outboxState: 'error_rate_profile',
    uiMessage: 'Rate Profile Date Mismatch: Re-verify applicable rate profile',
  },
  future_timestamp_skew: {
    action: 'adjust_clock',
    outboxState: 'error_clock_skew',
    uiMessage: 'Device clock inaccurate: Adjusting timestamp delta',
  },
  queue_expired_needs_review: {
    action: 'move_to_review',
    outboxState: 'needs_admin_review',
    uiMessage: 'Long-term Offline Batch (>90d): Admin approval required',
  },
  payload_hash_mismatch: {
    action: 'retry_fresh_id',
    outboxState: 'error_hash_mismatch',
    uiMessage: 'Sync transport integrity failure: Regenerating hash',
  },
  op_id_conflict_tampered: {
    action: 'retry_fresh_id',
    outboxState: 'error_id_conflict',
    uiMessage: 'Operation ID collision: Regenerating fresh UUID',
  },
  calc_mismatch: {
    action: 'move_to_review',
    outboxState: 'error_calc_mismatch',
    uiMessage: 'Calculation discrepancy: Rate re-verification required',
  },
  invalid_snapshot_rules: {
    action: 're_snapshot',
    outboxState: 'error_invalid_snapshot',
    uiMessage: 'Rate snapshot rejected: Refreshing profile cache',
  },
  missing_txn_ref: {
    action: 'move_to_review',
    outboxState: 'error_missing_ref',
    uiMessage: 'Transaction reference required for this method',
  },
  user_deactivated: {
    action: 'halt_execution',
    outboxState: 'error_deactivated',
    uiMessage: 'User account deactivated: Outbox paused',
  },
  parent_entry_not_found: {
    action: 'move_to_review',
    outboxState: 'failed_needs_review',
    uiMessage: 'Referenced original entry not found on server',
  },
  cannot_void_non_active: {
    action: 'drop_op',
    outboxState: 'failed_needs_review',
    uiMessage: 'Entry is already inactive and cannot be voided',
  },
  cannot_supersede_non_active: {
    action: 'drop_op',
    outboxState: 'failed_needs_review',
    uiMessage: 'Entry is already inactive and cannot be superseded',
  },
  entry_not_flagged_for_stale_review: {
    action: 'refresh_pull',
    outboxState: 'failed_needs_review',
    uiMessage: 'Entry already reviewed or not flagged for stale review',
  },
  missing_device_id: {
    action: 'retry_fresh_id',
    outboxState: 'error_device_id',
    uiMessage: 'Device identifier missing: Regenerating local device ID',
  },
  invalid_device_id: {
    action: 'retry_fresh_id',
    outboxState: 'error_device_id',
    uiMessage: 'Invalid device identifier: Regenerating RFC 4122 v4 UUID',
  },
  upgrade_required: {
    action: 'halt_execution',
    outboxState: 'blocked_upgrade_required',
    uiMessage: 'Application update required: Calculation rules updated',
  },
  expected_poisha_mismatch: {
    action: 'refresh_pull',
    outboxState: 'error_reconcile_mismatch',
    uiMessage: 'Statement expected liability mismatch: Refreshing ledger totals',
  },
  variance_exceeds_tolerance: {
    action: 'move_to_review',
    outboxState: 'error_variance_tolerance',
    uiMessage: 'Variance exceeds tolerance: Explanatory note required',
  },
  device_revoked: {
    action: 'halt_execution',
    outboxState: 'blocked_device_revoked',
    uiMessage: 'Device access revoked by administrator: Outbox halted',
  },
  missing_rate_watermark: {
    action: 'retry_fresh_id',
    outboxState: 'error_missing_watermark',
    uiMessage: 'Rate watermark missing: Attaching cached rate version',
  },
  no_rate_profile_for_date: {
    action: 'move_to_review',
    outboxState: 'error_no_profile_for_date',
    uiMessage: 'No published rate profile covers this transaction date',
  },
  invalid_superseded_op: {
    action: 'retry_fresh_id',
    outboxState: 'error_invalid_superseded_op',
    uiMessage: 'Invalid superseded op reference: Retrying as clean fresh op',
  },
  missing_discard_reason: {
    action: 'move_to_review',
    outboxState: 'error_missing_discard_reason',
    uiMessage: 'Non-empty reason required to discard rejected entry',
  },
  duplicate: {
    action: 'drop_op',
    outboxState: 'synced',
    uiMessage: 'Operation already applied on server (idempotent duplicate)',
  },
};

/**
 * Handles server op rejection, recording in db.rejectedOps, executing automated
 * recovery actions, and rolling back ghost entries where applicable (PRD §9.2.2).
 */
export async function handleOpRejection(
  opId: string,
  reason: string,
  serverDateHeader?: string,
): Promise<void> {
  const resolution = REJECTION_MATRIX[reason] || {
    action: 'move_to_review',
    outboxState: 'failed_needs_review',
    uiMessage: `Server rejected operation: ${reason}`,
  };

  const op = await db.outbox.get(opId);
  if (!op) return;

  // Extract affected entry identifier across all mutation types
  let entryId: string | undefined = undefined;
  if (op.type === 'create_entry' || op.type === 'void_entry' || op.type === 'request_void') {
    entryId = op.payload.entryId as string | undefined;
  } else if (op.type === 'supersede_entry') {
    const replacement = op.payload.replacement as Record<string, unknown> | undefined;
    entryId =
      (replacement?.entryId as string | undefined) ??
      (op.payload.replacementEntryId as string | undefined);
  }

  // 1. Ghost entry rollback on rejected supersede or void (PRD §9.2.2 M-3)
  // Delete uncommitted replacement entries; revert locally-superseded originals to active (ghost rollback per plan §2 Scope)
  if (reason === 'cannot_supersede_non_active' && op.type === 'supersede_entry') {
    const replacementId = entryId;
    const originalId = op.payload.originalEntryId as string | undefined;
    if (replacementId) {
      await db.entries.delete(replacementId);
    }
    if (originalId) {
      // The local-only supersede never committed: restore the original to the ledger (Plan 011 ghost rollback)
      await db.entries.update(originalId, {
        status: 'active',
        sync_status: 'synced',
      });
    }
    await db.outbox.delete(opId);
    await db.rejectedOps.put({
      opId,
      entry_id: entryId,
      error_code: reason,
      error_message: resolution.uiMessage,
      rejected_at: new Date().toISOString(),
      status: 'discarded',
      payload: op.payload,
    });
    return;
  }

  if (
    reason === 'cannot_void_non_active' &&
    (op.type === 'void_entry' || op.type === 'request_void')
  ) {
    if (entryId) {
      await db.entries.update(entryId, {
        void_requested_by: undefined,
        void_reason: undefined,
        sync_status: 'synced',
      });
    }
    await db.outbox.delete(opId);
    await db.rejectedOps.put({
      opId,
      entry_id: entryId,
      error_code: reason,
      error_message: resolution.uiMessage,
      rejected_at: new Date().toISOString(),
      status: 'discarded',
      payload: op.payload,
    });
    return;
  }

  // 2. Duplicate handling: drop op from outbox and ensure local entry is marked synced
  if (resolution.action === 'drop_op' || reason === 'duplicate') {
    await db.outbox.delete(opId);
    if (entryId) {
      await db.entries.update(entryId, { sync_status: 'synced' });
    }
    return;
  }

  // 3. Automated recovery execution
  if (resolution.action === 'adjust_clock' && serverDateHeader) {
    const serverTimeMs = Date.parse(serverDateHeader);
    if (!isNaN(serverTimeMs)) {
      const deltaMs = serverTimeMs - Date.now();
      const reconciledCreatedAt = new Date(Date.now() + deltaMs).toISOString();

      const freshOpId = crypto.randomUUID().toLowerCase();
      await db.outbox.delete(opId);
      await db.outbox.put({
        ...op,
        opId: freshOpId,
        supersedesRejectedOpId: opId,
        clientCreatedAt: reconciledCreatedAt,
        status: 'pending',
        outboxState: undefined,
        rejectionReason: undefined,
      });
      return;
    }
  }

  if (resolution.action === 'retry_fresh_id') {
    const updatedPayload = { ...op.payload };
    let updatedWatermark = op.maxKnownRateVersion;

    if (reason === 'missing_rate_watermark') {
      const profiles = await db.rateProfiles.toArray();
      const maxVer = profiles.length > 0 ? Math.max(...profiles.map((p) => p.version)) : 1;
      updatedWatermark = maxVer;
    }

    if (reason === 'missing_device_id' || reason === 'invalid_device_id') {
      getOrGenerateDeviceId(); // Regenerates clean RFC 4122 v4 lowercase UUID in storage
    }

    // Do not attach supersedesRejectedOpId if the failed op never committed a sync_ops row on server
    const shouldOmitSupersededId =
      reason === 'invalid_superseded_op' ||
      reason === 'missing_device_id' ||
      reason === 'invalid_device_id';

    const freshOpId = crypto.randomUUID().toLowerCase();
    await db.outbox.delete(opId);
    await db.outbox.put({
      ...op,
      opId: freshOpId,
      supersedesRejectedOpId: shouldOmitSupersededId ? undefined : opId,
      payload: updatedPayload,
      maxKnownRateVersion: updatedWatermark,
      status: 'pending',
      outboxState: undefined,
      rejectionReason: undefined,
    });
    return;
  }

  if (resolution.action === 'halt_execution') {
    syncRunner.stop();
    if (reason === 'upgrade_required' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('clt:upgrade-required'));
    }
    if (reason === 'device_revoked' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('clt:device-revoked'));
    }
    // Local entries remain preserved in Dexie with sync_status = 'pending'
    return;
  }

  // 4. Default: Record in db.rejectedOps and flag entry sync_status = 'rejected'
  await db.outbox.update(opId, {
    status: 'rejected',
    outboxState: resolution.outboxState,
    rejectionReason: reason,
    errorMessage: resolution.uiMessage,
  });

  await db.rejectedOps.put({
    opId,
    entry_id: entryId,
    error_code: reason,
    error_message: resolution.uiMessage,
    rejected_at: new Date().toISOString(),
    status: 'pending',
    payload: op.payload,
  });

  if (entryId) {
    await db.entries.update(entryId, { sync_status: 'rejected' });
  }
}

/**
 * Enforces the Global Retry Invariant (PRD §9.2.2, Finding B12, Test #3).
 * Allocates a fresh UUID opId, preserves original chronological clientCreatedAt (FIFO),
 * recomputes financial components via @clt/calc if patched, and replaces the failed op.
 */
export async function retryRejectedOp(
  failedOpId: string,
  patchedPayload?: Partial<Record<string, unknown>>,
): Promise<string> {
  const failedOp = await db.outbox.get(failedOpId);
  if (!failedOp) {
    throw new Error(`Outbox operation not found: ${failedOpId}`);
  }

  const freshOpId = crypto.randomUUID().toLowerCase();
  const updatedPayload = { ...failedOp.payload, ...(patchedPayload || {}) };

  // Re-run calculateEntry if financial inputs or overrides changed to prevent false calc_mismatch
  if (
    patchedPayload &&
    (patchedPayload.grossPoisha ||
      patchedPayload.methodId ||
      patchedPayload.vatInputPoisha ||
      patchedPayload.vatOverridePoisha ||
      patchedPayload.commissionOverridePoisha)
  ) {
    const entryId = updatedPayload.entryId as string | undefined;
    const localEntry = entryId ? await db.entries.get(entryId) : undefined;

    if (localEntry && updatedPayload.snapshot) {
      const snapshot = { ...(updatedPayload.snapshot as RateSnapshot) };

      // If method changed, update chargeBp and chargesBorneBy from method_rates in local cache
      if (patchedPayload.methodId && patchedPayload.methodId !== localEntry.method_id) {
        const profile = await db.rateProfiles.get(snapshot.rateProfileId);
        const methodRate = profile?.method_rates[patchedPayload.methodId as string];
        if (methodRate) {
          snapshot.chargeBp = methodRate.fee_bp;
          snapshot.chargesBorneBy = methodRate.charges_borne_by;
        }
      }

      const grossPoisha = BigInt((updatedPayload.grossPoisha as string) || localEntry.gross_poisha);
      const vatInputPoisha = updatedPayload.vatInputPoisha
        ? BigInt(updatedPayload.vatInputPoisha as string)
        : undefined;
      const vatOverridePoisha = updatedPayload.vatOverridePoisha
        ? BigInt(updatedPayload.vatOverridePoisha as string)
        : undefined;
      const vatOverrideReason =
        (updatedPayload.vatOverrideReason as string | undefined) ??
        (localEntry as unknown as { vat_override_reason?: string }).vat_override_reason ??
        undefined;
      const commissionOverridePoisha = updatedPayload.commissionOverridePoisha
        ? BigInt(updatedPayload.commissionOverridePoisha as string)
        : undefined;
      const commissionOverrideReason =
        (updatedPayload.commissionOverrideReason as string | undefined) ??
        (localEntry as unknown as { commission_override_reason?: string })
          .commission_override_reason ??
        undefined;

      const calcResult = calculateEntry({
        grossPoisha,
        snapshot,
        vatInputPoisha,
        vatOverridePoisha,
        vatOverrideReason,
        commissionOverridePoisha,
        commissionOverrideReason,
      });

      const totalChargeStr = calcResult.chargePoisha.toString();
      updatedPayload.grossPoisha = calcResult.grossPoisha.toString();
      updatedPayload.vatPoisha = calcResult.vatPoisha.toString();
      updatedPayload.commissionPoisha = calcResult.commissionPoisha.toString();
      updatedPayload.chargePoisha = totalChargeStr;
      updatedPayload.businessChargePoisha = calcResult.businessChargePoisha.toString();
      updatedPayload.customerChargePoisha = calcResult.customerChargePoisha.toString();
      updatedPayload.netPoisha = calcResult.netAfterDeductionsPoisha.toString();
      updatedPayload.netAfterDeductionsPoisha = calcResult.netAfterDeductionsPoisha.toString();
      updatedPayload.snapshot = snapshot;

      await db.entries.update(entryId as string, {
        ...(patchedPayload.methodId ? { method_id: patchedPayload.methodId as string } : {}),
        gross_poisha: calcResult.grossPoisha.toString(),
        vat_poisha: calcResult.vatPoisha.toString(),
        commission_poisha: calcResult.commissionPoisha.toString(),
        charge_poisha: totalChargeStr,
        business_charge_poisha: calcResult.businessChargePoisha.toString(),
        customer_charge_poisha: calcResult.customerChargePoisha.toString(),
        net_poisha: calcResult.netAfterDeductionsPoisha.toString(),
        sync_status: 'pending',
      });
    }
  }

  // Delete previous failed op and insert fresh op in db.outbox
  await db.outbox.delete(failedOpId);
  await db.outbox.put({
    ...failedOp,
    opId: freshOpId,
    supersedesRejectedOpId: failedOpId,
    clientCreatedAt: failedOp.clientCreatedAt, // Preserve chronological FIFO sequence
    payload: updatedPayload,
    status: 'pending',
    outboxState: undefined,
    rejectionReason: undefined,
    errorMessage: undefined,
  });

  const entryId = updatedPayload.entryId as string | undefined;
  if (entryId) {
    await db.entries.update(entryId, { sync_status: 'pending' });
  }

  return freshOpId;
}

/**
 * Discards a rejected outbox operation with an audited reason (PRD §8.4, §9.1 line 1645, Test #18).
 * Enqueues discard_rejected_entry operation and purges local entry if never synced.
 */
export async function discardRejectedOp(
  failedOpId: string,
  actorId: string,
  reason: string,
): Promise<void> {
  if (!reason || reason.trim() === '') {
    throw new Error('Discard reason cannot be empty');
  }

  const failedOp = await db.outbox.get(failedOpId);
  if (failedOp) {
    const entryId = failedOp.payload.entryId as string | undefined;

    // If local entry was never synced to the server, purge from local Dexie table
    if (entryId) {
      const entry = await db.entries.get(entryId);
      if (entry && !entry.server_seq) {
        await db.entries.delete(entryId);
      }
    }

    // Allocate fresh UUID for discard operation conforming to Global Retry Invariant
    const discardOpId = crypto.randomUUID().toLowerCase();
    await db.outbox.delete(failedOpId);
    await db.outbox.put({
      opId: discardOpId,
      userId: actorId,
      type: 'discard_rejected_entry',
      payload: {
        rejectedOpId: failedOpId, // Aligned strictly with PRD §9.1 and Plan 004
        discardedOpId: failedOpId, // Backward-compatible alias
        actorId,
        reason: reason.trim(),
      },
      clientCreatedAt: new Date().toISOString(),
      maxKnownRateVersion: failedOp.maxKnownRateVersion,
      status: 'pending',
    });
  }

  const discardedRow = await db.rejectedOps.get(failedOpId);
  if (discardedRow) {
    await db.rejectedOps.update(failedOpId, {
      status: 'discarded',
    });
  } else {
    // The failed op never produced a local rejectedOps row (e.g. rejected before local recording): upsert defensively
    const discardedEntryId = (failedOp?.payload?.entryId as string | undefined) ?? undefined;
    await db.rejectedOps.put({
      opId: failedOpId,
      entry_id: discardedEntryId,
      error_code: 'discarded_by_user',
      error_message: reason,
      rejected_at: new Date().toISOString(),
      status: 'discarded',
      payload: failedOp?.payload ?? {},
    });
  }
}
