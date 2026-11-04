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
  const ownerEmail = process.env.BOOTSTRAP_OWNER_EMAIL || (process.env.NODE_ENV === 'production' ? '' : 'owner@cosmoledger.local');
  const ownerPassword = process.env.BOOTSTRAP_OWNER_PASSWORD;
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

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
    const { rows: existingOwners } = await client.query(
      "SELECT id, role FROM profiles WHERE role = 'owner' AND active = true LIMIT 1"
    );
    const activeOwnerExists = existingOwners.length > 0;

    let ownerUserId: string | null = null;
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
        (u) => u.email?.toLowerCase() === ownerEmail.toLowerCase()
      );

      if (existingUser) {
        ownerUserId = existingUser.id;
        break;
      }

      if (userList.users.length < 100) {
        break;
      }
      page++;
    }

    if (ownerUserId) {
      // Reconcile role: 'owner' in app_metadata ONLY if no active owner exists OR this user is already the active owner
      if (!activeOwnerExists || existingOwners[0].id === ownerUserId) {
        const { error: updateError } = await supabase.auth.admin.updateUserById(ownerUserId, {
          app_metadata: { role: 'owner' },
        });
        if (updateError) {
          throw new Error(`Failed to update owner auth metadata: ${updateError.message}`);
        }
      }
    } else {
      // Guard against creating a new owner if an active owner already exists in PostgreSQL
      if (activeOwnerExists) {
        throw new Error(
          `Cannot create new owner auth user: active owner already exists with profile ID ${existingOwners[0].id}`
        );
      }

      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: ownerEmail,
        password: ownerPassword,
        email_confirm: true,
        app_metadata: { role: 'owner' },
        user_metadata: { full_name: 'Primary Owner' },
      });

      if (createError || !newUser?.user) {
        throw new Error(`Failed to create owner auth user: ${createError?.message ?? 'unknown'}`);
      }
      ownerUserId = newUser.user.id;
    }

    // -------------------------------------------------------------------------
    // Transaction & Advisory Lock (PRD §7.2, Finding 2)
    // Acquire dedicated bootstrap advisory lock (1004, 1) to serialize concurrent runs
    // -------------------------------------------------------------------------
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(1004, 1);');

    // -------------------------------------------------------------------------
    // Non-Destructive Idempotency Guard (PRD §7.4, Rule 18)
    // Verify comprehensive baseline state before certifying existing baseline verified
    // -------------------------------------------------------------------------
    const { rows: bootstrapAudit } = await client.query(
      "SELECT 1 FROM audit_log WHERE action = 'system.bootstrap' LIMIT 1"
    );
    const { rows: publishedProfile } = await client.query(
      "SELECT id FROM rate_profiles WHERE version = 1 AND status = 'published' LIMIT 1"
    );
    const { rows: activeOwner } = await client.query(
      "SELECT 1 FROM profiles WHERE role = 'owner' AND active = true LIMIT 1"
    );
    const { rows: payablesCount } = await client.query(
      "SELECT count(*) as count FROM payables"
    );
    const { rows: methodsCount } = await client.query(
      "SELECT count(*) as count FROM payment_methods WHERE active = true"
    );

    if (
      bootstrapAudit.length > 0 &&
      publishedProfile.length > 0 &&
      activeOwner.length > 0 &&
      parseInt(payablesCount[0].count, 10) >= 4 &&
      parseInt(methodsCount[0].count, 10) >= 5
    ) {
      await client.query('COMMIT');
      process.stdout.write('Database already bootstrapped. Existing baseline verified.\nBootstrap completed successfully.\n');
      return;
    }

    // -------------------------------------------------------------------------
    // Step 2: Upsert Owner Profile (PRD §7.4 Step 2, CLT-D-009)
    // GoTrue provisions the profile via the auth trigger as 'staff' before app
    // metadata is persisted, so this upsert must TAKE role ownership when there
    // is no other active owner (fresh day-zero DB or reconciliation of this
    // profile). It must never strip a demoted former owner or clash with a
    // DIFFERENT active owner, which cannot legitimately reach this point.
    // -------------------------------------------------------------------------
    const usurpRight = !activeOwnerExists || existingOwners[0].id === ownerUserId;
    await client.query(`
      INSERT INTO profiles (id, full_name, role, active)
      VALUES ($1, 'Primary Owner', 'owner', true)
      ON CONFLICT (id) DO UPDATE
        SET full_name = 'Primary Owner',
            role = CASE WHEN $2::boolean THEN 'owner'::user_role ELSE profiles.role END;
    `, [ownerUserId, usurpRight]);

    // -------------------------------------------------------------------------
    // Step 3 [PLAN-DERIVED]: Seed Canonical Payment Methods (PRD §7.4 Step 3)
    // Note: Seeded initially with active = false to prevent chicken-and-egg trigger
    // failure with trg_payment_methods_active_rate_check before Rate Profile v1 is
    // published. Activated in Step 6 after method_rates are seeded and Profile v1 is published.
    // -------------------------------------------------------------------------
    await client.query(`
      INSERT INTO payment_methods (code, name, requires_txn_ref, sort_order, active) VALUES
        ('cash', 'Cash', false, 1, false),
        ('bkash', 'bKash', true, 2, false),
        ('visa', 'Visa', true, 3, false),
        ('mastercard', 'Mastercard', true, 4, false),
        ('bank_transfer', 'Bank Transfer', true, 5, false)
      ON CONFLICT (code) DO NOTHING;
    `);

    // -------------------------------------------------------------------------
    // Step 4 [PLAN-DERIVED]: Seed Canonical Payables (PRD §7.4 Step 4)
    // -------------------------------------------------------------------------
    await client.query(`
      INSERT INTO payables (code, name, kind, method_id, due_day, remind_days_before, active) VALUES
        ('vat_payable', 'Government VAT Challan', 'vat', null, 15, 3, true),
        ('bkash_charge_payable', 'bKash Merchant Charge', 'method_charge', (SELECT id FROM payment_methods WHERE code = 'bkash'), 10, 3, true),
        ('visa_charge_payable', 'Visa Merchant Charge', 'method_charge', (SELECT id FROM payment_methods WHERE code = 'visa'), 15, 3, true),
        ('mastercard_charge_payable', 'Mastercard Merchant Charge', 'method_charge', (SELECT id FROM payment_methods WHERE code = 'mastercard'), 15, 3, true)
      ON CONFLICT (code) DO NOTHING;
    `);

    // -------------------------------------------------------------------------
    // Step 5 [PLAN-DERIVED]: Seed Rate Profile v1 in Draft (PRD §7.4 Step 5, PRD ISSUE 006-1)
    // Note: Profile v1 is seeded initially with status = 'draft' so that Step 6 can
    // insert method_rates without tripping trg_method_rates_draft_publish_lock.
    // Draft row is updated with exact canonical baseline parameters before publishing.
    // -------------------------------------------------------------------------
    const profileRes = await client.query(`
      SELECT id, status FROM rate_profiles WHERE version = 1 ORDER BY (status = 'published') DESC, created_at ASC LIMIT 1;
    `);

    let profileId: string;
    let alreadyPublished = false;

    if (profileRes.rows.length > 0) {
      profileId = profileRes.rows[0].id;
      alreadyPublished = profileRes.rows[0].status === 'published';

      if (!alreadyPublished) {
        // Enforce canonical baseline configuration on pre-existing draft
        await client.query(`
          UPDATE rate_profiles SET
            effective_from = '2026-01-01',
            vat_mode = 'manual',
            vat_bp = 0,
            commission_base = 'gross_minus_vat',
            commission_bp = 4200,
            charges_borne_by = 'business',
            note = 'Initial system rate profile v1 (seeded via M0 bootstrap; effective 2026-01-01)'
          WHERE id = $1;
        `, [profileId]);
      }
    } else {
      const insertProfile = await client.query(`
        INSERT INTO rate_profiles (
          id, version, status, effective_from, vat_mode, vat_bp,
          commission_base, commission_bp, charges_borne_by, note, created_by
        ) VALUES (
          gen_random_uuid(), 1, 'draft', '2026-01-01', 'manual', 0,
          'gross_minus_vat', 4200, 'business',
          'Initial system rate profile v1 (seeded via M0 bootstrap; effective 2026-01-01)',
          $1
        ) RETURNING id;
      `, [ownerUserId]);
      profileId = insertProfile.rows[0].id;
    }

    // -------------------------------------------------------------------------
    // Step 6 [PLAN-DERIVED]: Seed method_rates for Profile v1 & Publish (PRD §7.4 Step 6)
    // -------------------------------------------------------------------------
    if (!alreadyPublished) {
      await client.query(`
        INSERT INTO method_rates (rate_profile_id, method_id, charge_bp)
        SELECT $1::uuid, m.id,
          CASE m.code
            WHEN 'bkash' THEN 115
            WHEN 'visa' THEN 150
            WHEN 'mastercard' THEN 150
            ELSE 0
          END
        FROM payment_methods m
        ON CONFLICT (rate_profile_id, method_id) DO UPDATE SET charge_bp = EXCLUDED.charge_bp;
      `, [profileId]);

      // Direct update to published under service_role (Bootstrap Exemption CLT-D-002)
      await client.query(`
        UPDATE rate_profiles
        SET status = 'published', published_at = now()
        WHERE id = $1;
      `, [profileId]);

      // Activate payment methods now that Profile v1 is published and covers all 5 methods
      await client.query(`
        UPDATE payment_methods
        SET active = true
        WHERE code IN ('cash', 'bkash', 'visa', 'mastercard', 'bank_transfer');
      `);
    }

    // -------------------------------------------------------------------------
    // Step 7: Initialize app_settings (PRD §7.4 Step 7)
    // -------------------------------------------------------------------------
    await client.query(`
      INSERT INTO app_settings (id, timezone, currency, locale, net_label, reconcile_tolerance_poisha)
      VALUES (true, 'Asia/Dhaka', 'BDT', 'en-BD', 'Net after deductions', 100)
      ON CONFLICT (id) DO NOTHING;
    `);

    // -------------------------------------------------------------------------
    // Step 8: Initialize Monthly Settlements (PRD §7.4 Step 8)
    // -------------------------------------------------------------------------
    await client.query(`
      SELECT generate_monthly_settlements((now() at time zone 'Asia/Dhaka')::date);
    `);

    // Typed parameter $2::uuid resolves PostgreSQL 42P18 type inference error
    await client.query(`
      INSERT INTO audit_log (actor, action, target_table, target_id, after)
      VALUES ($1::uuid, 'system.bootstrap', 'system', 'bootstrap', jsonb_build_object('status', 'completed', 'profile_id', $2::uuid));
    `, [ownerUserId, profileId]);

    await client.query('COMMIT');

    // Explicit success announcement for runner CLI and Plan 008 precondition verification
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
