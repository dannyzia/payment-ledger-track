import { db, type LocalOutboxOp } from './index';

export async function enqueueCreateEntry(op: {
  opId: string;
  userId: string;
  payload: Record<string, unknown>;
  maxKnownRateVersion: number;
  supersedesRejectedOpId?: string | undefined;
}): Promise<void> {
  const outboxItem: LocalOutboxOp = {
    opId: op.opId,
    userId: op.userId,
    type: 'create_entry',
    payload: op.payload,
    clientCreatedAt: new Date().toISOString(),
    maxKnownRateVersion: op.maxKnownRateVersion,
    supersedesRejectedOpId: op.supersedesRejectedOpId ?? undefined,
    status: 'pending',
  };

  await db.outbox.put(outboxItem);
}

export async function enqueueSupersedeEntry(op: {
  opId: string;
  userId: string;
  payload: {
    originalEntryId: string;
    replacement: Record<string, unknown>;
  };
  maxKnownRateVersion: number;
  supersedesRejectedOpId?: string | undefined;
}): Promise<void> {
  const outboxItem: LocalOutboxOp = {
    opId: op.opId,
    userId: op.userId,
    type: 'supersede_entry',
    payload: op.payload,
    clientCreatedAt: new Date().toISOString(),
    maxKnownRateVersion: op.maxKnownRateVersion,
    supersedesRejectedOpId: op.supersedesRejectedOpId ?? undefined,
    status: 'pending',
  };

  await db.outbox.put(outboxItem);
}

export async function getPendingOutboxOps(): Promise<LocalOutboxOp[]> {
  return await db.outbox.where('status').equals('pending').sortBy('clientCreatedAt');
}
