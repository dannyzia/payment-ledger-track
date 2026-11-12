#!/usr/bin/env tsx
/**
 * Set the password of an existing device fixture, leaving role and centre alone.
 *
 *   pnpm exec tsx scripts/e2e/set-fixture-password.ts --email=<email> --password=<password>
 *
 * `create-staff.ts` is the wrong tool for this: it upserts `app_metadata`, so
 * pointing it at the Owner would demote the single owner account (PRD: exactly
 * one active Owner). This only changes the credential, and prints what it found
 * so the untouched role and centre are visible.
 *
 * Credentials may instead come from CLT_FIXTURE_EMAIL / CLT_FIXTURE_PASSWORD.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

function readOption(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const email = (readOption('email') ?? process.env.CLT_FIXTURE_EMAIL ?? '').trim().toLowerCase();
const password = readOption('password') ?? process.env.CLT_FIXTURE_PASSWORD ?? '';

if (!email || !password) {
  console.error(
    'Usage: set-fixture-password.ts --email=<email> --password=<password> (or CLT_FIXTURE_EMAIL / CLT_FIXTURE_PASSWORD)',
  );
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (see .env.local).');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (users.error) {
  console.error(`Could not list users: ${users.error.message}`);
  process.exit(1);
}

const found = users.data.users.find((user) => user.email?.toLowerCase() === email);
if (!found) {
  console.error(
    `No auth user for ${email}. Create it with scripts/e2e/create-staff.ts instead (this script only rotates an existing credential).`,
  );
  process.exit(1);
}

const meta = (found.app_metadata ?? {}) as { role?: string; center_id?: string | null };
const { error } = await admin.auth.admin.updateUserById(found.id, { password });
if (error) {
  console.error(`Password update failed: ${error.message}`);
  process.exit(1);
}

console.info(
  `Password updated for ${email} (id ${found.id}). Role and centre untouched: role=${meta.role ?? 'unset'}, center=${meta.center_id ?? 'none'}.`,
);
