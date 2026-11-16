import fs from 'node:fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

/**
 * Load the repo-root env files the same way the dev server does (SvelteKit
 * `kit.env.dir: '../../'` in apps/web/svelte.config.js, with Vite's precedence):
 *
 *   shell  >  .env.[mode].local  >  .env.[mode]  >  .env.local  >  .env
 *
 * The earlier loader read only .env.local and .env from the current directory, so
 * `pnpm db:bootstrap` and `pnpm dev` could see different values for the same runbook,
 * and a mode-specific file was ignored by the script but honoured by the server.
 *
 * Returns the environment it filled, so the precedence can be tested without touching
 * the real one.
 */
export function loadRootEnv(
  options: { dir?: string; mode?: string; env?: NodeJS.ProcessEnv } = {},
): NodeJS.ProcessEnv {
  const dir = options.dir ?? path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const env = options.env ?? process.env;
  const mode = options.mode ?? (env.NODE_ENV === 'production' ? 'production' : 'development');
  const files = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];
  const fromFiles = new Set<string>();

  for (const file of files) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) continue;

    for (const [key, value] of Object.entries(dotenv.parse(fs.readFileSync(full, 'utf8')))) {
      // A value from the shell wins over any file; among files, the later one wins.
      if (env[key] !== undefined && !fromFiles.has(key)) continue;
      env[key] = value;
      fromFiles.add(key);
    }
  }

  return env;
}

loadRootEnv();

const { Pool } = pg;

interface CentreSeed {
  code: string;
  name: string;
  legalEntityName: string;
  binNumber: string | null;
  tradeLicense: string | null;
  address: string;
  phone: string;
  ownerEmail: string;
  ownerName: string;
}

const CENTRE_CODE_PATTERN = /^[A-Z0-9]{2,8}$/;

/** Development and test fixtures, provisioned when BOOTSTRAP_CENTER_CODE is unset. */
const DEV_CENTRE_FIXTURES: CentreSeed[] = [
  {
    code: 'MHK',
    name: 'Kumon Mohakhali Center',
    legalEntityName: 'Mohakhali Learning Center Ltd',
    binNumber: '0000000000',
    tradeLicense: 'MHK-TL-000001',
    address: 'Mohakhali, Dhaka',
    phone: '01700000001',
    ownerEmail: 'owner.mhk@cosmoledger.local',
    ownerName: 'Mohakhali Owner',
  },
  {
    code: 'RMP',
    name: 'Kumon Rampura Center',
    legalEntityName: 'Rampura Education Center Ltd',
    binNumber: '0000000001',
    tradeLicense: 'RMP-TL-000001',
    address: 'Rampura, Dhaka',
    phone: '01700000002',
    ownerEmail: 'owner.rmp@cosmoledger.local',
    ownerName: 'Rampura Owner',
  },
];

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to provision the first center`);
  }
  return value;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/**
 * PRD §7.4: the first center's identity comes from the environment. When
 * BOOTSTRAP_CENTER_CODE is unset, the two development fixtures are provisioned
 * instead so local and test runs keep their existing baseline.
 */
export function resolveCentreSeeds(): CentreSeed[] {
  const code = process.env.BOOTSTRAP_CENTER_CODE?.trim();
  if (!code) {
    return DEV_CENTRE_FIXTURES;
  }

  const normalizedCode = code.toUpperCase();
  if (!CENTRE_CODE_PATTERN.test(normalizedCode)) {
    throw new Error(
      `BOOTSTRAP_CENTER_CODE must be 2-8 uppercase alphanumeric characters, got "${code}"`,
    );
  }

  return [
    {
      code: normalizedCode,
      name: requiredEnv('BOOTSTRAP_CENTER_NAME'),
      legalEntityName: requiredEnv('BOOTSTRAP_CENTER_LEGAL_ENTITY_NAME'),
      binNumber: optionalEnv('BOOTSTRAP_CENTER_BIN'),
      tradeLicense: optionalEnv('BOOTSTRAP_CENTER_TRADE_LICENSE'),
      address: requiredEnv('BOOTSTRAP_CENTER_ADDRESS'),
      phone: requiredEnv('BOOTSTRAP_CENTER_PHONE'),
      ownerEmail: requiredEnv('BOOTSTRAP_CENTER_OWNER_EMAIL'),
      ownerName: requiredEnv('BOOTSTRAP_CENTER_OWNER_NAME'),
    },
  ];
}

export async function bootstrap(): Promise<void> {
  // Same resolution the server routes use (apps/web/src/lib/server/supabase.ts):
  // the private name first, then the public one the browser build carries.
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    'http://127.0.0.1:54321';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ownerEmail =
    process.env.BOOTSTRAP_OWNER_EMAIL ||
    (process.env.NODE_ENV === 'production' ? '' : 'owner@cosmoledger.local');
  const ownerPassword = process.env.BOOTSTRAP_OWNER_PASSWORD;
  const databaseUrl =
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

  if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to execute bootstrap script');
  }

  if (!ownerEmail) {
    throw new Error('BOOTSTRAP_OWNER_EMAIL is required to execute bootstrap script in production');
  }

  if (!ownerPassword) {
    throw new Error('BOOTSTRAP_OWNER_PASSWORD is required to execute bootstrap script');
  }

  // Fail before any network or database write when the centre configuration is unusable.
  const centreSeeds = resolveCentreSeeds();

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    // -------------------------------------------------------------------------
    // Pre-Transaction Auth Phase (Prevents holding DB locks across network I/O)
    // -------------------------------------------------------------------------
    let superAdminUserId: string | null = null;
    let page = 1;

    while (true) {
      const { data: userList, error: listError } = await supabase.auth.admin.listUsers({
        page,
        perPage: 100,
      });

      if (listError) {
        throw new Error(`Failed to list auth users: ${listError.message}`);
      }

      const existingUser = userList.users.find(
        (u) => u.email?.toLowerCase() === ownerEmail.toLowerCase(),
      );

      if (existingUser) {
        superAdminUserId = existingUser.id;
        break;
      }

      if (userList.users.length < 100) {
        break;
      }
      page++;
    }

    if (superAdminUserId) {
      const { error: updateError } = await supabase.auth.admin.updateUserById(superAdminUserId, {
        app_metadata: { role: 'super_admin' },
      });
      if (updateError) {
        throw new Error(`Failed to update super_admin auth metadata: ${updateError.message}`);
      }
    } else {
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: ownerEmail,
        password: ownerPassword,
        email_confirm: true,
        app_metadata: { role: 'super_admin' },
        user_metadata: { full_name: 'Platform Super Admin' },
      });

      if (createError || !newUser?.user) {
        throw new Error(
          `Failed to create super_admin auth user: ${createError?.message ?? 'unknown'}`,
        );
      }
      superAdminUserId = newUser.user.id;
    }

    // -------------------------------------------------------------------------
    // Transaction & Dedicated Bootstrap Advisory Lock (1004, 1)
    // -------------------------------------------------------------------------
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(1004, 1);');

    // Upsert Platform Super Admin profile (role: 'super_admin', center_id: NULL)
    await client.query(
      `
      INSERT INTO profiles (id, full_name, role, center_id, active)
      VALUES ($1, 'Platform Super Admin', 'super_admin', NULL, true)
      ON CONFLICT (id) DO UPDATE
        SET role = 'super_admin',
            center_id = NULL,
            active = true,
            updated_at = now();
    `,
      [superAdminUserId],
    );

    // -------------------------------------------------------------------------
    // Provision Initial Franchise Centers via rpc_create_center
    // -------------------------------------------------------------------------
    async function provisionCenterIfMissing(
      code: string,
      name: string,
      legalEntityName: string,
      binNumber: string | null,
      tradeLicense: string | null,
      address: string,
      phone: string,
      centerOwnerEmail: string,
      centerOwnerName: string,
    ): Promise<void> {
      const { rows } = await client.query('SELECT id FROM centers WHERE code = $1', [code]);
      if (rows.length > 0) {
        return; // Already exists
      }

      await client.query(
        `SELECT rpc_create_center(
          $1::uuid,
          $2::varchar,
          $3::text,
          $4::text,
          $5::varchar,
          $6::varchar,
          $7::text,
          $8::varchar,
          $9::text,
          $10::text
        )`,
        [
          superAdminUserId,
          code,
          name,
          legalEntityName,
          binNumber,
          tradeLicense,
          address,
          phone,
          centerOwnerEmail,
          centerOwnerName,
        ],
      );
    }

    for (const seed of centreSeeds) {
      await provisionCenterIfMissing(
        seed.code,
        seed.name,
        seed.legalEntityName,
        seed.binNumber,
        seed.tradeLicense,
        seed.address,
        seed.phone,
        seed.ownerEmail,
        seed.ownerName,
      );
    }

    // Write system.bootstrap audit log with center_id: NULL
    const { rows: existingAudit } = await client.query(
      "SELECT 1 FROM audit_log WHERE action = 'system.bootstrap' LIMIT 1",
    );
    if (existingAudit.length === 0) {
      const provisionedCentres = Object.fromEntries(
        centreSeeds.map((seed) => [seed.code, 'provisioned']),
      );
      await client.query(
        `
        INSERT INTO audit_log (center_id, actor, action, target_table, target_id, after)
        VALUES (NULL, $1::uuid, 'system.bootstrap', 'system', 'bootstrap',
                jsonb_build_object('status', 'completed', 'centers', $2::jsonb))
      `,
        [superAdminUserId, JSON.stringify(provisionedCentres)],
      );
    }

    await client.query('COMMIT');
    const provisionedCodes = centreSeeds.map((seed) => seed.code).join(', ');
    process.stdout.write(`Bootstrap completed successfully. Centres: ${provisionedCodes}\n`);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Direct CLI invocation
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  bootstrap().catch((err) => {
    process.stderr.write(`Bootstrap failed: ${String(err)}\n`);
    process.exit(1);
  });
}
