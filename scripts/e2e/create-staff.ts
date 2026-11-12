#!/usr/bin/env tsx
/**
 * Create (or refresh) the non-owner account the E2E suite signs in as.
 *
 * The role-based navigation and ledger-scope specs need real `staff` and
 * `admin` users, because the sidebar, the mobile panel and the ledger decide
 * what to render from the profile's role. Creating them through the admin API
 * keeps the app's own invite flow untouched and lets
 * `fn_auth_users_create_profile` derive `profiles.role` from `app_metadata`,
 * exactly as production does.
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment; the
 * isolated-stack runner supplies both from its throwaway stack. Idempotent: an
 * existing user is updated rather than duplicated. `E2E_FIXTURE_ROLE` selects
 * the role (default `staff`); the runner invokes this once per account.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.E2E_STAFF_EMAIL;
const password = process.env.E2E_STAFF_PASSWORD;
const role = process.env.E2E_FIXTURE_ROLE || 'staff';

if (!url || !serviceKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}
if (!email || !password) {
  throw new Error('E2E_STAFF_EMAIL and E2E_STAFF_PASSWORD are required');
}
if (role !== 'staff' && role !== 'admin') {
  throw new Error(`E2E_FIXTURE_ROLE must be staff or admin, got ${role}`);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Resolve the center for fixture accounts. `E2E_FIXTURE_CENTER_CODE` pins the
// account to a named center, which the multi-center isolation spec needs: it
// signs in as one staff member per center. Without it the first center created
// (bootstrap provisions MHK before RMP) is used, preserving earlier behaviour.
const centerCode = process.env.E2E_FIXTURE_CENTER_CODE;
let centerQuery = admin.from('centers').select('id, code');
if (centerCode) centerQuery = centerQuery.eq('code', centerCode);
const { data: centerRows, error: centerError } = await centerQuery
  .order('center_number', { ascending: true })
  .order('id', { ascending: true })
  .limit(1);
if (centerError) throw centerError;
const centerId = centerRows?.[0]?.id ?? null;
if (centerCode && !centerId) {
  throw new Error(`E2E_FIXTURE_CENTER_CODE=${centerCode} matched no center`);
}

const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (existing.error) throw existing.error;

const found = existing.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());

if (found) {
  const { error } = await admin.auth.admin.updateUserById(found.id, {
    password,
    email_confirm: true,
    app_metadata: { role, center_id: centerId },
  });
  if (error) throw error;
  console.info(`${role} fixture updated: ${email} (center: ${centerId})`);
} else {
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, center_id: centerId },
  });
  if (error) throw error;
  console.info(`${role} fixture created: ${email} (center: ${centerId})`);
}
