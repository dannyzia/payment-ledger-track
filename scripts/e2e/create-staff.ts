#!/usr/bin/env tsx
/**
 * Create (or refresh) the non-owner account the E2E suite signs in as.
 *
 * The role-based navigation specs need a real `staff` user, because the sidebar
 * and the mobile panel decide what to render from the profile's role. Creating
 * it through the admin API keeps the app's own invite flow untouched and lets
 * `fn_auth_users_create_profile` derive `profiles.role` from `app_metadata`,
 * exactly as production does.
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment; the
 * isolated-stack runner supplies both from its throwaway stack. Idempotent: an
 * existing user is updated rather than duplicated.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.E2E_STAFF_EMAIL;
const password = process.env.E2E_STAFF_PASSWORD;

if (!url || !serviceKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}
if (!email || !password) {
  throw new Error('E2E_STAFF_EMAIL and E2E_STAFF_PASSWORD are required');
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (existing.error) throw existing.error;

const found = existing.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());

if (found) {
  const { error } = await admin.auth.admin.updateUserById(found.id, {
    password,
    email_confirm: true,
    app_metadata: { role: 'staff' },
  });
  if (error) throw error;
  console.log(`staff fixture updated: ${email}`);
} else {
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: 'staff' },
  });
  if (error) throw error;
  console.log(`staff fixture created: ${email}`);
}
