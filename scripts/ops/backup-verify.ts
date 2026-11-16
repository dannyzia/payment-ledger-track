import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Freshness check for the off-Supabase archive — Plan 023 step 2.
 *
 * The archive silently failed for at least a week before anyone noticed, so the
 * question this answers is narrow and boring: did a backup finish, and was it in
 * the last 24 hours? It exits non-zero when the answer is no.
 */

export const MANIFEST_VERSION = 1;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface BackupManifest {
  version: number;
  completedAt: string;
  files: Array<{ key: string; sha256: string; bytes: number }>;
  storage: { source: string; buckets: string[] };
}

export function parseManifest(raw: string): BackupManifest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('manifest_invalid: not JSON');
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('manifest_invalid: not an object');
  }
  const manifest = value as Partial<BackupManifest>;
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(`manifest_invalid: unsupported version ${String(manifest.version)}`);
  }
  if (typeof manifest.completedAt !== 'string' || Number.isNaN(Date.parse(manifest.completedAt))) {
    throw new Error('manifest_invalid: completedAt missing or unparseable');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('manifest_invalid: no files recorded');
  }
  for (const file of manifest.files) {
    if (
      typeof file?.key !== 'string' ||
      typeof file?.sha256 !== 'string' ||
      typeof file?.bytes !== 'number'
    ) {
      throw new Error('manifest_invalid: file entry is incomplete');
    }
  }
  if (!manifest.storage || !Array.isArray(manifest.storage.buckets)) {
    throw new Error('manifest_invalid: storage section missing');
  }
  return manifest as BackupManifest;
}

export function ageMs(manifest: BackupManifest, now: number = Date.now()): number {
  return now - Date.parse(manifest.completedAt);
}

export function isStale(
  manifest: BackupManifest,
  now: number = Date.now(),
  maxAgeMs: number = MAX_AGE_MS,
): boolean {
  return ageMs(manifest, now) > maxAgeMs;
}

function formatAge(ms: number): string {
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function sample(completedAt: string): BackupManifest {
  return {
    version: MANIFEST_VERSION,
    completedAt,
    files: [{ key: 'daily/ledger_snapshot.sql.gpg', sha256: 'a'.repeat(64), bytes: 1024 }],
    storage: { source: 's3://source', buckets: ['receipts', 'statements'] },
  };
}

function throws(fn: () => unknown, label: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`self_test_failed: ${label} did not throw`);
}

/**
 * Pure checks with no network, no AWS and no filesystem. This is what CI and the
 * operator can run before trusting the verifier itself.
 */
export function selfTest(): void {
  const now = Date.parse('2026-11-14T12:00:00Z');

  if (isStale(sample('2026-11-14T06:00:00Z'), now)) {
    throw new Error('self_test_failed: a 6h-old backup was reported stale');
  }
  if (!isStale(sample('2026-11-13T05:00:00Z'), now)) {
    throw new Error('self_test_failed: a 31h-old backup was reported fresh');
  }
  if (!isStale(sample('2026-11-14T11:00:00Z'), now, 30 * 60 * 1000)) {
    throw new Error('self_test_failed: a custom 30m limit was ignored');
  }

  throws(() => parseManifest('not json'), 'malformed JSON');
  throws(() => parseManifest('{"version":1,"files":[]}'), 'missing completedAt');
  throws(
    () => parseManifest(JSON.stringify({ ...sample('2026-11-14T06:00:00Z'), files: [] })),
    'empty file list',
  );
  throws(
    () => parseManifest(JSON.stringify({ ...sample('2026-11-14T06:00:00Z'), version: 99 })),
    'unknown manifest version',
  );

  const parsed = parseManifest(JSON.stringify(sample('2026-11-14T06:00:00Z')));
  if (parsed.files.length !== 1) {
    throw new Error('self_test_failed: valid manifest did not parse');
  }

  console.info('backup self-test: ok');
}

function awsDownload(bucket: string, key: string, destination: string): void {
  const result = spawnSync('aws', ['s3', 'cp', `s3://${bucket}/${key}`, destination], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`backup_manifest_unavailable: aws s3 cp exited ${String(result.status)}`);
  }
}

export function verify(env: NodeJS.ProcessEnv = process.env, now: number = Date.now()): void {
  let manifestFile = env.BACKUP_MANIFEST_PATH?.trim();
  let temporary: string | null = null;

  if (!manifestFile) {
    const bucket = env.BACKUP_STORAGE_BUCKET?.trim();
    if (!bucket) {
      throw new Error('backup_manifest_missing: set BACKUP_MANIFEST_PATH or BACKUP_STORAGE_BUCKET');
    }
    temporary = path.join(os.tmpdir(), `clt-backup-manifest-${process.pid}.json`);
    awsDownload(bucket, 'daily/manifest.json', temporary);
    manifestFile = temporary;
  }

  try {
    if (!fs.existsSync(manifestFile)) {
      throw new Error(`backup_manifest_missing: ${manifestFile} does not exist`);
    }
    const manifest = parseManifest(fs.readFileSync(manifestFile, 'utf8'));
    const age = ageMs(manifest, now);
    console.info(`backup manifest: completed ${manifest.completedAt} (${formatAge(age)} old)`);

    if (isStale(manifest, now)) {
      throw new Error(
        `backup_stale: last successful backup is ${formatAge(age)} old (limit 24.0h)`,
      );
    }
    console.info('backup fresh: ok');
  } finally {
    if (temporary) fs.rmSync(temporary, { force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith('backup-verify.ts')) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.info(`
Usage: tsx scripts/ops/backup-verify.ts [--self-test] [--manifest <path>]

Verifies that the off-Supabase archive completed in the last 24 hours.
  --self-test        run the pure checks (no network, no AWS) and exit
  --manifest <path>  read this manifest instead of downloading the latest one

Environment: BACKUP_MANIFEST_PATH, or BACKUP_STORAGE_BUCKET to fetch
s3://<bucket>/daily/manifest.json.`);
    process.exit(0);
  }

  try {
    if (args.includes('--self-test')) {
      selfTest();
      process.exit(0);
    }
    const manifestFlag = args.indexOf('--manifest');
    if (manifestFlag !== -1) {
      const value = args[manifestFlag + 1];
      if (!value) throw new Error('backup_manifest_missing: --manifest needs a path');
      process.env.BACKUP_MANIFEST_PATH = value;
    }
    verify();
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
