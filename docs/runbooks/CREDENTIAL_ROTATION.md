# Credential & Secret Rotation Runbook — Cosmo Ledger Track

Plan 021 §6.11. Four routines: service role key, database password, JWT secret,
bootstrap owner credentials. Rotate one at a time and verify after each.

## 1. Supabase Service Role Key Rotation

The service role key bypasses RLS and is restricted to SvelteKit `+server.ts` routes.

1. Open Supabase Dashboard -> Project Settings -> API.
2. In the `JWT Secret` section, generate a new secondary service role key.
3. Update Vercel Environment Variables:
   - Set `SUPABASE_SERVICE_ROLE_KEY` to the new key value.
   - Trigger deployment redeploy to inject variable across all serverless containers.
4. Verify server routes function normally:
   ```bash
   curl -X GET "https://cosmo-ledger.vercel.app/api/v1/health"
   ```
5. Revoke the old service role key in the Supabase Dashboard.

## 2. Database User Password Rotation

1. Generate strong 32-character random string in secret manager.
2. Update database password in Supabase Dashboard -> Settings -> Database.
3. Update `DATABASE_URL` and `DIRECT_DATABASE_URL` connection strings in Vercel and CI secret configurations.
4. Restart Vercel function instances.

## 3. Supabase JWT Secret Rotation

1. **Impact Notification**: Rotating the Supabase JWT secret changes both `PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
2. **Native App Re-Packaging Required**: Because `PUBLIC_SUPABASE_ANON_KEY` is embedded into the Capacitor Android binary (Plan 019), rotating the JWT secret requires releasing an updated Android App Bundle (`.aab`) to the Google Play Store.
3. Update `SUPABASE_JWT_SECRET` in Vercel and CI environments.
4. All connected staff users must re-authenticate with email/password.

## 4. Bootstrap Credential Post-Launch Cleanup

1. `BOOTSTRAP_OWNER_EMAIL` and `BOOTSTRAP_OWNER_PASSWORD` are one-time M0 initialization credentials.
2. Once the Owner account is established and ownership transfer capability is verified:
   - Remove `BOOTSTRAP_OWNER_PASSWORD` from local `.env` and CI deployment variables.
   - Ensure `scripts/bootstrap.ts` cannot be executed against production environments (`NODE_ENV === 'production'` guard).

## 5. Record Keeping

Log each rotation (what was rotated, when, by whom, verification command output)
in `docs/orchestration/`. Never paste the new secret value into a record, a chat,
a brief, or a report (AGENTS.md Rule 8).
