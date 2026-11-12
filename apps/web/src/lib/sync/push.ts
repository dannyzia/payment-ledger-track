import { db, type LocalEntry, type LocalOutboxOp } from '$lib/db';
import { getOrGenerateDeviceId } from '$lib/auth/device';
import { supabase } from '$lib/supabase/client';
import { session } from '$lib/auth/session.svelte';
import { computeJcsSha256 } from './canonical';
import { handleOpRejection } from './recovery';

function resolveActiveSuperCenter(): string | null {
  if (session.user?.role !== 'super_admin' || typeof sessionStorage === 'undefined') {
    return null;
  }
  try {
    const activeCenter = sessionStorage.getItem('clt_super_center');
    return activeCenter && activeCenter !== 'all' ? activeCenter : null;
  } catch {
    return null;
  }
}

function getOpCenterId(op: LocalOutboxOp): string | null {
  if (typeof op.payload.centerId === 'string' && op.payload.centerId) {
    return op.payload.centerId;
  }
  const replacement = op.payload.replacement;
  if (replacement && typeof replacement === 'object') {
    const replacementCenter = (replacement as Record<string, unknown>).centerId;
    if (typeof replacementCenter === 'string' && replacementCenter) {
      return replacementCenter;
    }
  }
  return typeof op.centerId === 'string' && op.centerId ? op.centerId : null;
}

export interface PushResultItem {
  opId: string;
  status: 'ok' | 'duplicate' | 'rejected';
  server_seq?: string | number;
  entry_number?: string | number;
  reason?: string;
}

export interface PushBatchResponse {
  results: PushResultItem[];
}

/**
 * Sends one push batch.
 *
 * A transport failure (no route to the server) is not a sync error: the ops are
 * still queued locally and nothing was lost, so staff must see "Offline", not
 * "Sync error" (CLT-R-016). It raises the same `network_offline` signal that
 * `pull.ts` raises, which `runner.svelte.ts` maps to the offline state.
 */
async function postPush(body: string, token: string | null): Promise<Response> {
  try {
    return await fetch('/api/v1/sync/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    });
  } catch {
    throw new Error('network_offline');
  }
}

/**
 * Exhaustively flushes pending client outbox operations in batches of at most 50 ops per request.
 * Scoped to the currently authenticated user's session to prevent cross-user attribution
 * on shared counter devices (PRD Test #62). Protected against infinite loops via iteration cap.
 */
export async function flushOutboxPush(): Promise<{
  success: boolean;
  pushedCount: number;
  reason?: 'no_session';
}> {
  let totalPushed = 0;
  let iterations = 0;
  const MAX_ITERATIONS = 20; // 20 * 50 = 1,000 ops maximum per sync cycle

  // Retrieve active session token and user ID
  const {
    data: { session: sbSession },
  } = await supabase.auth.getSession();
  if (!sbSession?.user?.id) {
    // CLT-R-015: no Supabase session means signed out, not a sync failure. The
    // caller sends the user to /login instead of showing a generic error.
    return { success: false, pushedCount: 0, reason: 'no_session' };
  }
  const currentUserId = sbSession.user.id;
  let token = sbSession.access_token;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Shift-handover flush (CLT-T-075): exact pending ops of the current user,
    // plus this center's ops left by a previous shift on the same tablet.
    const currentCenterId = session.user?.centerId ?? null;
    const activeSuperCenter = resolveActiveSuperCenter();
    const matchCenterId = currentCenterId ?? activeSuperCenter;
    const pendingOps = await db.outbox
      .where('status')
      .equals('pending')
      .and(
        (op) =>
          op.userId === currentUserId || (matchCenterId !== null && op.centerId === matchCenterId),
      )
      .sortBy('clientCreatedAt');

    if (pendingOps.length === 0) {
      break;
    }

    let batch: LocalOutboxOp[];
    let batchCenterId: string | null = currentCenterId;
    if (currentCenterId !== null) {
      batch = pendingOps.slice(0, 50);
    } else {
      const batchOpCenterId = getOpCenterId(pendingOps[0]);
      batchCenterId = batchOpCenterId ?? activeSuperCenter;
      batch = pendingOps
        .filter((op) => {
          const opCenterId = getOpCenterId(op);
          return opCenterId === null || opCenterId === batchCenterId;
        })
        .slice(0, 50);
    }
    const deviceId = getOrGenerateDeviceId();

    const preparedOps = await Promise.all(
      batch.map(async (op) => {
        // Every pushed payload carries centerId when resolved so the server's tenant
        // IDOR check can adjudicate; unrecoverable null-center ops are rejected by server.
        const opDeclaredCenter =
          typeof op.payload.centerId === 'string' && op.payload.centerId
            ? op.payload.centerId
            : null;
        const resolvedOpCenter = opDeclaredCenter ?? batchCenterId;
        const payloadWithCenter =
          opDeclaredCenter || resolvedOpCenter === null
            ? op.payload
            : { ...op.payload, centerId: resolvedOpCenter };
        const canonicalObj = {
          type: op.type,
          payload: payloadWithCenter,
          supersedesRejectedOpId: op.supersedesRejectedOpId ?? null,
          clientCreatedAt: op.clientCreatedAt,
          maxKnownRateVersion: op.maxKnownRateVersion,
        };
        const hash = await computeJcsSha256(canonicalObj);
        return {
          opId: op.opId,
          type: op.type,
          payload: payloadWithCenter,
          clientCreatedAt: op.clientCreatedAt,
          payloadHash: hash,
          supersedesRejectedOpId: op.supersedesRejectedOpId ?? undefined,
          maxKnownRateVersion: op.maxKnownRateVersion,
        };
      }),
    );

    const body = JSON.stringify({
      deviceId,
      ops: preparedOps,
      ...(batchCenterId !== null ? { centerId: batchCenterId } : {}),
    });
    let res = await postPush(body, token);

    // Handle token expiration: attempt automatic refresh once
    if (res.status === 401) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.data.session) {
        token = refreshed.data.session.access_token;
        res = await postPush(body, token);
      }
    }

    if (!res.ok) {
      if (res.status === 400) {
        const err = await res.json().catch(() => ({}));
        const errCode = err.error || err.message;
        if (errCode === 'missing_tenant_context') {
          const serverDateHeader = res.headers.get('Date') || undefined;
          for (const op of batch) {
            await handleOpRejection(op.opId, 'missing_tenant_context', serverDateHeader);
          }
          continue;
        }
      }
      if (res.status === 403) {
        const err = await res.json().catch(() => ({}));
        const errCode = err.error || err.message;
        if (errCode === 'device_revoked') {
          for (const op of batch) {
            await handleOpRejection(op.opId, 'device_revoked');
          }
        } else if (errCode === 'user_deactivated') {
          for (const op of batch) {
            await handleOpRejection(op.opId, 'user_deactivated');
          }
        }
      }
      return { success: false, pushedCount: totalPushed };
    }

    const serverDateHeader = res.headers.get('Date') || undefined;
    const responseData: PushBatchResponse = await res.json();
    let hasFatalRejection = false;
    let opsProgressMade = 0;

    for (const item of responseData.results) {
      const op = batch.find((o) => o.opId === item.opId);

      if (item.status === 'ok' || item.status === 'duplicate') {
        opsProgressMade++;
        await db.outbox.delete(item.opId);

        if (op?.type === 'create_entry' && op.payload.entryId) {
          const entryId = op.payload.entryId as string;
          const updates: Partial<LocalEntry> = {
            sync_status: 'synced',
          };
          if (item.server_seq !== undefined && item.server_seq !== null) {
            updates.server_seq = item.server_seq.toString();
          }
          if (
            item.entry_number !== undefined &&
            item.entry_number !== null &&
            op.payload.entryDate
          ) {
            const ym = (op.payload.entryDate as string).replace(/-/g, '').substring(0, 6);
            updates.entry_number = `E-${ym}-${item.entry_number.toString().padStart(6, '0')}`;
          }
          await db.entries.update(entryId, updates);
        } else if (op?.type === 'supersede_entry') {
          const replacement = op.payload.replacement as Record<string, unknown> | undefined;
          if (replacement?.entryId) {
            const replacementId = replacement.entryId as string;
            const updates: Partial<LocalEntry> = {
              sync_status: 'synced',
            };
            if (item.server_seq !== undefined && item.server_seq !== null) {
              updates.server_seq = item.server_seq.toString();
            }
            if (
              item.entry_number !== undefined &&
              item.entry_number !== null &&
              replacement.entryDate
            ) {
              const ym = (replacement.entryDate as string).replace(/-/g, '').substring(0, 6);
              updates.entry_number = `E-${ym}-${item.entry_number.toString().padStart(6, '0')}`;
            }
            await db.entries.update(replacementId, updates);
          }
          if (op.payload.originalEntryId) {
            await db.entries.update(op.payload.originalEntryId as string, {
              status: 'superseded',
              sync_status: 'synced',
            });
          }
        } else if (
          (op?.type === 'void_entry' || op?.type === 'request_void') &&
          op.payload.entryId
        ) {
          const newStatus = op.type === 'void_entry' ? 'voided' : 'active';
          await db.entries.update(op.payload.entryId as string, {
            status: newStatus,
            sync_status: 'synced',
          });
        }
      } else {
        opsProgressMade++;
        await handleOpRejection(item.opId, item.reason || 'unknown_rejection', serverDateHeader);
        if (
          item.reason === 'device_revoked' ||
          item.reason === 'user_deactivated' ||
          item.reason === 'upgrade_required'
        ) {
          hasFatalRejection = true;
        }
      }
    }

    // Safety guard against infinite loops: if no op changed state, abort
    if (opsProgressMade === 0) {
      throw new Error('Push stalled: Server returned zero operational results for batch');
    }

    totalPushed += batch.length;
    if (hasFatalRejection) {
      return { success: false, pushedCount: totalPushed };
    }
  }

  return { success: true, pushedCount: totalPushed };
}
