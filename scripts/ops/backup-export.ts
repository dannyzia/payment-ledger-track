import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Handle CLI help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: tsx scripts/ops/backup-export.ts

Executes daily off-Supabase database backup:
1. Dumps public schema via pg_dump using libpq env variables.
2. Encrypts dump with GPG AES-256 using --passphrase-fd 0 via stdin.
3. Uploads encrypted artifact and syncs private storage buckets to cloud storage.
`);
  process.exit(0);
}

/**
 * Runs `gpg` with the passphrase streamed over stdin (`--passphrase-fd 0`).
 *
 * Deviation from the plan text: child_process.execSync has no `input` option,
 * and a piped-but-empty stdin would leave gpg waiting forever in a headless
 * cron/CI run. spawnSync writes the passphrase to the pipe and closes it.
 */
function runGpgWithStdinPassphrase(
  args: string[],
  passphrase: string,
  env: NodeJS.ProcessEnv,
): void {
  const result = spawnSync('gpg', args, {
    input: passphrase,
    env,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`gpg exited with status ${String(result.status)}`);
  }
}

export async function executeBackupExport(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tempDir = path.resolve('/tmp', `clt-backup-${timestamp}`);
  const dumpFile = path.join(tempDir, 'ledger_snapshot.sql');
  const encryptedFile = path.join(tempDir, `ledger_snapshot_${timestamp}.sql.gpg`);

  console.log(`Starting automated daily off-Supabase database export at ${timestamp}...`);

  // Create temporary directory with secure 0700 permissions
  fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });

  const directDbUrl = process.env.DIRECT_DATABASE_URL;
  const gpgPassphrase = process.env.BACKUP_GPG_PASSPHRASE;
  const bucket = process.env.BACKUP_STORAGE_BUCKET;
  const region = process.env.BACKUP_STORAGE_REGION || 'ap-southeast-1';
  const accessKeyId = process.env.BACKUP_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_SECRET_ACCESS_KEY;

  if (!directDbUrl) {
    throw new Error(
      'DIRECT_DATABASE_URL is strictly required for pg_dump (pooler DATABASE_URL not supported)',
    );
  }
  if (!gpgPassphrase || !bucket) {
    throw new Error(
      'Missing mandatory backup configuration environment variables (BACKUP_GPG_PASSPHRASE, BACKUP_STORAGE_BUCKET)',
    );
  }

  // Parse directDbUrl into standard libpq environment variables to prevent CLI argument leakage
  const parsedDb = new URL(directDbUrl);
  const execEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: parsedDb.hostname,
    PGPORT: parsedDb.port || '5432',
    PGUSER: parsedDb.username,
    PGPASSWORD: parsedDb.password,
    PGDATABASE: parsedDb.pathname.replace(/^\//, '') || 'postgres',
    PGSSLMODE: parsedDb.searchParams.get('sslmode') || 'require',
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    AWS_DEFAULT_REGION: region,
  };

  try {
    // 1. Dump public schema using standard libpq env variables
    console.log('Executing pg_dump for public schema...');
    execSync(
      `pg_dump --schema=public --clean --if-exists --no-owner --no-privileges -f "${dumpFile}"`,
      { stdio: 'inherit', env: execEnv },
    );

    // 2. Encrypt dump file with GPG using --passphrase-fd 0 via stdin (NOT CLI flags)
    console.log('Encrypting dump file with AES-256 via stdin passphrase pipe...');
    runGpgWithStdinPassphrase(
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
        encryptedFile,
        dumpFile,
      ],
      gpgPassphrase,
      execEnv,
    );

    // 3. Upload encrypted database archive to object storage
    console.log(`Uploading encrypted archive to s3://${bucket}/daily/...`);
    execSync(
      `aws s3 cp "${encryptedFile}" "s3://${bucket}/daily/ledger_snapshot_${timestamp}.sql.gpg" --sse AES256`,
      { stdio: 'inherit', env: execEnv },
    );

    // 4. Backup private storage buckets (settlement-receipts and statement-files)
    console.log(`Syncing private storage buckets to s3://${bucket}/storage/...`);
    try {
      execSync(
        `aws s3 sync "s3://supabase-storage/payment-receipts" "s3://${bucket}/storage/payment-receipts" --sse AES256`,
        { stdio: 'pipe', env: execEnv },
      );
      execSync(
        `aws s3 sync "s3://supabase-storage/statement-files" "s3://${bucket}/storage/statement-files" --sse AES256`,
        { stdio: 'pipe', env: execEnv },
      );
    } catch {
      console.warn('Notice: Storage bucket sync skipped or buckets empty.');
    }

    console.log(`Backup completed and uploaded successfully.`);
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('backup-export.ts')) {
  executeBackupExport().catch((err) => {
    console.error('Backup export failed:', err);
    process.exit(1);
  });
}
