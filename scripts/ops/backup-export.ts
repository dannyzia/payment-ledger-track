import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MANIFEST_VERSION, type BackupManifest } from './backup-verify';

/**
 * Off-Supabase encrypted archive — Plan 023 step 2, Goldfish blocker 6.
 *
 * Two behaviours are deliberate and were missing before:
 *   1. Nothing is swallowed. A missing secret, a failed Storage sync or a failed
 *      upload exits non-zero with a named error, so the nightly workflow goes red
 *      and the alert step fires.
 *   2. The archive is complete enough to restore: the public schema, the auth
 *      schema (users and MFA factors), and every Storage bucket the app writes to.
 *
 * Secrets are read from the environment only. They are never logged, and the
 * passphrase reaches gpg over stdin, never as an argument.
 */

const REQUIRED_ENV = [
  'DIRECT_DATABASE_URL',
  'BACKUP_GPG_PASSPHRASE',
  'BACKUP_STORAGE_BUCKET',
  'BACKUP_STORAGE_SOURCE',
  'BACKUP_ACCESS_KEY_ID',
  'BACKUP_SECRET_ACCESS_KEY',
] as const;

/** Created by the app itself; the previous runbook named two buckets that do not exist. */
const STORAGE_BUCKETS = ['receipts', 'statements'] as const;

/** Where the local pointer to the last successful run is written. */
export function manifestPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.BACKUP_MANIFEST_PATH?.trim() || path.join(os.tmpdir(), 'clt-backup-manifest.json');
}

export function assertEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`missing_environment: ${missing.join(', ')}`);
  }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { env, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${String(result.status)}`);
  }
}

/** gpg needs the passphrase on fd 0; execSync has no input option. */
function encrypt(file: string, output: string, passphrase: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(
    'gpg',
    [
      '--batch',
      '--yes',
      '--pinentry-mode',
      'loopback',
      '--passphrase-fd',
      '0',
      '--symmetric',
      '--cipher-algo',
      'AES256',
      '-o',
      output,
      file,
    ],
    { input: passphrase, env, stdio: ['pipe', 'inherit', 'inherit'] },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`gpg exited with status ${String(result.status)}`);
  }
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function uploadAgentFile(
  file: string,
  bucket: string,
  key: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  run('aws', ['s3', 'cp', file, `s3://${bucket}/${key}`, '--sse', 'AES256'], env);
}

export async function executeBackupExport(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tempDir = path.resolve(os.tmpdir(), `clt-backup-${timestamp}`);

  assertEnvironment();

  const directDbUrl = process.env.DIRECT_DATABASE_URL as string;
  const passphrase = process.env.BACKUP_GPG_PASSPHRASE as string;
  const bucket = process.env.BACKUP_STORAGE_BUCKET as string;
  const storageSource = (process.env.BACKUP_STORAGE_SOURCE as string).replace(/\/+$/, '');
  const region = process.env.BACKUP_STORAGE_REGION || 'ap-southeast-1';

  const parsedDb = new URL(directDbUrl);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: parsedDb.hostname,
    PGPORT: parsedDb.port || '5432',
    PGUSER: parsedDb.username,
    PGPASSWORD: parsedDb.password,
    PGDATABASE: parsedDb.pathname.replace(/^\//, '') || 'postgres',
    PGSSLMODE: parsedDb.searchParams.get('sslmode') || 'require',
    AWS_ACCESS_KEY_ID: process.env.BACKUP_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.BACKUP_SECRET_ACCESS_KEY,
    AWS_DEFAULT_REGION: region,
  };

  console.info(`Starting off-Supabase archive at ${timestamp}...`);
  fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });

  try {
    // 1. Public schema, re-runnable on restore.
    const publicDump = path.join(tempDir, 'ledger_snapshot.sql');
    console.info('pg_dump: public schema...');
    run(
      'pg_dump',
      [
        '--schema=public',
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        '-f',
        publicDump,
      ],
      env,
    );

    // 2. Auth schema: users, identities and MFA factors. Without it a restore
    //    brings back no logins and no 2FA enrolment. No --clean: this restores
    //    into a fresh instance and must not drop the target's auth schema.
    const authDump = path.join(tempDir, 'auth_snapshot.sql');
    console.info('pg_dump: auth schema...');
    run('pg_dump', ['--schema=auth', '--no-owner', '--no-privileges', '-f', authDump], env);

    // 3. Encrypt both.
    const encrypted: Array<{ file: string; key: string }> = [];
    for (const [source, name] of [
      [publicDump, `ledger_snapshot_${timestamp}.sql.gpg`],
      [authDump, `auth_snapshot_${timestamp}.sql.gpg`],
    ] as const) {
      const output = path.join(tempDir, name);
      console.info(`gpg: encrypting ${path.basename(source)}...`);
      encrypt(source, output, passphrase, env);
      encrypted.push({ file: output, key: `daily/${name}` });
    }

    // 4. Upload both, then the manifest that names them.
    for (const { file, key } of encrypted) {
      console.info(`aws s3 cp: s3://${bucket}/${key}`);
      await uploadAgentFile(file, bucket, key, env);
    }

    // 5. Storage objects. A failure here fails the run: the previous version
    //    caught it and claimed success while archiving no files at all.
    for (const storageBucket of STORAGE_BUCKETS) {
      console.info(
        `aws s3 sync: ${storageSource}/${storageBucket} -> s3://${bucket}/storage/${storageBucket}`,
      );
      run(
        'aws',
        [
          's3',
          'sync',
          `${storageSource}/${storageBucket}`,
          `s3://${bucket}/storage/${storageBucket}`,
          '--sse',
          'AES256',
        ],
        env,
      );
    }

    const manifest: BackupManifest = {
      version: MANIFEST_VERSION,
      completedAt: new Date().toISOString(),
      files: encrypted.map(({ file, key }) => ({
        key,
        sha256: sha256(file),
        bytes: fs.statSync(file).size,
      })),
      storage: { source: storageSource, buckets: [...STORAGE_BUCKETS] },
    };

    const localManifest = manifestPath();
    fs.mkdirSync(path.dirname(localManifest), { recursive: true });
    fs.writeFileSync(localManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

    // `latest` is what the verifier reads; the timestamped copy is the audit trail.
    const manifestFile = path.join(tempDir, 'manifest.json');
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await uploadAgentFile(manifestFile, bucket, 'daily/manifest.json', env);
    await uploadAgentFile(manifestFile, bucket, `daily/manifest_${timestamp}.json`, env);

    console.info(
      `Archive complete: ${encrypted.length} encrypted files, ${STORAGE_BUCKETS.length} buckets.`,
    );
    console.info(`Last-run manifest: ${localManifest}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith('backup-export.ts')) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.info(`
Usage: tsx scripts/ops/backup-export.ts

Required environment:
  DIRECT_DATABASE_URL      direct Postgres URL (port 5432; poolers cannot pg_dump)
  BACKUP_GPG_PASSPHRASE    AES-256 passphrase, read over stdin and never logged
  BACKUP_STORAGE_BUCKET    destination bucket for the archive
  BACKUP_STORAGE_SOURCE    S3 base the Supabase Storage buckets are read from
  BACKUP_ACCESS_KEY_ID     destination credentials
  BACKUP_SECRET_ACCESS_KEY
Optional environment:
  BACKUP_STORAGE_REGION    default ap-southeast-1
  BACKUP_MANIFEST_PATH     where the last-run manifest is written locally

Dumps public and auth, encrypts both with AES-256, uploads them plus the Storage
buckets, and writes a manifest. Any failure exits non-zero.`);
    process.exit(0);
  }

  executeBackupExport().catch((err: unknown) => {
    console.error('backup_export_failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
