import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

// Load local environment files (.env.local takes precedence over .env)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const { Pool } = pg;

export async function bootstrap(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
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
      binNumber: string,
      tradeLicense: string,
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

    // Center 1: Mohakhali (MHK)
    await provisionCenterIfMissing(
      'MHK',
      'Kumon Mohakhali Center',
      'Mohakhali Learning Center Ltd',
      '0000000000',
      'MHK-TL-000001',
      'Mohakhali, Dhaka',
      '01700000001',
      'owner.mhk@cosmoledger.local',
      'Mohakhali Owner',
    );

    // Center 2: Rampura (RMP)
    await provisionCenterIfMissing(
      'RMP',
      'Kumon Rampura Center',
      'Rampura Education Center Ltd',
      '0000000001',
      'RMP-TL-000001',
      'Rampura, Dhaka',
      '01700000002',
      'owner.rmp@cosmoledger.local',
      'Rampura Owner',
    );

    // Write system.bootstrap audit log with center_id: NULL
    const { rows: existingAudit } = await client.query(
      "SELECT 1 FROM audit_log WHERE action = 'system.bootstrap' LIMIT 1",
    );
    if (existingAudit.length === 0) {
      await client.query(
        `
        INSERT INTO audit_log (center_id, actor, action, target_table, target_id, after)
        VALUES (NULL, $1::uuid, 'system.bootstrap', 'system', 'bootstrap', jsonb_build_object(
          'status', 'completed',
          'centers', jsonb_build_object('MHK', 'provisioned', 'RMP', 'provisioned')
        ))
      `,
        [superAdminUserId],
      );
    }

    await client.query('COMMIT');
    process.stdout.write('Bootstrap completed successfully.\n');
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
