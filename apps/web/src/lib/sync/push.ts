import { db, type LocalEntry } from '$lib/db';
import { getOrGenerateDeviceId } from '$lib/auth/device';
import { supabase } from '$lib/supabase/client';
import { computeJcsSha256 } from './canonical';
import { handleOpRejection } from './recovery';

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
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    // CLT-R-015: no Supabase session means signed out, not a sync failure. The
    // caller sends the user to /login instead of showing a generic error.
    return { success: false, pushedCount: 0, reason: 'no_session' };
  }
  const currentUserId = session.user.id;
  let token = session.access_token;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Only select pending ops created by the currently logged-in user
    const pendingOps = await db.outbox
      .where('status')
      .equals('pending')
      .and((op) => op.userId === currentUserId)
      .sortBy('clientCreatedAt');

    if (pendingOps.length === 0) {
      break;
    }

    const batch = pendingOps.slice(0, 50);
    const deviceId = getOrGenerateDeviceId();

    const preparedOps = await Promise.all(
      batch.map(async (op) => {
        const canonicalObj = {
          type: op.type,
          payload: op.payload,
          supersedesRejectedOpId: op.supersedesRejectedOpId ?? null,
          clientCreatedAt: op.clientCreatedAt,
          maxKnownRateVersion: op.maxKnownRateVersion,
        };
        const hash = await computeJcsSha256(canonicalObj);
        return {
          opId: op.opId,
          type: op.type,
          payload: op.payload,
          clientCreatedAt: op.clientCreatedAt,
          payloadHash: hash,
          supersedesRejectedOpId: op.supersedesRejectedOpId ?? undefined,
          maxKnownRateVersion: op.maxKnownRateVersion,
        };
      }),
    );

    const body = JSON.stringify({ deviceId, ops: preparedOps });
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
