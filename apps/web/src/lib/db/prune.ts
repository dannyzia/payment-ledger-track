import { type Table } from 'dexie';
import { db, type CosmoDatabase } from './index';

interface ProtectedConfigIds {
  methodIds: Set<string>;
  rateProfileIds: Set<string>;
  entryIds: Set<string>;
}

function collectPayloadRefs(
  payload: Record<string, unknown> | undefined,
  ids: ProtectedConfigIds,
): void {
  if (!payload) return;

  if (typeof payload.methodId === 'string' && payload.methodId) {
    ids.methodIds.add(payload.methodId);
  }
  if (typeof payload.rateProfileId === 'string' && payload.rateProfileId) {
    ids.rateProfileIds.add(payload.rateProfileId);
  }
  const snapshot = payload.snapshot;
  if (snapshot && typeof snapshot === 'object') {
    const rpId = (snapshot as Record<string, unknown>).rateProfileId;
    if (typeof rpId === 'string' && rpId) {
      ids.rateProfileIds.add(rpId);
    }
  }
  if (typeof payload.entryId === 'string' && payload.entryId) {
    ids.entryIds.add(payload.entryId);
  }
  if (typeof payload.originalEntryId === 'string' && payload.originalEntryId) {
    ids.entryIds.add(payload.originalEntryId);
  }

  const replacement = payload.replacement;
  if (replacement && typeof replacement === 'object') {
    collectPayloadRefs(replacement as Record<string, unknown>, ids);
  }
}

/**
 * Collects method, rate-profile, and entry IDs still referenced by unsynced or
 * unresolved local operations so config/cache pruning never orphans queued offline work.
 */
async function collectProtectedConfigIds(
  database: CosmoDatabase = db,
): Promise<ProtectedConfigIds> {
  const ids: ProtectedConfigIds = {
    methodIds: new Set<string>(),
    rateProfileIds: new Set<string>(),
    entryIds: new Set<string>(),
  };

  const outboxRows = (await database.outbox?.toArray()) ?? [];
  for (const op of outboxRows) {
    if (op.status === 'resolved') continue;
    collectPayloadRefs(op.payload, ids);
  }

  const rejectedRows = (await database.rejectedOps?.toArray()) ?? [];
  for (const row of rejectedRows) {
    if (row.status === 'resolved' || row.status === 'discarded') continue;
    if (row.entry_id) ids.entryIds.add(row.entry_id);
    collectPayloadRefs(row.payload, ids);
  }

  const entryRows = (await database.entries?.toArray()) ?? [];
  for (const entry of entryRows) {
    if (entry.sync_status === 'pending' || entry.sync_status === 'rejected') {
      ids.entryIds.add(entry.id);
      if (entry.method_id) ids.methodIds.add(entry.method_id);
      if (entry.rate_profile_id) ids.rateProfileIds.add(entry.rate_profile_id);
      if (entry.snapshot?.rateProfileId) ids.rateProfileIds.add(entry.snapshot.rateProfileId);
    }
  }

  return ids;
}

async function pruneStaleRows<T>(
  table: Table<T, string>,
  getKey: (row: T) => string,
  deliveredKeys: string[],
  protectedKeys?: Set<string>,
  predicate?: (row: T) => boolean,
): Promise<number> {
  const delivered = new Set(deliveredKeys);
  const rows = await table.toArray();
  const staleKeys = rows
    .filter((row) => {
      if (predicate && !predicate(row)) return false;
      const key = getKey(row);
      if (delivered.has(key)) return false;
      if (protectedKeys?.has(key)) return false;
      return true;
    })
    .map(getKey);

  if (staleKeys.length > 0) {
    await table.bulkDelete(staleKeys);
  }
  return staleKeys.length;
}

/**
 * Removes cached payment methods the server no longer returns (CLT-R-026),
 * preserving any method still referenced by pending outbox/rejected operations.
 */
export async function pruneReplacedMethods(
  deliveredIds: string[],
  database: CosmoDatabase = db,
): Promise<number> {
  const protectedIds = await collectProtectedConfigIds(database);
  return pruneStaleRows(database.methods, (m) => m.id, deliveredIds, protectedIds.methodIds);
}

/**
 * Removes cached published rate profiles the server no longer returns (CLT-R-026).
 * Drafts and any profile referenced by queued outbox/rejected operations are kept.
 */
export async function pruneReplacedRateProfiles(
  deliveredIds: string[],
  database: CosmoDatabase = db,
): Promise<number> {
  const protectedIds = await collectProtectedConfigIds(database);
  return pruneStaleRows(
    database.rateProfiles,
    (p) => p.id,
    deliveredIds,
    protectedIds.rateProfileIds,
    (p) => p.status === 'published',
  );
}

export async function pruneReplacedPayables(
  deliveredIds: string[],
  database: CosmoDatabase = db,
): Promise<number> {
  return pruneStaleRows(database.payables, (p) => p.id, deliveredIds);
}

export async function pruneReplacedMonthCloses(
  deliveredMonths: string[],
  database: CosmoDatabase = db,
): Promise<number> {
  return pruneStaleRows(database.monthCloses, (c) => c.month, deliveredMonths);
}

export async function pruneReplacedProfiles(
  deliveredIds: string[],
  database: CosmoDatabase = db,
): Promise<number> {
  return pruneStaleRows(database.profiles, (p) => p.id, deliveredIds);
}

export async function pruneReplacedSettlements(
  deliveredIds: string[],
  database: CosmoDatabase = db,
): Promise<number> {
  return pruneStaleRows(database.settlements, (s) => s.id, deliveredIds);
}

export async function pruneReplacedStatements(
  deliveredIds: string[],
  database: CosmoDatabase = db,
): Promise<number> {
  return pruneStaleRows(database.statements, (s) => s.id, deliveredIds);
}

/**
 * Drops server-synced entry rows after a watermark reset (`409`/`410`) or
 * super-admin center switch while preserving local unsynced/rejected entries.
 */
export async function clearSyncedEntries(database: CosmoDatabase = db): Promise<number> {
  const protectedIds = await collectProtectedConfigIds(database);
  const rows = await database.entries.toArray();
  const staleIds = rows
    .filter((entry) => entry.sync_status === 'synced' && !protectedIds.entryIds.has(entry.id))
    .map((entry) => entry.id);

  if (staleIds.length > 0) {
    await database.entries.bulkDelete(staleIds);
  }
  return staleIds.length;
}

/**
 * Clears center-scoped cached stores in the shared super-admin database before
 * switching `clt_super_center`, resetting `server_cursor` to `'0'` while
 * preserving any unsynced outbox/rejected operations and their referenced IDs.
 */
export async function clearSuperCenterCache(database: CosmoDatabase = db): Promise<void> {
  const protectedIds = await collectProtectedConfigIds(database);
  await clearSyncedEntries(database);

  await pruneStaleRows(database.methods, (m) => m.id, [], protectedIds.methodIds);
  await pruneStaleRows(database.rateProfiles, (p) => p.id, [], protectedIds.rateProfileIds);

  await Promise.all([
    database.payables.clear(),
    database.monthCloses.clear(),
    database.profiles.clear(),
    database.settlements.clear(),
    database.settlementPayments.clear(),
    database.statements.clear(),
    database.statementLines.clear(),
  ]);

  await database.meta.put({
    key: 'server_cursor',
    value: '0',
    updated_at: new Date().toISOString(),
  });
}
