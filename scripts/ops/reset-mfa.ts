#!/usr/bin/env tsx
/**
 * Reset the platform Super Admin's second factor.
 *
 * Plan 023 step 5: this exists before mandatory TOTP is switched on, because a
 * sole Super Admin who loses the authenticator has no colleague to unlock the
 * seat. It is an operator command on purpose: it needs the service role key and
 * a written reason, and it refuses to touch a center-scoped account.
 *
 * What it does, in order:
 *   1. verifies the target is an active `super_admin`;
 *   2. deletes every MFA factor on that account;
 *   3. clears the stored recovery-code hashes (they are useless without a factor);
 *   4. revokes the account's refresh sessions, so an already-open browser cannot
 *      keep a stale `aal2` session alive;
 *   5. writes one `audit_log` row (`mfa.factors_reset`) with the reason.
 *
 * Refuses a non-platform account, an empty reason, and any run without `--apply`.
 *
 *   pnpm exec tsx scripts/ops/reset-mfa.ts --user <uuid> --reason "<ticket or why>"
 *   pnpm exec tsx scripts/ops/reset-mfa.ts --user <uuid> --reason "..." --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const { Pool } = pg;

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.resolve(dir, '..');
  }
  return process.cwd();
}

const root = repoRoot();
for (const envName of ['.env.local', '.env']) {
  const envPath = path.join(root, envName);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
}

const USAGE = `reset-mfa — clear the Super Admin second factor and force re-enrolment

Usage:
  tsx scripts/ops/reset-mfa.ts --user <uuid> --reason "<why>" [--apply]

Arguments:
  --user <uuid>     the super_admin profile id whose factors are cleared (required)
  --reason "<text>" written into the audit row and expected to name a ticket (required)
  --apply           actually perform the reset; without it this is a dry run
  --help            show this block

Effects with --apply:
  - every MFA factor on the account is deleted
  - stored recovery-code hashes are cleared
  - the account's refresh sessions are revoked (global sign-out)
  - one audit_log row 'mfa.factors_reset' is written with the reason

Refuses a user that is not an active super_admin.`;

interface Options {
  userId: string | null;
  reason: string | null;
  apply: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { userId: null, reason: null, apply: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--user') options.userId = argv[++i] ?? null;
    else if (arg === '--reason') options.reason = argv[++i] ?? null;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.userId) throw new Error('--user <uuid> is required');
  if (!options.reason || options.reason.trim().length < 5) {
    throw new Error('--reason "<why>" is required and must be at least 5 characters');
  }

  const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!databaseUrl) throw new Error('DIRECT_DATABASE_URL or DATABASE_URL is required');
  if (!supabaseUrl || !serviceKey) {
    throw new Error('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { rows: profileRows } = await pool.query<{
      id: string;
      role: string;
      active: boolean;
      email: string | null;
    }>(
      `select p.id, p.role, p.active, u.email
         from profiles p left join auth.users u on u.id = p.id
        where p.id = $1`,
      [options.userId],
    );
    const profile = profileRows[0];
    if (!profile) throw new Error(`no profile with id ${options.userId}`);
    if (profile.role !== 'super_admin') {
      throw new Error(
        `refusing to reset MFA for role '${profile.role}': this command is for the platform seat only`,
      );
    }
    if (!profile.active) throw new Error('refusing to reset MFA for an inactive account');

    const { data: factorData, error: factorError } = await admin.auth.admin.mfa.listFactors({
      userId: options.userId,
    });
    if (factorError) throw new Error(`factor list failed: ${factorError.message}`);
    const factors = factorData?.factors ?? [];

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(options.userId);
    if (userError) throw new Error(`user lookup failed: ${userError.message}`);
    const metadata = (userData.user?.app_metadata ?? {}) as Record<string, unknown>;
    const recovery = metadata['mfa_recovery'] as { hashes?: unknown } | undefined;
    const storedCodes = Array.isArray(recovery?.hashes) ? recovery.hashes.length : 0;

    console.log(`target: ${profile.email ?? profile.id} (${profile.id})`);
    console.log(
      `factors: ${factors.length === 0 ? 'none' : factors.map((f) => f.factor_type).join(', ')}`,
    );
    console.log(`stored recovery codes: ${storedCodes}`);
    console.log(`reason: ${options.reason}`);

    if (!options.apply) {
      console.log('dry run: nothing changed. Re-run with --apply to reset the factor.');
      return;
    }

    const deleted: string[] = [];
    for (const factor of factors) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({
        userId: options.userId,
        id: factor.id,
      });
      if (error) throw new Error(`delete factor ${factor.id} failed: ${error.message}`);
      deleted.push(factor.id);
    }

    const rest: Record<string, unknown> = { ...metadata };
    delete rest['mfa_recovery'];
    const { error: updateError } = await admin.auth.admin.updateUserById(options.userId, {
      app_metadata: rest,
    });
    if (updateError) throw new Error(`clearing recovery codes failed: ${updateError.message}`);

    // Global scope revokes refresh tokens on every device; the current access token
    // still expires on its own, which is why the route-level aal gate matters.
    const { error: signOutError } = await admin.auth.admin.signOut(options.userId, 'global');
    if (signOutError) throw new Error(`session revoke failed: ${signOutError.message}`);

    const { error: auditError } = await pool.query(
      'select log_audit_event($1, $2, $3, $4, $5, $6, $7)',
      [
        null,
        options.userId,
        'mfa.factors_reset',
        'auth.users',
        options.userId,
        JSON.stringify({ factors: factors.map((f) => ({ id: f.id, type: f.factor_type })) }),
        JSON.stringify({
          reason: options.reason,
          source: 'scripts/ops/reset-mfa.ts',
          recovery_codes_cleared: storedCodes,
          sessions_revoked: 'global',
        }),
      ],
    );
    if (auditError) throw new Error(`audit write failed: ${auditError.message}`);

    console.log(
      `reset ${deleted.length} factor(s); cleared ${storedCodes} recovery code(s); revoked refresh sessions; audited as mfa.factors_reset`,
    );
    console.log('the account must enrol a new authenticator before /admin/super/* opens again');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
