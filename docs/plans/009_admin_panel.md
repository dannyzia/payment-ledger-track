# 009_admin_panel.md — Admin Panel, Rate Profiles, Payment Methods, Payables, and Audit Viewer

- Plan Identifier: CLT-PLAN-009
- Phase: Phase 1 / M1
- Milestone: M1
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §7.3 (Admin RPCs), §8.6 (Admin panel), §15.1 (Audit Coverage Matrix), §16.2 (Tests #14, #15, #21, #28, #33, #44, #57, #58, #59, #62, #63, #65), §17 (Milestone M1)
- Depends on: 004, 008
- Current Status: Not Implemented
- Revision: 2.2 — 2026-11-01

## 1. Purpose

Implement the Admin Panel configuration screens (S19–S27 per Plan 022) and SvelteKit server-route mediation endpoints under `/api/v1/admin/*` for configuring rate profiles, payment methods, payable schedules, application settings, team roster and role management, hardware device registry and killswitches, two-step ownership transfer, high-value stale-rate review queues (>৳50,000), and the chronological audit log viewer with multi-dimensional filtering. All financial rate configurations strictly enforce client-side and server-side deduction upper bounds (<= 100% / 10,000 bp), immutable method codes, strict payable due day ranges (1–28), and audited state transitions through `SECURITY DEFINER` RPCs under `service_role`. Authenticated client calls route through a unified `authFetch` utility attaching session tokens.

## 2. Scope

- IN:
  - Admin navigation routes under `apps/web/src/routes/(app)/admin/`:
    - `/admin` (S23 Admin Hub overview with quick navigation cards, pending review badges, and real-time device stale-rate anomaly alerts)
    - `/admin/rates` (S19 Rate profiles: published profile summary, draft editor, 100% deduction upper-bound banner, publish modal, method-level `charges_borne_by` configuration, and draft notes)
    - `/admin/methods` (S20 Payment methods manager: channel list, add/edit modal, activation guard, `requires_txn_ref` toggle, `sort_order`, immutable `code`)
    - `/admin/payables` (S21 Payable list, add/edit modal, fixed monthly due day 1–28 guard, auto-creation of settlements)
    - `/admin/settings` (S22 App settings: business net label, reconciliation tolerance poisha, read-only timezone, currency, locale, and offline retention)
    - `/admin/users` (S24 User roster, staff/admin invitation modal with GoTrue app_metadata claims sync, role demote/promote, and account deactivation/reactivation)
    - `/admin/devices` (S25 Device registry: paired devices, last synced watermark, active staff users, instant hardware killswitch revocation and unrevocation)
    - `/admin/stale-reviews` (S27 Stale rate review queue: flagged >৳50,000 offline entries, accept with audited justification or void)
    - `/admin/audit` (S25 Audit log viewer: append-only ledger of mutations with target table, action, actor, and date-range filters)
  - SvelteKit server routes under `apps/web/src/routes/api/v1/admin/`:
    - `POST /api/v1/admin/rates/draft` (invokes `create_or_update_draft_rate_profile` with `{ method_id, charge_bp }` method rates array)
    - `POST /api/v1/admin/rates/publish` (invokes `publish_rate_profile`)
    - `GET, POST /api/v1/admin/methods` (lists methods ordered by `sort_order`, invokes `admin_manage_payment_method`)
    - `GET, POST /api/v1/admin/payables` (lists payables, invokes `admin_manage_payable` with code, name, kind, due_day, remind_days_before)
    - `GET, PATCH /api/v1/admin/settings` (retrieves and updates singleton `app_settings` where `id = true` with `net_label` and `reconcile_tolerance_poisha`)
    - `GET, POST /api/v1/admin/devices` (lists paired devices from `devices` table with active users, invokes `admin_manage_device` for killswitch revoke/unrevoke)
    - `GET, PATCH /api/v1/admin/users` (retrieves user roster merged with auth emails, updates role or deactivates/reactivates via `admin_manage_user` and syncs `raw_app_meta_data`)
    - `POST /api/v1/admin/users/invite` (invites new staff/admin via `admin_invite_user`, `inviteUserByEmail`, and `updateUserById` app_metadata sync)
    - `POST /api/v1/admin/transfer-ownership` (executes atomic two-step ownership transfer via `transfer_ownership`, guards against self-transfer, and syncs `raw_app_meta_data`)
    - `GET /api/v1/admin/entries/stale-reviews` (retrieves flagged stale-rate entries with `gross_poisha`, `vat_poisha`, `net_poisha`, and snapshot rate version)
    - `POST /api/v1/admin/entries/stale-review` (invokes `admin_review_stale_entry` with `p_reason`)
    - `GET /api/v1/admin/entries/stale-anomalies` (queries `view_device_stale_rate_anomalies`)
    - `GET /api/v1/admin/audit` (retrieves audit log rows with `startDate`, `endDate`, `actor`, `table`, `action` filters)
  - Authenticated API client helper `apps/web/src/lib/api/client.ts` (`authFetch` with Supabase JWT session injection from `$lib/supabase/client`).
  - Validation test suite `apps/web/src/lib/admin/admin.test.ts`.

- OUT:
  - Database schema migrations and DDL (created in Plan 003).
  - Privileged PL/pgSQL RPC definitions (created in Plan 004).
  - End-user entry creation, outbox queuing, and background sync engines (handled in Plans 010 and 011).
  - Reports, settlements workflow, and reconciliation views (handled in Plans 012, 013, 014).

## 3. Preconditions

1. Plan 004 RPC functions (`create_or_update_draft_rate_profile`, `publish_rate_profile`, `admin_manage_payment_method`, `admin_manage_payable`, `admin_update_settings`, `admin_review_stale_entry`, `admin_manage_device`, `admin_invite_user`, `admin_manage_user`, `transfer_ownership`) exist in PostgreSQL.
   - Check command: `pnpm --filter db test:schema`
   - Expected output: exit code `0`.
2. Plan 008 server authentication guard `getCallerContext` exists and verifies active user session and role (`admin` or `owner`).
   - Check file: `apps/web/src/lib/server/auth.ts`
3. Plan 007 UI kit components (`Card`, `Button`, `Modal`, `Chip`, `Toast`) exist in `apps/web/src/lib/ui/` and compile without error.
   - Check command: `pnpm --filter @clt/web check`
   - Expected output: `0 errors`.

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `apps/web/src/lib/api/client.ts` | create | Authenticated client fetch wrapper attaching Supabase JWT bearer token |
| `apps/web/src/routes/(app)/admin/+page.svelte` | create | S23 Admin hub dashboard presenting configuration links, anomaly alerts, and pending review badges |
| `apps/web/src/routes/(app)/admin/rates/+page.svelte` | create | S19 Rate profile editor with draft saving, publication gate, and 100% deduction guard |
| `apps/web/src/routes/(app)/admin/methods/+page.svelte` | create | S20 Payment methods manager with activation guard, sort order, and transaction ref toggle |
| `apps/web/src/routes/(app)/admin/payables/+page.svelte` | create | S21 Monthly payables manager with 1–28 due day calendar guard |
| `apps/web/src/routes/(app)/admin/settings/+page.svelte` | create | S22 Organization settings, reconciliation tolerance, and sync retention editor |
| `apps/web/src/routes/(app)/admin/users/+page.svelte` | create | S24 Team member roster, invitation modal, role demote/promote, and deactivation |
| `apps/web/src/routes/(app)/admin/devices/+page.svelte` | create | S25 Device registry and hardware revocation/unrevocation killswitch |
| `apps/web/src/routes/(app)/admin/stale-reviews/+page.svelte` | create | S27 Review queue for >৳50,000 entries created under superseded rate profiles |
| `apps/web/src/routes/(app)/admin/audit/+page.svelte` | create | S25 Chronological audit log viewer with multi-field filtering |
| `apps/web/src/routes/api/v1/admin/rates/draft/+server.ts` | create | Server endpoint to fetch active profile and persist draft profile with method rates array |
| `apps/web/src/routes/api/v1/admin/rates/publish/+server.ts` | create | Server endpoint to publish a draft profile via `publish_rate_profile` |
| `apps/web/src/routes/api/v1/admin/methods/+server.ts` | create | Server endpoint to list and manage payment methods via `admin_manage_payment_method` |
| `apps/web/src/routes/api/v1/admin/payables/+server.ts` | create | Server endpoint to list and configure monthly payables via `admin_manage_payable` |
| `apps/web/src/routes/api/v1/admin/settings/+server.ts` | create | Server endpoint to query and update `app_settings` singleton row where `id = true` |
| `apps/web/src/routes/api/v1/admin/devices/+server.ts` | create | Server endpoint to list active devices and trigger hardware killswitches |
| `apps/web/src/routes/api/v1/admin/users/+server.ts` | create | Server endpoint to list roster with auth emails and manage user roles/status with metadata sync |
| `apps/web/src/routes/api/v1/admin/users/invite/+server.ts` | create | Server endpoint to invite new staff or admin users via GoTrue and `admin_invite_user` |
| `apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts` | create | Server endpoint to execute atomic two-step ownership transfer and sync GoTrue metadata |
| `apps/web/src/routes/api/v1/admin/entries/stale-reviews/+server.ts` | create | Server endpoint to list flagged stale entries with poisha amounts and snapshot version |
| `apps/web/src/routes/api/v1/admin/entries/stale-review/+server.ts` | create | Server endpoint to approve or void a flagged stale entry with `p_reason` |
| `apps/web/src/routes/api/v1/admin/entries/stale-anomalies/+server.ts` | create | Server endpoint to query `view_device_stale_rate_anomalies` |
| `apps/web/src/routes/api/v1/admin/audit/+server.ts` | create | Server endpoint to query audit events with date, actor, table, and action filters |
| `apps/web/src/lib/admin/admin.test.ts` | create | Vitest test suite verifying deduction guards, calendar rules, and schema parsers |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Create authenticated client fetch helper `apps/web/src/lib/api/client.ts` referencing Specification 6.23.
   - Command: copy block 6.23 into `apps/web/src/lib/api/client.ts`.
   - Check: `grep -c 'authFetch' apps/web/src/lib/api/client.ts`
   - Expected output: `1`

2. Create admin hub view `apps/web/src/routes/(app)/admin/+page.svelte` referencing Specification 6.1.
   - Command: copy block 6.1 into `apps/web/src/routes/(app)/admin/+page.svelte`.
   - Check: `grep -c 'Admin Hub' "apps/web/src/routes/(app)/admin/+page.svelte"`
   - Expected output: `1`

3. Create rate profile manager `apps/web/src/routes/(app)/admin/rates/+page.svelte` referencing Specification 6.2.
   - Command: copy block 6.2 into `apps/web/src/routes/(app)/admin/rates/+page.svelte`.
   - Check: `grep -c 'Rate Profiles' "apps/web/src/routes/(app)/admin/rates/+page.svelte"`
   - Expected output: `1`

4. Create payment methods manager `apps/web/src/routes/(app)/admin/methods/+page.svelte` referencing Specification 6.3.
   - Command: copy block 6.3 into `apps/web/src/routes/(app)/admin/methods/+page.svelte`.
   - Check: `grep -c 'Payment Methods' "apps/web/src/routes/(app)/admin/methods/+page.svelte"`
   - Expected output: `1`

5. Create monthly payables manager `apps/web/src/routes/(app)/admin/payables/+page.svelte` referencing Specification 6.4.
   - Command: copy block 6.4 into `apps/web/src/routes/(app)/admin/payables/+page.svelte`.
   - Check: `grep -c 'Monthly Payables' "apps/web/src/routes/(app)/admin/payables/+page.svelte"`
   - Expected output: `1`

6. Create settings editor `apps/web/src/routes/(app)/admin/settings/+page.svelte` referencing Specification 6.5.
   - Command: copy block 6.5 into `apps/web/src/routes/(app)/admin/settings/+page.svelte`.
   - Check: `grep -c 'Application Settings' "apps/web/src/routes/(app)/admin/settings/+page.svelte"`
   - Expected output: `1`

7. Create user roster and ownership transfer UI `apps/web/src/routes/(app)/admin/users/+page.svelte` referencing Specification 6.6.
   - Command: copy block 6.6 into `apps/web/src/routes/(app)/admin/users/+page.svelte`.
   - Check: `grep -c 'Team Roster' "apps/web/src/routes/(app)/admin/users/+page.svelte"`
   - Expected output: `1`

8. Create device registry view `apps/web/src/routes/(app)/admin/devices/+page.svelte` referencing Specification 6.7.
   - Command: copy block 6.7 into `apps/web/src/routes/(app)/admin/devices/+page.svelte`.
   - Check: `grep -c 'Device Registry' "apps/web/src/routes/(app)/admin/devices/+page.svelte"`
   - Expected output: `1`

9. Create stale rate review queue view `apps/web/src/routes/(app)/admin/stale-reviews/+page.svelte` referencing Specification 6.8.
   - Command: copy block 6.8 into `apps/web/src/routes/(app)/admin/stale-reviews/+page.svelte`.
   - Check: `grep -c 'Stale Rate Reviews' "apps/web/src/routes/(app)/admin/stale-reviews/+page.svelte"`
   - Expected output: `1`

10. Create audit viewer `apps/web/src/routes/(app)/admin/audit/+page.svelte` referencing Specification 6.9.
    - Command: copy block 6.9 into `apps/web/src/routes/(app)/admin/audit/+page.svelte`.
    - Check: `grep -c 'Audit Log Viewer' "apps/web/src/routes/(app)/admin/audit/+page.svelte"`
    - Expected output: `1`

11. Implement draft rate endpoint `apps/web/src/routes/api/v1/admin/rates/draft/+server.ts` referencing Specification 6.10.
    - Command: copy block 6.10 into `apps/web/src/routes/api/v1/admin/rates/draft/+server.ts`.
    - Check: `grep -c 'create_or_update_draft_rate_profile' apps/web/src/routes/api/v1/admin/rates/draft/+server.ts`
    - Expected output: `1`

12. Implement rate publish endpoint `apps/web/src/routes/api/v1/admin/rates/publish/+server.ts` referencing Specification 6.11.
    - Command: copy block 6.11 into `apps/web/src/routes/api/v1/admin/rates/publish/+server.ts`.
    - Check: `grep -c 'publish_rate_profile' apps/web/src/routes/api/v1/admin/rates/publish/+server.ts`
    - Expected output: `1`

13. Implement payment methods endpoint `apps/web/src/routes/api/v1/admin/methods/+server.ts` referencing Specification 6.12.
    - Command: copy block 6.12 into `apps/web/src/routes/api/v1/admin/methods/+server.ts`.
    - Check: `grep -c 'admin_manage_payment_method' apps/web/src/routes/api/v1/admin/methods/+server.ts`
    - Expected output: `1`

14. Implement payables endpoint `apps/web/src/routes/api/v1/admin/payables/+server.ts` referencing Specification 6.13.
    - Command: copy block 6.13 into `apps/web/src/routes/api/v1/admin/payables/+server.ts`.
    - Check: `grep -c 'admin_manage_payable' apps/web/src/routes/api/v1/admin/payables/+server.ts`
    - Expected output: `1`

15. Implement settings endpoint `apps/web/src/routes/api/v1/admin/settings/+server.ts` referencing Specification 6.14.
    - Command: copy block 6.14 into `apps/web/src/routes/api/v1/admin/settings/+server.ts`.
    - Check: `grep -c 'admin_update_settings' apps/web/src/routes/api/v1/admin/settings/+server.ts`
    - Expected output: `1`

16. Implement device management endpoint `apps/web/src/routes/api/v1/admin/devices/+server.ts` referencing Specification 6.15.
    - Command: copy block 6.15 into `apps/web/src/routes/api/v1/admin/devices/+server.ts`.
    - Check: `grep -c 'admin_manage_device' apps/web/src/routes/api/v1/admin/devices/+server.ts`
    - Expected output: `1`

17. Implement user management endpoint `apps/web/src/routes/api/v1/admin/users/+server.ts` referencing Specification 6.16.
    - Command: copy block 6.16 into `apps/web/src/routes/api/v1/admin/users/+server.ts`.
    - Check: `grep -c 'admin_manage_user' apps/web/src/routes/api/v1/admin/users/+server.ts`
    - Expected output: `1`

18. Implement user invitation endpoint `apps/web/src/routes/api/v1/admin/users/invite/+server.ts` referencing Specification 6.18.
    - Command: copy block 6.18 into `apps/web/src/routes/api/v1/admin/users/invite/+server.ts`.
    - Check: `grep -c 'admin_invite_user' apps/web/src/routes/api/v1/admin/users/invite/+server.ts`
    - Expected output: `1`

19. Implement ownership transfer endpoint `apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts` referencing Specification 6.17.
    - Command: copy block 6.17 into `apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts`.
    - Check: `grep -c 'transfer_ownership' apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts`
    - Expected output: `1`

20. Implement stale reviews query endpoint `apps/web/src/routes/api/v1/admin/entries/stale-reviews/+server.ts` referencing Specification 6.19.
    - Command: copy block 6.19 into `apps/web/src/routes/api/v1/admin/entries/stale-reviews/+server.ts`.
    - Check: `grep -c 'stale_review_status' apps/web/src/routes/api/v1/admin/entries/stale-reviews/+server.ts`
    - Expected output: `1`

21. Implement stale review execution endpoint `apps/web/src/routes/api/v1/admin/entries/stale-review/+server.ts` referencing Specification 6.20.
    - Command: copy block 6.20 into `apps/web/src/routes/api/v1/admin/entries/stale-review/+server.ts`.
    - Check: `grep -c 'admin_review_stale_entry' apps/web/src/routes/api/v1/admin/entries/stale-review/+server.ts`
    - Expected output: `1`

22. Implement stale rate anomaly aggregation endpoint `apps/web/src/routes/api/v1/admin/entries/stale-anomalies/+server.ts` referencing Specification 6.21.
    - Command: copy block 6.21 into `apps/web/src/routes/api/v1/admin/entries/stale-anomalies/+server.ts`.
    - Check: `grep -c 'view_device_stale_rate_anomalies' apps/web/src/routes/api/v1/admin/entries/stale-anomalies/+server.ts`
    - Expected output: `1`

23. Implement audit query endpoint `apps/web/src/routes/api/v1/admin/audit/+server.ts` referencing Specification 6.22.
    - Command: copy block 6.22 into `apps/web/src/routes/api/v1/admin/audit/+server.ts`.
    - Check: `grep -c 'audit_log' apps/web/src/routes/api/v1/admin/audit/+server.ts`
    - Expected output: `1`

24. Implement admin test suite `apps/web/src/lib/admin/admin.test.ts` referencing Specification 6.24.
    - Command: copy block 6.24 into `apps/web/src/lib/admin/admin.test.ts`.
    - Check: `pnpm --filter @clt/web test admin.test.ts`
    - Expected output: `All tests passing`.


## 6. Specifications

### 6.1 `apps/web/src/routes/(app)/admin/+page.svelte` (S23 Admin Hub)

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';

  interface HubStats {
    activeMethods: number;
    teamMembers: number;
    registeredDevices: number;
    pendingStaleReviews: number;
    publishedRateVersion: number;
    anomalyBursts: number;
  }

  let stats = $state<HubStats>({
    activeMethods: 0,
    teamMembers: 0,
    registeredDevices: 0,
    pendingStaleReviews: 0,
    publishedRateVersion: 1,
    anomalyBursts: 0,
  });
  let loading = $state(true);

  async function loadStats() {
    loading = true;
    try {
      const [methodsRes, usersRes, devicesRes, staleRes, ratesRes, anomaliesRes] = await Promise.all([
        authFetch('/api/v1/admin/methods'),
        authFetch('/api/v1/admin/users'),
        authFetch('/api/v1/admin/devices'),
        authFetch('/api/v1/admin/entries/stale-reviews'),
        authFetch('/api/v1/admin/rates/draft'),
        authFetch('/api/v1/admin/entries/stale-anomalies'),
      ]);

      if (methodsRes.ok) {
        const data = await methodsRes.json();
        stats.activeMethods = data.methods?.filter((m: any) => m.active).length ?? 0;
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        stats.teamMembers = data.users?.length ?? 0;
      }
      if (devicesRes.ok) {
        const data = await devicesRes.json();
        stats.registeredDevices = data.devices?.length ?? 0;
      }
      if (staleRes.ok) {
        const data = await staleRes.json();
        stats.pendingStaleReviews = data.entries?.length ?? 0;
      }
      if (ratesRes.ok) {
        const data = await ratesRes.json();
        stats.publishedRateVersion = data.published?.version ?? 1;
      }
      if (anomaliesRes.ok) {
        const data = await anomaliesRes.json();
        // Burst detection: count devices with >= 5 stale ops in last hour (PRD §7, Test #65)
        stats.anomalyBursts = (data.anomalies || []).filter((a: any) => (a.stale_ops_last_hour ?? 0) >= 5).length;
      }
    } catch (e) {
      console.error('Failed to load admin hub statistics', e);
    } finally {
      loading = false;
    }
  }

  onMount(loadStats);
</script>

<div class="p-6 max-w-6xl mx-auto w-full">
  <div class="mb-8">
    <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Admin Hub</h1>
    <p class="text-sm text-[var(--muted)]">Manage business configuration, rates, devices, and operational parameters.</p>
  </div>

  {#if stats.anomalyBursts > 0}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="font-bold">Security Alert (Test #65):</span>
        <span>{stats.anomalyBursts} device(s) exhibiting abnormal stale-rate submission bursts (&ge; 5 in 1 hour). Inspect device registry.</span>
      </div>
      <a href="/admin/devices">
        <Button variant="default" class="text-xs py-1 px-3 border-red-500/30 text-red-700 hover:bg-red-500/10">Inspect Devices</Button>
      </a>
    </div>
  {/if}

  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    <!-- Rates & Rules -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Rates & Rules</h2>
          <Chip variant="commission">v{stats.publishedRateVersion} Active</Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Configure VAT calculation mode, default rates, commission percentages, and payment method charges.
        </p>
      </div>
      <a href="/admin/rates" class="w-full">
        <Button variant="default" class="w-full">Manage Rates</Button>
      </a>
    </Card>

    <!-- Payment Methods -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Payment Methods</h2>
          <Chip variant="default">{stats.activeMethods} active</Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Enable or disable payment channels (bKash, Nagad, Visa, Mastercard) and enforce reference requirements.
        </p>
      </div>
      <a href="/admin/methods" class="w-full">
        <Button variant="default" class="w-full">Configure Methods</Button>
      </a>
    </Card>

    <!-- Payables & Schedule -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Payables & Schedule</h2>
          <Chip variant="vat">Day 1–28</Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Define recipient settlement accounts, account numbers, and recurring monthly due days.
        </p>
      </div>
      <a href="/admin/payables" class="w-full">
        <Button variant="default" class="w-full">Manage Payables</Button>
      </a>
    </Card>

    <!-- Team & Roles -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Team & Roles</h2>
          <Chip variant="default">{stats.teamMembers} members</Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Invite staff and finance administrators, update roles, manage permissions, and transfer store ownership.
        </p>
      </div>
      <a href="/admin/users" class="w-full">
        <Button variant="default" class="w-full">Manage Users</Button>
      </a>
    </Card>

    <!-- Device Registry -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Device Registry</h2>
          <Chip variant="default">{stats.registeredDevices} devices</Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Monitor physical counter devices, view last sync timestamps, and execute instant revocation killswitches.
        </p>
      </div>
      <a href="/admin/devices" class="w-full">
        <Button variant="default" class="w-full">View Devices</Button>
      </a>
    </Card>

    <!-- Stale Rate Reviews -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Stale Rate Reviews</h2>
          <Chip variant="default" class={stats.pendingStaleReviews > 0 ? 'bg-amber-500/10 text-amber-800 border border-amber-500/20' : ''}>
            {stats.pendingStaleReviews} pending
          </Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Audit and approve high-value offline entries (&gt;৳50,000) created under superseded rate profiles.
        </p>
      </div>
      <a href="/admin/stale-reviews" class="w-full">
        <Button variant="default" class="w-full">Review Queue</Button>
      </a>
    </Card>

    <!-- Application Settings -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Settings</h2>
          <Chip variant="default">Store Info</Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Configure business net label, reconciliation tolerance poisha, and operational thresholds.
        </p>
      </div>
      <a href="/admin/settings" class="w-full">
        <Button variant="default" class="w-full">Store Settings</Button>
      </a>
    </Card>

    <!-- Audit Log Viewer -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Audit Log</h2>
          <Chip variant="default">Append-Only</Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Inspect chronological audit trails for all mutations, settlements, rate adjustments, and admin logins.
        </p>
      </div>
      <a href="/admin/audit" class="w-full">
        <Button variant="default" class="w-full">View Audit Log</Button>
      </a>
    </Card>
  </div>
</div>
```

### 6.2 `apps/web/src/routes/(app)/admin/rates/+page.svelte` (S19 Rates & Rules)

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';

  interface MethodRateItem {
    payment_method_id: string;
    code: string;
    name: string;
    fee_bp: number;
    charges_borne_by: 'business' | 'customer';
  }

  interface RateProfileView {
    id: string;
    version: number;
    effective_from: string;
    vat_mode: 'manual' | 'percent_of_gross' | 'percent_inclusive';
    vat_bp: number;
    commission_base: 'gross_minus_vat' | 'gross';
    commission_bp: number;
    note?: string;
    method_rates: MethodRateItem[];
  }

  let publishedProfile = $state<RateProfileView | null>(null);
  let draftProfile = $state<RateProfileView | null>(null);
  let methods = $state<{ id: string; code: string; name: string }[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let publishing = $state(false);
  let showPublishModal = $state(false);
  let errorMessage = $state('');

  // Draft editing state
  function getDhakaToday(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
  }
  let effectiveFrom = $state(getDhakaToday());
  let vatMode = $state<'manual' | 'percent_of_gross' | 'percent_inclusive'>('manual');
  let vatBp = $state(0);
  let commissionBase = $state<'gross_minus_vat' | 'gross'>('gross_minus_vat');
  let commissionBp = $state(4200);
  let draftNote = $state('');
  let methodRatesList = $state<MethodRateItem[]>([]);

  // Computed total deductions
  let maxMethodCharge = $derived(
    methodRatesList.length > 0 ? Math.max(...methodRatesList.map((m) => m.fee_bp)) : 0
  );
  let totalDeductionsBp = $derived(
    (vatMode === 'manual' ? 0 : vatBp) + commissionBp + maxMethodCharge
  );
  let exceeds100Percent = $derived(totalDeductionsBp > 10000);

  async function loadData() {
    loading = true;
    errorMessage = '';
    try {
      const [ratesRes, methodsRes] = await Promise.all([
        authFetch('/api/v1/admin/rates/draft'),
        authFetch('/api/v1/admin/methods'),
      ]);

      if (methodsRes.ok) {
        const mData = await methodsRes.json();
        methods = mData.methods ?? [];
      }

      if (ratesRes.ok) {
        const rData = await ratesRes.json();
        publishedProfile = rData.published;
        draftProfile = rData.draft;

        if (draftProfile) {
          effectiveFrom = draftProfile.effective_from;
          vatMode = draftProfile.vat_mode;
          vatBp = draftProfile.vat_bp;
          commissionBase = draftProfile.commission_base;
          commissionBp = draftProfile.commission_bp;
          draftNote = draftProfile.note ?? '';
          methodRatesList = draftProfile.method_rates ?? [];
        } else if (publishedProfile) {
          effectiveFrom = getDhakaToday();
          vatMode = publishedProfile.vat_mode;
          vatBp = publishedProfile.vat_bp;
          commissionBase = publishedProfile.commission_base;
          commissionBp = publishedProfile.commission_bp;
          draftNote = '';
          methodRatesList = publishedProfile.method_rates.map((mr) => ({ ...mr }));
        } else {
          methodRatesList = methods.map((m) => ({
            payment_method_id: m.id,
            code: m.code,
            name: m.name,
            fee_bp: 150,
            charges_borne_by: 'business',
          }));
        }
      }
    } catch (e: any) {
      errorMessage = e.message || 'Failed to load rate profiles';
    } finally {
      loading = false;
    }
  }

  async function saveDraft() {
    if (exceeds100Percent) {
      errorMessage = 'Total deductions exceed 100% (10,000 basis points). Adjust rates before saving.';
      return;
    }

    saving = true;
    errorMessage = '';
    try {
      const payload = {
        draftId: draftProfile?.id,
        effectiveFrom,
        vat: { mode: vatMode, rateBp: vatBp },
        commission: { rateBp: commissionBp, base: commissionBase },
        methodRates: methodRatesList.map((m) => ({
          payment_method_id: m.payment_method_id,
          fee_bp: m.fee_bp,
          charges_borne_by: m.charges_borne_by,
        })),
        note: draftNote || undefined,
      };

      const res = await authFetch('/api/v1/admin/rates/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to save draft');
      }

      await loadData();
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      saving = false;
    }
  }

  async function publishDraft() {
    if (!draftProfile?.id) return;
    publishing = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/rates/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: draftProfile.id }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to publish profile');
      }

      showPublishModal = false;
      await loadData();
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      publishing = false;
    }
  }

  onMount(loadData);
</script>

<div class="p-6 max-w-5xl mx-auto w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Rate Profiles & Rules</h1>
      <p class="text-sm text-[var(--muted)]">Configure versioned financial deductions, VAT modes, and channel charges.</p>
    </div>
    <div class="flex gap-3">
      <Button variant="default" onclick={saveDraft} disabled={saving || exceeds100Percent}>
        {saving ? 'Saving...' : 'Save Draft'}
      </Button>
      {#if draftProfile}
        <Button variant="commission" onclick={() => (showPublishModal = true)} disabled={publishing || exceeds100Percent}>
          Publish Profile
        </Button>
      {/if}
    </div>
  </div>

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  {#if exceeds100Percent}
    <div class="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 text-sm flex items-center justify-between">
      <div>
        <span class="font-semibold">Deduction Boundary Violation:</span> Total deductions equal {(totalDeductionsBp / 100).toFixed(2)}%, which exceeds 100.00%. Entries cannot yield negative merchant net.
      </div>
      <Chip variant="default" class="bg-amber-500/20 text-amber-900 border border-amber-500/30">{(totalDeductionsBp / 100).toFixed(2)}%</Chip>
    </div>
  {/if}

  <!-- Active Published Profile Summary -->
  {#if publishedProfile}
    <Card class="p-5 mb-8 border-l-4 border-l-[var(--c-commission)]">
      <div class="flex items-center justify-between mb-4">
        <div>
          <span class="text-xs font-semibold text-[var(--c-commission)] uppercase tracking-wider">Active Published Profile</span>
          <h2 class="text-lg font-bold text-[var(--ink)]">Version {publishedProfile.version} (Effective: {publishedProfile.effective_from})</h2>
        </div>
        <Chip variant="commission">Published</Chip>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
        <div>
          <span class="text-[var(--muted)] block">VAT Mode</span>
          <span class="font-semibold capitalize text-[var(--ink)]">{publishedProfile.vat_mode.replace('_', ' ')}</span>
        </div>
        <div>
          <span class="text-[var(--muted)] block">VAT Rate</span>
          <span class="font-semibold text-[var(--ink)]">{publishedProfile.vat_bp / 100}%</span>
        </div>
        <div>
          <span class="text-[var(--muted)] block">Commission</span>
          <span class="font-semibold text-[var(--ink)]">{publishedProfile.commission_bp / 100}% ({publishedProfile.commission_base})</span>
        </div>
        <div>
          <span class="text-[var(--muted)] block">Channels Configured</span>
          <span class="font-semibold text-[var(--ink)]">{publishedProfile.method_rates.length} methods</span>
        </div>
      </div>
    </Card>
  {/if}

  <!-- Draft Profile Editor Form -->
  <Card class="p-6">
    <div class="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-4 mb-6">
      <div>
        <h2 class="text-lg font-semibold text-[var(--ink)]">Draft Rate Profile</h2>
        <p class="text-xs text-[var(--muted)]">Updates take effect on or after the effective date once published.</p>
      </div>
      <Chip variant="default">{draftProfile ? 'Draft in Progress' : 'New Draft'}</Chip>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
      <div>
        <label for="effective-date" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Effective Date (Asia/Dhaka)</label>
        <input
          id="effective-date"
          type="date"
          bind:value={effectiveFrom}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
        />
        <p class="text-[11px] text-[var(--muted)] mt-1">Must be today or in the future; past dates will be rejected upon publishing.</p>
      </div>

      <div>
        <label for="vat-mode-select" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">VAT Calculation Mode</label>
        <select
          id="vat-mode-select"
          bind:value={vatMode}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
        >
          <option value="manual">Manual Entry (Staff inputs exact VAT amount)</option>
          <option value="percent_of_gross">Percent of Gross (e.g. 5% applied directly to gross)</option>
          <option value="percent_inclusive">Percent Inclusive (VAT included in gross amount)</option>
        </select>
      </div>

      {#if vatMode !== 'manual'}
        <div>
          <label for="vat-bp-input" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Default VAT Rate (Basis Points)</label>
          <div class="flex items-center gap-2">
            <input
              id="vat-bp-input"
              type="number"
              min="0"
              max="10000"
              bind:value={vatBp}
              class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
            />
            <span class="text-sm font-mono text-[var(--muted)]">{(vatBp / 100).toFixed(2)}%</span>
          </div>
        </div>
      {/if}

      <div>
        <label for="comm-bp-input" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Default Commission Rate (Basis Points)</label>
        <div class="flex items-center gap-2">
          <input
            id="comm-bp-input"
            type="number"
            min="0"
            max="10000"
            bind:value={commissionBp}
            class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
          />
          <span class="text-sm font-mono text-[var(--muted)]">{(commissionBp / 100).toFixed(2)}%</span>
        </div>
      </div>

      <div>
        <label for="comm-base-select" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Commission Base</label>
        <select
          id="comm-base-select"
          bind:value={commissionBase}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
        >
          <option value="gross_minus_vat">Gross Minus VAT (Standard)</option>
          <option value="gross">Gross Total</option>
        </select>
      </div>

      <div>
        <label for="draft-note-input" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Draft Revision Note (Optional)</label>
        <input
          id="draft-note-input"
          type="text"
          placeholder="e.g. Q4 Updated Gateway Rates"
          bind:value={draftNote}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
        />
      </div>
    </div>

    <!-- Payment Method Rates Table -->
    <div class="mt-8 border-t border-black/10 dark:border-white/10 pt-6">
      <h3 class="text-sm font-bold text-[var(--ink)] mb-4">Payment Method Charges & Liability</h3>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="border-b border-black/10 dark:border-white/10 text-[var(--muted)]">
            <tr>
              <th class="py-2 px-3 font-semibold">Channel</th>
              <th class="py-2 px-3 font-semibold">Charge (Basis Points)</th>
              <th class="py-2 px-3 font-semibold">Percentage</th>
              <th class="py-2 px-3 font-semibold">Charges Borne By</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-black/5 dark:divide-white/5">
            {#each methodRatesList as mr, idx}
              <tr>
                <td class="py-3 px-3 font-medium text-[var(--ink)]">
                  {mr.name} <span class="font-mono text-[var(--muted)]">({mr.code})</span>
                </td>
                <td class="py-3 px-3">
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    aria-label={`Fee in basis points for ${mr.name}`}
                    bind:value={mr.fee_bp}
                    class="w-28 px-2 py-1 rounded border border-black/10 dark:border-white/10 bg-white/50 text-xs font-mono"
                  />
                </td>
                <td class="py-3 px-3 font-mono text-[var(--muted)]">
                  {(mr.fee_bp / 100).toFixed(2)}%
                </td>
                <td class="py-3 px-3">
                  <select
                    bind:value={mr.charges_borne_by}
                    aria-label={`Charges borne by for ${mr.name}`}
                    class="px-2 py-1 rounded border border-black/10 dark:border-white/10 bg-white/50 text-xs"
                  >
                    <option value="business">Business Borne</option>
                    <option value="customer">Customer Borne</option>
                  </select>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </Card>
</div>

<!-- Publish Confirmation Modal -->
<Modal bind:open={showPublishModal} title="Confirm Rate Profile Publication" onclose={() => (showPublishModal = false)}>
  <div class="space-y-4">
    <p class="text-sm text-[var(--ink)]">
      Publishing this rate profile will make it immutable and effective starting <strong class="font-mono">{effectiveFrom}</strong>.
    </p>
    <div class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 space-y-1">
      <p class="font-semibold">Immutability Notice:</p>
      <p>• Published profiles cannot be edited, deleted, or backdated.</p>
      <p>• Historical entries will NOT be retroactively recalculated.</p>
      <p>• Offline entries using older rates will be audited upon sync.</p>
    </div>
    <div class="flex justify-end gap-3 pt-4">
      <Button variant="default" onclick={() => (showPublishModal = false)}>Cancel</Button>
      <Button variant="commission" onclick={publishDraft} disabled={publishing}>
        {publishing ? 'Publishing...' : 'Confirm Publication'}
      </Button>
    </div>
  </div>
</Modal>
```

### 6.3 `apps/web/src/routes/(app)/admin/methods/+page.svelte` (S20 Payment Methods)

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';

  interface PaymentMethod {
    id: string;
    code: string;
    name: string;
    active: boolean;
    requires_txn_ref: boolean;
    sort_order: number;
    created_at: string;
  }

  let methods = $state<PaymentMethod[]>([]);
  let loading = $state(true);
  let showModal = $state(false);
  let isEditing = $state(false);
  let saving = $state(false);
  let errorMessage = $state('');

  // Form state
  let currentId = $state<string | null>(null);
  let methodCode = $state('');
  let methodName = $state('');
  let methodActive = $state(true);
  let methodRequiresTxnRef = $state(false);
  let methodSortOrder = $state(0);

  async function loadMethods() {
    loading = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/methods');
      if (res.ok) {
        const data = await res.json();
        methods = data.methods ?? [];
      } else {
        const err = await res.json();
        errorMessage = err.message || 'Failed to load methods';
      }
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      loading = false;
    }
  }

  function openCreateModal() {
    isEditing = false;
    currentId = null;
    methodCode = '';
    methodName = '';
    methodActive = true;
    methodRequiresTxnRef = false;
    methodSortOrder = methods.length + 1;
    showModal = true;
  }

  function openEditModal(m: PaymentMethod) {
    isEditing = true;
    currentId = m.id;
    methodCode = m.code; // Read-only in edit mode per PRD §7.3
    methodName = m.name;
    methodActive = m.active;
    methodRequiresTxnRef = m.requires_txn_ref;
    methodSortOrder = m.sort_order;
    showModal = true;
  }

  async function saveMethod() {
    saving = true;
    errorMessage = '';
    try {
      const payload = {
        id: currentId,
        code: methodCode.toLowerCase().trim(),
        name: methodName.trim(),
        active: methodActive,
        requires_txn_ref: methodRequiresTxnRef,
        display_order: methodSortOrder,
      };

      const res = await authFetch('/api/v1/admin/methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to save payment method');
      }

      showModal = false;
      await loadMethods();
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      saving = false;
    }
  }

  onMount(loadMethods);
</script>

<div class="p-6 max-w-5xl mx-auto w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Payment Methods</h1>
      <p class="text-sm text-[var(--muted)]">Configure active payment channels, transaction reference requirements, and display ordering.</p>
    </div>
    <Button variant="default" onclick={openCreateModal}>Add Payment Method</Button>
  </div>

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  <Card class="p-0 overflow-hidden">
    <table class="w-full text-left text-sm">
      <thead class="border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] text-xs">
        <tr>
          <th class="py-3 px-4 font-semibold">Order</th>
          <th class="py-3 px-4 font-semibold">Channel Name</th>
          <th class="py-3 px-4 font-semibold">Identifier Code</th>
          <th class="py-3 px-4 font-semibold">Reference Required</th>
          <th class="py-3 px-4 font-semibold">Status</th>
          <th class="py-3 px-4 font-semibold text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-black/5 dark:divide-white/5">
        {#each methods as m (m.id)}
          <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
            <td class="py-3 px-4 font-mono text-xs text-[var(--muted)]">{m.sort_order}</td>
            <td class="py-3 px-4 font-medium text-[var(--ink)]">{m.name}</td>
            <td class="py-3 px-4 font-mono text-xs text-[var(--muted)]">{m.code}</td>
            <td class="py-3 px-4">
              {#if m.requires_txn_ref}
                <Chip variant="default">Txn Ref Required</Chip>
              {:else}
                <span class="text-xs text-[var(--muted)]">Optional</span>
              {/if}
            </td>
            <td class="py-3 px-4">
              <Chip variant={m.active ? 'commission' : 'default'}>
                {m.active ? 'Active' : 'Inactive'}
              </Chip>
            </td>
            <td class="py-3 px-4 text-right">
              <Button variant="default" class="text-xs py-1 px-3" onclick={() => openEditModal(m)}>
                Edit
              </Button>
            </td>
          </tr>
        {/each}
        {#if methods.length === 0 && !loading}
          <tr>
            <td colspan="6" class="py-8 text-center text-sm text-[var(--muted)]">
              No payment methods configured.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </Card>
</div>

<!-- Create / Edit Modal -->
<Modal bind:open={showModal} title={isEditing ? 'Edit Payment Method' : 'Add Payment Method'} onclose={() => (showModal = false)}>
  <div class="space-y-4">
    <div>
      <label for="method-name" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Display Name</label>
      <input
        id="method-name"
        type="text"
        placeholder="e.g. bKash Merchant"
        bind:value={methodName}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
      />
    </div>

    <div>
      <label for="method-code" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Code (Immutable after creation)</label>
      <input
        id="method-code"
        type="text"
        placeholder="e.g. bkash"
        bind:value={methodCode}
        disabled={isEditing}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono disabled:opacity-50"
      />
      {#if isEditing}
        <p class="text-[11px] text-[var(--muted)] mt-1">Method codes are permanently bound to financial records and cannot be altered.</p>
      {/if}
    </div>

    <div>
      <label for="method-order" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Sort Order</label>
      <input
        id="method-order"
        type="number"
        min="0"
        bind:value={methodSortOrder}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
      />
    </div>

    <div class="pt-2 space-y-2">
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" bind:checked={methodRequiresTxnRef} class="rounded border-black/20 text-black" />
        <span class="text-sm font-medium text-[var(--ink)]">Require Transaction Reference on Entry</span>
      </label>
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" bind:checked={methodActive} class="rounded border-black/20 text-black" />
        <span class="text-sm font-medium text-[var(--ink)]">Active for Payment Entry</span>
      </label>
    </div>

    <div class="flex justify-end gap-3 pt-4">
      <Button variant="default" onclick={() => (showModal = false)}>Cancel</Button>
      <Button variant="default" onclick={saveMethod} disabled={saving || !methodName || !methodCode}>
        {saving ? 'Saving...' : 'Save Method'}
      </Button>
    </div>
  </div>
</Modal>
```

### 6.4 `apps/web/src/routes/(app)/admin/payables/+page.svelte` (S21 Payables & Schedule)

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';

  interface Payable {
    id: string;
    code: string;
    name: string;
    kind: 'vat' | 'method_charge';
    method_id: string | null;
    method_name?: string;
    due_day: number;
    remind_days_before: number;
    active: boolean;
  }

  let payables = $state<Payable[]>([]);
  let methods = $state<{ id: string; name: string }[]>([]);
  let loading = $state(true);
  let showModal = $state(false);
  let isEditing = $state(false);
  let saving = $state(false);
  let errorMessage = $state('');

  // Form state
  let currentId = $state<string | null>(null);
  let payableCode = $state('');
  let payableName = $state('');
  let payableKind = $state<'vat' | 'method_charge'>('vat');
  let payableMethodId = $state<string | null>(null);
  let dueDay = $state(15);
  let remindDaysBefore = $state(3);
  let payableActive = $state(true);

  let invalidDueDay = $derived(dueDay < 1 || dueDay > 28);
  let invalidRemindDays = $derived(remindDaysBefore < 0 || remindDaysBefore > 14);

  async function loadData() {
    loading = true;
    errorMessage = '';
    try {
      const [payablesRes, methodsRes] = await Promise.all([
        authFetch('/api/v1/admin/payables'),
        authFetch('/api/v1/admin/methods'),
      ]);

      if (methodsRes.ok) {
        const mData = await methodsRes.json();
        methods = mData.methods ?? [];
      }

      if (payablesRes.ok) {
        const pData = await payablesRes.json();
        payables = pData.payables ?? [];
      }
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      loading = false;
    }
  }

  function openCreateModal() {
    isEditing = false;
    currentId = null;
    payableCode = '';
    payableName = '';
    payableKind = 'vat';
    payableMethodId = null;
    dueDay = 15;
    remindDaysBefore = 3;
    payableActive = true;
    showModal = true;
  }

  function openEditModal(p: Payable) {
    isEditing = true;
    currentId = p.id;
    payableCode = p.code;
    payableName = p.name;
    payableKind = p.kind;
    payableMethodId = p.method_id;
    dueDay = p.due_day;
    remindDaysBefore = p.remind_days_before;
    payableActive = p.active;
    showModal = true;
  }

  async function savePayable() {
    if (invalidDueDay) {
      errorMessage = 'Due day must be between 1 and 28 to avoid calendar inconsistencies across February.';
      return;
    }
    if (invalidRemindDays) {
      errorMessage = 'Remind days before must be between 0 and 14.';
      return;
    }

    saving = true;
    errorMessage = '';
    try {
      const payload = {
        id: currentId,
        code: payableCode.toLowerCase().trim(),
        name: payableName.trim(),
        kind: payableKind,
        method_id: payableKind === 'vat' ? null : payableMethodId,
        due_day: dueDay,
        remind_days_before: remindDaysBefore,
        active: payableActive,
      };

      const res = await authFetch('/api/v1/admin/payables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to save payable');
      }

      showModal = false;
      await loadData();
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      saving = false;
    }
  }

  onMount(loadData);
</script>

<div class="p-6 max-w-5xl mx-auto w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Payables & Settlement Schedule</h1>
      <p class="text-sm text-[var(--muted)]">Configure recipient settlement accounts, authorities, and recurring due dates (1–28).</p>
    </div>
    <Button variant="default" onclick={openCreateModal}>Add Payable</Button>
  </div>

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  <Card class="p-0 overflow-hidden">
    <table class="w-full text-left text-sm">
      <thead class="border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] text-xs">
        <tr>
          <th class="py-3 px-4 font-semibold">Category</th>
          <th class="py-3 px-4 font-semibold">Payable Code</th>
          <th class="py-3 px-4 font-semibold">Account / Description</th>
          <th class="py-3 px-4 font-semibold">Monthly Due Day</th>
          <th class="py-3 px-4 font-semibold">Status</th>
          <th class="py-3 px-4 font-semibold text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-black/5 dark:divide-white/5">
        {#each payables as p (p.id)}
          <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
            <td class="py-3 px-4">
              <Chip variant={p.kind === 'vat' ? 'vat' : 'default'}>
                {p.kind === 'vat' ? 'VAT Authority' : (p.method_name ?? 'Method Charge')}
              </Chip>
            </td>
            <td class="py-3 px-4 font-mono text-xs font-medium text-[var(--ink)]">{p.code}</td>
            <td class="py-3 px-4 text-xs text-[var(--muted)]">{p.name}</td>
            <td class="py-3 px-4 font-mono text-xs">Day {p.due_day} of month (Remind: {p.remind_days_before}d)</td>
            <td class="py-3 px-4">
              <Chip variant={p.active ? 'commission' : 'default'}>
                {p.active ? 'Active' : 'Inactive'}
              </Chip>
            </td>
            <td class="py-3 px-4 text-right">
              <Button variant="default" class="text-xs py-1 px-3" onclick={() => openEditModal(p)}>
                Edit
              </Button>
            </td>
          </tr>
        {/each}
        {#if payables.length === 0 && !loading}
          <tr>
            <td colspan="6" class="py-8 text-center text-sm text-[var(--muted)]">
              No payables configured.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </Card>
</div>

<!-- Modal -->
<Modal bind:open={showModal} title={isEditing ? 'Edit Payable' : 'Add Monthly Payable'} onclose={() => (showModal = false)}>
  <div class="space-y-4">
    <div>
      <label for="payable-kind-select" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Payable Type</label>
      <select
        id="payable-kind-select"
        bind:value={payableKind}
        disabled={isEditing}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm disabled:opacity-50"
      >
        <option value="vat">VAT (National Board of Revenue / Authority)</option>
        <option value="method_charge">Payment Method Charge (Bank / Merchant Gateway)</option>
      </select>
    </div>

    {#if payableKind === 'method_charge'}
      <div>
        <label for="payable-method-select" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Associated Channel</label>
        <select
          id="payable-method-select"
          bind:value={payableMethodId}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
        >
          <option value={null}>Select Payment Channel...</option>
          {#each methods as m}
            <option value={m.id}>{m.name}</option>
          {/each}
        </select>
      </div>
    {/if}

    <div>
      <label for="payable-code" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Payable Code (Immutable)</label>
      <input
        id="payable-code"
        type="text"
        placeholder="e.g. vat_nbr or fee_bkash"
        bind:value={payableCode}
        disabled={isEditing}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono disabled:opacity-50"
      />
    </div>

    <div>
      <label for="payable-name" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Payable Description / Account Name</label>
      <input
        id="payable-name"
        type="text"
        placeholder="e.g. National Board of Revenue VAT Account"
        bind:value={payableName}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
      />
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label for="due-day" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Monthly Due Day (1–28)</label>
        <input
          id="due-day"
          type="number"
          min="1"
          max="28"
          bind:value={dueDay}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
        />
        <p class="text-[11px] text-[var(--muted)] mt-1">1–28 per PRD §8.6.</p>
      </div>
      <div>
        <label for="remind-days" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Remind Days (0–14)</label>
        <input
          id="remind-days"
          type="number"
          min="0"
          max="14"
          bind:value={remindDaysBefore}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
        />
        <p class="text-[11px] text-[var(--muted)] mt-1">Days before due day.</p>
      </div>
    </div>

    <div class="pt-2">
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" bind:checked={payableActive} class="rounded border-black/20 text-black" />
        <span class="text-sm font-medium text-[var(--ink)]">Active Payable</span>
      </label>
    </div>

    <div class="flex justify-end gap-3 pt-4">
      <Button variant="default" onclick={() => (showModal = false)}>Cancel</Button>
      <Button variant="default" onclick={savePayable} disabled={saving || invalidDueDay || invalidRemindDays || !payableName || !payableCode}>
        {saving ? 'Saving...' : 'Save Payable'}
      </Button>
    </div>
  </div>
</Modal>
```

### 6.5 `apps/web/src/routes/(app)/admin/settings/+page.svelte` (S22 Application Settings)

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';

  interface AppSettings {
    timezone: string;
    currency: string;
    locale: string;
    net_label: string;
    reconcile_tolerance_poisha: number;
    sync_retention_days: number;
  }

  let settings = $state<AppSettings>({
    timezone: 'Asia/Dhaka',
    currency: 'BDT',
    locale: 'en-BD',
    net_label: 'Net after deductions',
    reconcile_tolerance_poisha: 100,
    sync_retention_days: 90,
  });
  let loading = $state(true);
  let saving = $state(false);
  let successMessage = $state('');
  let errorMessage = $state('');

  async function loadSettings() {
    loading = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          settings = {
            timezone: data.settings.timezone ?? 'Asia/Dhaka',
            currency: data.settings.currency ?? 'BDT',
            locale: data.settings.locale ?? 'en-BD',
            net_label: data.settings.net_label ?? 'Net after deductions',
            reconcile_tolerance_poisha: Number(data.settings.reconcile_tolerance_poisha ?? 100),
            sync_retention_days: 90,
          };
        }
      } else {
        const err = await res.json();
        errorMessage = err.message || 'Failed to load settings';
      }
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      loading = false;
    }
  }

  async function saveSettings() {
    saving = true;
    errorMessage = '';
    successMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          net_label: settings.net_label.trim(),
          reconcile_tolerance_poisha: settings.reconcile_tolerance_poisha,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to save settings');
      }

      successMessage = 'Application settings updated successfully.';
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      saving = false;
    }
  }

  onMount(loadSettings);
</script>

<div class="p-6 max-w-4xl mx-auto w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Application Settings</h1>
      <p class="text-sm text-[var(--muted)]">Configure operational parameters, net terminology, and reconciliation tolerances.</p>
    </div>
    <Button variant="default" onclick={saveSettings} disabled={saving || !settings.net_label}>
      {saving ? 'Saving...' : 'Save Settings'}
    </Button>
  </div>

  {#if successMessage}
    <div class="mb-6 p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-700 text-sm">
      {successMessage}
    </div>
  {/if}

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  <Card class="p-6 space-y-6">
    <div class="border-b border-black/10 dark:border-white/10 pb-4">
      <h2 class="text-base font-semibold text-[var(--ink)]">Financial Terminology & Tolerances</h2>
      <p class="text-xs text-[var(--muted)]">Operational settings editable by Administrators and Owners (PRD §4 Q2, §7.1).</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <label for="net-label" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Net Earnings Display Label</label>
        <input
          id="net-label"
          type="text"
          placeholder="e.g. Net after deductions, Final Net"
          bind:value={settings.net_label}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
        />
        <p class="text-[11px] text-[var(--muted)] mt-1">Configurable terminology for merchant payout amount displayed on dashboards and reports.</p>
      </div>

      <div>
        <label for="tolerance-poisha" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Reconciliation Tolerance (Poisha)</label>
        <div class="flex items-center gap-2">
          <input
            id="tolerance-poisha"
            type="number"
            min="0"
            bind:value={settings.reconcile_tolerance_poisha}
            class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
          />
          <span class="text-xs font-mono text-[var(--muted)] whitespace-nowrap">
            ৳{(settings.reconcile_tolerance_poisha / 100).toFixed(2)}
          </span>
        </div>
        <p class="text-[11px] text-[var(--muted)] mt-1">Default 100 poisha (৳1.00) tolerance for automated Mode A statement matches.</p>
      </div>
    </div>

    <div class="border-t border-black/10 dark:border-white/10 pt-6">
      <h2 class="text-base font-semibold text-[var(--ink)] mb-1">System Environment Parameters</h2>
      <p class="text-xs text-[var(--muted)] mb-4">Read-only operational constants enforced by database constraints (PRD §7.1).</p>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <span class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Timezone</span>
          <div class="flex items-center gap-2">
            <span class="font-mono text-sm text-[var(--ink)]">{settings.timezone}</span>
            <Chip variant="default">Fixed</Chip>
          </div>
          <p class="text-[11px] text-[var(--muted)] mt-1">All business dates evaluate at Asia/Dhaka midnight.</p>
        </div>

        <div>
          <span class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Currency & Locale</span>
          <div class="flex items-center gap-2">
            <span class="font-mono text-sm text-[var(--ink)]">{settings.currency} ({settings.locale})</span>
            <Chip variant="default">BDT</Chip>
          </div>
          <p class="text-[11px] text-[var(--muted)] mt-1">Financial calculations evaluate in integer poisha.</p>
        </div>

        <div>
          <span class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Sync Log Retention</span>
          <div class="flex items-center gap-2">
            <span class="font-mono text-sm text-[var(--ink)]">{settings.sync_retention_days} Days</span>
            <Chip variant="default">PRD §9.1</Chip>
          </div>
          <p class="text-[11px] text-[var(--muted)] mt-1">Resolved sync operations purged after 90 days via pg_cron.</p>
        </div>
      </div>
    </div>
  </Card>
</div>
```


### 6.6 `apps/web/src/routes/(app)/admin/users/+page.svelte` (S24 Users & S26 Ownership Transfer)

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';

  interface UserProfile {
    id: string;
    email: string;
    display_name: string;
    role: 'owner' | 'admin' | 'staff';
    active: boolean;
    created_at: string;
  }

  let users = $state<UserProfile[]>([]);
  let callerRole = $state<string>('staff');
  let loading = $state(true);
  let showInviteModal = $state(false);
  let showTransferModal = $state(false);
  let inviting = $state(false);
  let transferring = $state(false);
  let errorMessage = $state('');
  let successMessage = $state('');

  // Invite state
  let inviteEmail = $state('');
  let inviteFullName = $state('');
  let inviteRole = $state<'staff' | 'admin'>('staff');

  // Ownership transfer state
  let targetAdminId = $state('');
  let transferConfirmText = $state('');

  async function loadUsers() {
    loading = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/users');
      if (res.ok) {
        const data = await res.json();
        users = data.users ?? [];
        callerRole = data.callerRole ?? 'staff';
      } else {
        const err = await res.json();
        errorMessage = err.message || 'Failed to load user roster';
      }
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      loading = false;
    }
  }

  async function inviteUser() {
    inviting = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
          fullName: inviteFullName.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to invite user');
      }

      showInviteModal = false;
      inviteEmail = '';
      inviteFullName = '';
      inviteRole = 'staff';
      successMessage = 'Invitation sent successfully.';
      await loadUsers();
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      inviting = false;
    }
  }

  async function updateUserRole(userId: string, newRole: 'staff' | 'admin') {
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_role',
          userId,
          role: newRole,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to update user role');
      }

      await loadUsers();
    } catch (e: any) {
      errorMessage = e.message;
    }
  }

  async function toggleUserActive(u: UserProfile) {
    errorMessage = '';
    try {
      const nextAction = u.active ? 'deactivate' : 'reactivate';
      const res = await authFetch('/api/v1/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: nextAction,
          userId: u.id,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to update user status');
      }

      await loadUsers();
    } catch (e: any) {
      errorMessage = e.message;
    }
  }

  async function executeTransferOwnership() {
    if (transferConfirmText !== 'TRANSFER OWNERSHIP') {
      errorMessage = 'Please type TRANSFER OWNERSHIP in capital letters to confirm.';
      return;
    }

    transferring = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/transfer-ownership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newOwnerId: targetAdminId,
          confirmationPhrase: transferConfirmText,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to transfer ownership');
      }

      showTransferModal = false;
      targetAdminId = '';
      transferConfirmText = '';
      successMessage = 'Ownership transferred successfully. Your account has been demoted to Admin.';
      await loadUsers();
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      transferring = false;
    }
  }

  onMount(loadUsers);
</script>

<div class="p-6 max-w-5xl mx-auto w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Team Roster & Roles</h1>
      <p class="text-sm text-[var(--muted)]">Manage authorized staff, administrators, and store ownership privileges.</p>
    </div>
    <div class="flex gap-3">
      {#if callerRole === 'owner'}
        <Button variant="default" onclick={() => (showTransferModal = true)}>
          Transfer Ownership
        </Button>
      {/if}
      <Button variant="default" onclick={() => (showInviteModal = true)}>
        Invite Team Member
      </Button>
    </div>
  </div>

  {#if successMessage}
    <div class="mb-6 p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-700 text-sm">
      {successMessage}
    </div>
  {/if}

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  <Card class="p-0 overflow-hidden">
    <table class="w-full text-left text-sm">
      <thead class="border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] text-xs">
        <tr>
          <th class="py-3 px-4 font-semibold">Name & Email</th>
          <th class="py-3 px-4 font-semibold">Role</th>
          <th class="py-3 px-4 font-semibold">Account Status</th>
          <th class="py-3 px-4 font-semibold">Joined</th>
          <th class="py-3 px-4 font-semibold text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-black/5 dark:divide-white/5">
        {#each users as u (u.id)}
          <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
            <td class="py-3 px-4">
              <div class="font-medium text-[var(--ink)]">{u.display_name}</div>
              <div class="font-mono text-xs text-[var(--muted)]">{u.email}</div>
            </td>
            <td class="py-3 px-4">
              <Chip variant={u.role === 'owner' ? 'commission' : u.role === 'admin' ? 'default' : 'vat'}>
                {u.role.toUpperCase()}
              </Chip>
            </td>
            <td class="py-3 px-4">
              <Chip variant={u.active ? 'commission' : 'default'}>
                {u.active ? 'Active' : 'Deactivated'}
              </Chip>
            </td>
            <td class="py-3 px-4 font-mono text-xs text-[var(--muted)]">
              {new Date(u.created_at).toLocaleDateString()}
            </td>
            <td class="py-3 px-4 text-right">
              <div class="flex items-center justify-end gap-2">
                {#if (callerRole === 'owner' && u.role !== 'owner') || (callerRole === 'admin' && u.role === 'staff')}
                  {#if callerRole === 'owner'}
                    <select
                      value={u.role}
                      onchange={(e) => updateUserRole(u.id, (e.target as HTMLSelectElement).value as any)}
                      class="text-xs px-2 py-1 rounded border border-black/10 dark:border-white/10 bg-white/50"
                    >
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  {/if}

                  <Button
                    variant="default"
                    class="text-xs py-1 px-2.5"
                    onclick={() => toggleUserActive(u)}
                  >
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                {:else if u.role === 'owner'}
                  <span class="text-xs text-[var(--muted)] italic">Sole Owner</span>
                {/if}
              </div>
            </td>
          </tr>
        {/each}
        {#if users.length === 0 && !loading}
          <tr>
            <td colspan="5" class="py-8 text-center text-sm text-[var(--muted)]">
              No team members found.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </Card>
</div>

<!-- Invite Modal -->
<Modal bind:open={showInviteModal} title="Invite New Team Member" onclose={() => (showInviteModal = false)}>
  <div class="space-y-4">
    <div>
      <label for="invite-fullname" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Full Name</label>
      <input
        id="invite-fullname"
        type="text"
        placeholder="e.g. Rahim Ahmed"
        bind:value={inviteFullName}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
      />
    </div>

    <div>
      <label for="invite-email" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Email Address</label>
      <input
        id="invite-email"
        type="email"
        placeholder="rahim@cosmoledger.local"
        bind:value={inviteEmail}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
      />
    </div>

    <div>
      <label for="invite-role-select" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Assigned Role</label>
      <select
        id="invite-role-select"
        bind:value={inviteRole}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
      >
        <option value="staff">Staff (Daily entry creation & local offline sync)</option>
        {#if callerRole === 'owner'}
          <option value="admin">Administrator (Rate rules, payables & user management)</option>
        {/if}
      </select>
      <p class="text-[11px] text-[var(--muted)] mt-1">
        Only the active store Owner can provision Administrator accounts. Owner accounts cannot be provisioned via invite.
      </p>
    </div>

    <div class="flex justify-end gap-3 pt-4">
      <Button variant="default" onclick={() => (showInviteModal = false)}>Cancel</Button>
      <Button variant="default" onclick={inviteUser} disabled={inviting || !inviteEmail || !inviteFullName}>
        {inviting ? 'Inviting...' : 'Send Invitation'}
      </Button>
    </div>
  </div>
</Modal>

<!-- Ownership Transfer Modal -->
<Modal bind:open={showTransferModal} title="Two-Step Atomic Ownership Transfer" onclose={() => (showTransferModal = false)}>
  <div class="space-y-4">
    <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-800 space-y-1">
      <p class="font-semibold">Irreversible Owner Transfer Warning:</p>
      <p>• You are surrendering sole ownership of this organization.</p>
      <p>• The selected Admin will be elevated to Owner.</p>
      <p>• Your account will be demoted to Administrator atomically in a single transaction.</p>
      <p>• This action is immediately committed and logged in the append-only audit trail.</p>
    </div>

    <div>
      <label for="transfer-admin-select" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Select Successor Administrator</label>
      <select
        id="transfer-admin-select"
        bind:value={targetAdminId}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
      >
        <option value="">Select active Admin...</option>
        {#each users.filter((u) => u.role === 'admin' && u.active) as a}
          <option value={a.id}>{a.display_name} ({a.email})</option>
        {/each}
      </select>
    </div>

    <div>
      <label for="transfer-confirm-input" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">
        Type <strong class="text-red-700">TRANSFER OWNERSHIP</strong> to confirm:
      </label>
      <input
        id="transfer-confirm-input"
        type="text"
        bind:value={transferConfirmText}
        placeholder="TRANSFER OWNERSHIP"
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
      />
    </div>

    <div class="flex justify-end gap-3 pt-4">
      <Button variant="default" onclick={() => (showTransferModal = false)}>Cancel</Button>
      <Button
        variant="default"
        class="bg-red-700 hover:bg-red-800 text-white"
        onclick={executeTransferOwnership}
        disabled={transferring || !targetAdminId || transferConfirmText !== 'TRANSFER OWNERSHIP'}
      >
        {transferring ? 'Transferring...' : 'Execute Ownership Transfer'}
      </Button>
    </div>
  </div>
</Modal>
```

### 6.7 `apps/web/src/routes/(app)/admin/devices/+page.svelte` (S25 Device Registry)

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';

  interface DeviceEntry {
    device_id: string;
    label: string | null;
    platform: string | null;
    last_seen_at: string;
    revoked: boolean;
    active_users: { user_id: string; full_name: string; email: string }[];
  }

  let devices = $state<DeviceEntry[]>([]);
  let loading = $state(true);
  let showRevokeModal = $state(false);
  let revoking = $state(false);
  let selectedDevice = $state<DeviceEntry | null>(null);
  let errorMessage = $state('');

  async function loadDevices() {
    loading = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/devices');
      if (res.ok) {
        const data = await res.json();
        devices = data.devices ?? [];
      } else {
        const err = await res.json();
        errorMessage = err.message || 'Failed to load device registry';
      }
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      loading = false;
    }
  }

  function confirmRevocation(d: DeviceEntry) {
    selectedDevice = d;
    showRevokeModal = true;
  }

  async function executeRevocation() {
    if (!selectedDevice) return;
    revoking = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: selectedDevice.device_id,
          action: 'revoke',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to revoke device');
      }

      showRevokeModal = false;
      selectedDevice = null;
      await loadDevices();
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      revoking = false;
    }
  }

  onMount(loadDevices);
</script>

<div class="p-6 max-w-5xl mx-auto w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Hardware Device Registry</h1>
      <p class="text-sm text-[var(--muted)]">Track paired POS counter terminals, associated staff sessions, and hardware killswitches.</p>
    </div>
    <Button variant="default" onclick={loadDevices}>Refresh</Button>
  </div>

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  <Card class="p-0 overflow-hidden">
    <table class="w-full text-left text-sm">
      <thead class="border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] text-xs">
        <tr>
          <th class="py-3 px-4 font-semibold">Device UUID & Label</th>
          <th class="py-3 px-4 font-semibold">Platform</th>
          <th class="py-3 px-4 font-semibold">Paired Staff Users</th>
          <th class="py-3 px-4 font-semibold">Last Synced</th>
          <th class="py-3 px-4 font-semibold">Status</th>
          <th class="py-3 px-4 font-semibold text-right">Killswitch</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-black/5 dark:divide-white/5">
        {#each devices as d (d.device_id)}
          <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
            <td class="py-3 px-4">
              <div class="font-medium text-[var(--ink)]">{d.label || 'Counter Terminal'}</div>
              <div class="font-mono text-xs text-[var(--muted)]">{d.device_id}</div>
            </td>
            <td class="py-3 px-4 font-mono text-xs text-[var(--muted)] capitalize">
              {d.platform || 'web-pwa'}
            </td>
            <td class="py-3 px-4">
              {#if d.active_users.length > 0}
                <div class="flex flex-wrap gap-1">
                  {#each d.active_users as u}
                    <span class="inline-block px-2 py-0.5 rounded bg-black/5 dark:bg-white/5 text-xs text-[var(--ink)]">
                      {u.full_name}
                    </span>
                  {/each}
                </div>
              {:else}
                <span class="text-xs text-[var(--muted)] italic">None</span>
              {/if}
            </td>
            <td class="py-3 px-4 font-mono text-xs text-[var(--muted)]">
              {new Date(d.last_seen_at).toLocaleString()}
            </td>
            <td class="py-3 px-4">
              <Chip variant={d.revoked ? 'bkash' : 'commission'}>
                {d.revoked ? 'Revoked' : 'Active'}
              </Chip>
            </td>
            <td class="py-3 px-4 text-right">
              {#if !d.revoked}
                <Button
                  variant="default"
                  class="text-xs py-1 px-3 text-red-700 hover:bg-red-500/10 border-red-500/20"
                  onclick={() => confirmRevocation(d)}
                >
                  Revoke Device
                </Button>
              {:else}
                <Button
                  variant="default"
                  class="text-xs py-1 px-3 text-green-700 hover:bg-green-500/10 border-green-500/20"
                  onclick={async () => {
                    await authFetch('/api/v1/admin/devices', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ deviceId: d.device_id, action: 'unrevoke' }),
                    });
                    await loadDevices();
                  }}
                >
                  Restore Access
                </Button>
              {/if}
            </td>
          </tr>
        {/each}
        {#if devices.length === 0 && !loading}
          <tr>
            <td colspan="6" class="py-8 text-center text-sm text-[var(--muted)]">
              No devices registered.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </Card>
</div>

<!-- Revoke Confirmation Modal -->
<Modal bind:open={showRevokeModal} title="Confirm Hardware Device Killswitch" onclose={() => (showRevokeModal = false)}>
  <div class="space-y-4">
    <p class="text-sm text-[var(--ink)]">
      Are you sure you want to revoke terminal <strong class="font-mono">{selectedDevice?.device_id}</strong>?
    </p>
    <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-800 space-y-1">
      <p class="font-semibold">Killswitch Enforcement (PRD §7.3, §15.1):</p>
      <p>• All ongoing sync push and pull operations from this physical device will immediately fail with HTTP 403 device_revoked.</p>
      <p>• All active staff sessions sharing this device will be blocked from remote sync.</p>
      <p>• This action is logged permanently to the append-only audit trail.</p>
    </div>
    <div class="flex justify-end gap-3 pt-4">
      <Button variant="default" onclick={() => (showRevokeModal = false)}>Cancel</Button>
      <Button
        variant="default"
        class="bg-red-700 hover:bg-red-800 text-white"
        onclick={executeRevocation}
        disabled={revoking}
      >
        {revoking ? 'Revoking...' : 'Terminate Device'}
      </Button>
    </div>
  </div>
</Modal>
```

### 6.8 `apps/web/src/routes/(app)/admin/stale-reviews/+page.svelte` (S27 Stale Rate Reviews)

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { formatPoishaToBdt } from '@clt/shared';
  import { authFetch } from '$lib/api/client';

  interface StaleEntry {
    id: string;
    entry_number: number;
    entry_date: string;
    gross_amount: string; // Poisha decimal string
    vat_amount: string;
    net_amount: string;
    device_id: string;
    rate_profile_version: number;
    created_at: string;
  }

  let entries = $state<StaleEntry[]>([]);
  let loading = $state(true);
  let showModal = $state(false);
  let reviewAction = $state<'approved' | 'rejected'>('approved');
  let selectedEntry = $state<StaleEntry | null>(null);
  let reviewReason = $state('');
  let submitting = $state(false);
  let errorMessage = $state('');

  async function loadStaleEntries() {
    loading = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/entries/stale-reviews');
      if (res.ok) {
        const data = await res.json();
        entries = data.entries ?? [];
      } else {
        const err = await res.json();
        errorMessage = err.message || 'Failed to load stale reviews';
      }
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      loading = false;
    }
  }

  function openReview(entry: StaleEntry, action: 'approved' | 'rejected') {
    selectedEntry = entry;
    reviewAction = action;
    reviewReason = action === 'approved' ? 'Offline entry verified against paper receipt' : 'Rate variance unacceptable';
    showModal = true;
  }

  async function submitReview() {
    if (!selectedEntry) return;
    submitting = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/entries/stale-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryId: selectedEntry.id,
          action: reviewAction,
          reason: reviewReason.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to submit review');
      }

      showModal = false;
      selectedEntry = null;
      await loadStaleEntries();
    } catch (e: any) {
      errorMessage = e.message;
    } finally {
      submitting = false;
    }
  }

  onMount(loadStaleEntries);
</script>

<div class="p-6 max-w-5xl mx-auto w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Stale Rate Review Queue</h1>
      <p class="text-sm text-[var(--muted)]">Audit high-value offline transactions (&gt;৳50,000) recorded under superseded rate profiles.</p>
    </div>
    <Button variant="default" onclick={loadStaleEntries}>Refresh Queue</Button>
  </div>

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  <Card class="p-0 overflow-hidden">
    <table class="w-full text-left text-sm">
      <thead class="border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] text-xs">
        <tr>
          <th class="py-3 px-4 font-semibold">Entry #</th>
          <th class="py-3 px-4 font-semibold">Entry Date</th>
          <th class="py-3 px-4 font-semibold">Gross Amount</th>
          <th class="py-3 px-4 font-semibold">Rate Snapshot</th>
          <th class="py-3 px-4 font-semibold">Flag Reason</th>
          <th class="py-3 px-4 font-semibold text-right">Review Action</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-black/5 dark:divide-white/5">
        {#each entries as e (e.id)}
          <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
            <td class="py-3 px-4 font-mono font-medium text-[var(--ink)]">#{e.entry_number}</td>
            <td class="py-3 px-4 font-mono text-xs">{e.entry_date}</td>
            <td class="py-3 px-4 font-mono font-bold text-[var(--ink)]">
              {formatPoishaToBdt(BigInt(e.gross_amount))}
            </td>
            <td class="py-3 px-4">
              <span class="font-mono text-xs text-[var(--muted)]">Profile v{e.rate_profile_version}</span>
            </td>
            <td class="py-3 px-4">
              <Chip variant="default" class="bg-amber-500/10 text-amber-800 border border-amber-500/20">&gt;৳50,000 Offline Flag</Chip>
            </td>
            <td class="py-3 px-4 text-right">
              <div class="flex items-center justify-end gap-2">
                <Button
                  variant="default"
                  class="text-xs py-1 px-3 text-green-700 border-green-500/20 hover:bg-green-500/10"
                  onclick={() => openReview(e, 'approved')}
                >
                  Approve
                </Button>
                <Button
                  variant="default"
                  class="text-xs py-1 px-3 text-red-700 border-red-500/20 hover:bg-red-500/10"
                  onclick={() => openReview(e, 'rejected')}
                >
                  Void Entry
                </Button>
              </div>
            </td>
          </tr>
        {/each}
        {#if entries.length === 0 && !loading}
          <tr>
            <td colspan="6" class="py-8 text-center text-sm text-[var(--muted)]">
              No pending stale rate reviews in queue.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </Card>
</div>

<!-- Review Action Modal -->
<Modal bind:open={showModal} title={reviewAction === 'approved' ? 'Approve Stale-Rate Entry' : 'Void Flagged Stale Entry'} onclose={() => (showModal = false)}>
  <div class="space-y-4">
    <p class="text-sm text-[var(--ink)]">
      Reviewing Entry <strong class="font-mono">#{selectedEntry?.entry_number}</strong> with gross amount
      <strong class="font-mono">{selectedEntry ? formatPoishaToBdt(BigInt(selectedEntry.gross_amount)) : ''}</strong>.
    </p>

    {#if reviewAction === 'approved'}
      <div class="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-800">
        Approving retains the historical snapshot calculations and clears the audit flag. Settlements will reflect these snapshot numbers.
      </div>
    {:else}
      <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-800">
        Rejecting voids this entry under advisory sequence lock and recomputes monthly payable settlements. This mutation is audited.
      </div>
    {/if}

    <div>
      <label for="review-reason-input" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Audit Justification Note</label>
      <textarea
        id="review-reason-input"
        rows="3"
        bind:value={reviewReason}
        placeholder="Enter mandatory audit rationale..."
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
      ></textarea>
    </div>

    <div class="flex justify-end gap-3 pt-4">
      <Button variant="default" onclick={() => (showModal = false)}>Cancel</Button>
      <Button
        variant="default"
        class={reviewAction === 'rejected' ? 'bg-red-700 hover:bg-red-800 text-white' : ''}
        onclick={submitReview}
        disabled={submitting || !reviewReason}
      >
        {submitting ? 'Submitting...' : reviewAction === 'approved' ? 'Confirm Approval' : 'Execute Void'}
      </Button>
    </div>
  </div>
</Modal>
```

### 6.9 `apps/web/src/routes/(app)/admin/audit/+page.svelte` (S25 Audit Viewer)

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';

  interface AuditEvent {
    id: number;
    at: string;
    actor: string | null;
    action: string;
    target_table: string;
    target_id: string;
    before: Record<string, any> | null;
    after: Record<string, any> | null;
  }

  let events = $state<AuditEvent[]>([]);
  let loading = $state(true);
  let filterTable = $state('');
  let filterAction = $state('');
  let filterActor = $state('');
  let filterStartDate = $state('');
  let filterEndDate = $state('');

  async function loadAuditLog() {
    loading = true;
    try {
      const q = new URLSearchParams();
      if (filterTable) q.set('table', filterTable);
      if (filterAction) q.set('action', filterAction);
      if (filterActor) q.set('actor', filterActor);
      if (filterStartDate) q.set('startDate', filterStartDate);
      if (filterEndDate) q.set('endDate', filterEndDate);

      const res = await authFetch(`/api/v1/admin/audit?${q.toString()}`);
      if (res.ok) {
        const data = await res.json();
        events = data.events ?? [];
      }
    } finally {
      loading = false;
    }
  }

  function resetFilters() {
    filterTable = '';
    filterAction = '';
    filterActor = '';
    filterStartDate = '';
    filterEndDate = '';
    loadAuditLog();
  }

  onMount(loadAuditLog);
</script>

<div class="p-6 max-w-6xl mx-auto w-full">
  <div class="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Audit Log Viewer</h1>
      <p class="text-sm text-[var(--muted)]">Chronological, append-only record of all financial mutations and administrative actions.</p>
    </div>
    <div class="flex items-center gap-2">
      <Button variant="default" onclick={resetFilters}>Reset</Button>
      <Button variant="default" onclick={loadAuditLog}>Apply Filters</Button>
    </div>
  </div>

  <!-- Multi-parameter Filtering Controls -->
  <Card class="p-4 mb-6">
    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
      <div>
        <label for="audit-filter-table" class="block text-[11px] font-semibold text-[var(--muted)] mb-1">Table</label>
        <input
          id="audit-filter-table"
          type="text"
          placeholder="e.g. rate_profiles"
          bind:value={filterTable}
          class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs font-mono"
        />
      </div>

      <div>
        <label for="audit-filter-action" class="block text-[11px] font-semibold text-[var(--muted)] mb-1">Action</label>
        <input
          id="audit-filter-action"
          type="text"
          placeholder="e.g. publish"
          bind:value={filterAction}
          class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs font-mono"
        />
      </div>

      <div>
        <label for="audit-filter-actor" class="block text-[11px] font-semibold text-[var(--muted)] mb-1">Actor UUID</label>
        <input
          id="audit-filter-actor"
          type="text"
          placeholder="Actor ID..."
          bind:value={filterActor}
          class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs font-mono"
        />
      </div>

      <div>
        <label for="audit-filter-start" class="block text-[11px] font-semibold text-[var(--muted)] mb-1">Start Date</label>
        <input
          id="audit-filter-start"
          type="date"
          bind:value={filterStartDate}
          class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs"
        />
      </div>

      <div>
        <label for="audit-filter-end" class="block text-[11px] font-semibold text-[var(--muted)] mb-1">End Date</label>
        <input
          id="audit-filter-end"
          type="date"
          bind:value={filterEndDate}
          class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs"
        />
      </div>
    </div>
  </Card>

  <Card class="p-4">
    <div class="overflow-x-auto">
      <table class="w-full text-left text-xs">
        <thead class="border-b border-black/10 dark:border-white/10 text-[var(--muted)]">
          <tr>
            <th class="py-2 px-3 font-semibold">Timestamp</th>
            <th class="py-2 px-3 font-semibold">Action</th>
            <th class="py-2 px-3 font-semibold">Target</th>
            <th class="py-2 px-3 font-semibold">Actor</th>
            <th class="py-2 px-3 font-semibold">Details</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-black/5 dark:divide-white/5 font-mono">
          {#each events as ev (ev.id)}
            <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
              <td class="py-2.5 px-3 text-[var(--muted)] whitespace-nowrap">{new Date(ev.at).toLocaleString()}</td>
              <td class="py-2.5 px-3">
                <Chip variant="default">{ev.action}</Chip>
              </td>
              <td class="py-2.5 px-3 text-[var(--muted)]">{ev.target_table}:{ev.target_id?.slice(0, 8)}...</td>
              <td class="py-2.5 px-3 text-[var(--muted)]">{ev.actor ? ev.actor.slice(0, 8) + '...' : 'system'}</td>
              <td class="py-2.5 px-3 text-[var(--muted)] truncate max-w-xs">
                {ev.after ? JSON.stringify(ev.after) : ev.before ? JSON.stringify(ev.before) : '-'}
              </td>
            </tr>
          {/each}
          {#if events.length === 0 && !loading}
            <tr>
              <td colspan="5" class="py-8 text-center text-[var(--muted)] font-sans">No audit events match filters.</td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </Card>
</div>
```


### 6.10 `apps/web/src/routes/api/v1/admin/rates/draft/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const methodRateItemSchema = z.object({
  payment_method_id: z.string().uuid(),
  fee_bp: z.number().int().min(0).max(10000),
  charges_borne_by: z.enum(['business', 'customer']).default('business'),
});

const draftRateSchema = z.object({
  draftId: z.string().uuid().optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vat: z.object({
    mode: z.enum(['manual', 'percent_of_gross', 'percent_inclusive']),
    rateBp: z.number().int().min(0).max(10000).optional(),
  }),
  commission: z.object({
    rateBp: z.number().int().min(0).max(10000),
    base: z.enum(['gross_minus_vat', 'gross']),
  }),
  methodRates: z.array(methodRateItemSchema).min(1),
  note: z.string().optional(),
});

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();

  // Load published profile with joined method details
  const { data: publishedRows } = await supabase
    .from('rate_profiles')
    .select('*, method_rates(*, payment_methods(id, code, name))')
    .eq('status', 'published')
    .order('version', { ascending: false })
    .limit(1);

  // Load latest draft profile if any
  const { data: draftRows } = await supabase
    .from('rate_profiles')
    .select('*, method_rates(*, payment_methods(id, code, name))')
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1);

  const formatProfile = (p: any) => {
    if (!p) return null;
    return {
      id: p.id,
      version: p.version,
      effective_from: p.effective_from,
      vat_mode: p.vat_mode,
      vat_bp: p.vat_bp,
      commission_base: p.commission_base,
      commission_bp: p.commission_bp,
      note: p.note ?? null,
      method_rates: (p.method_rates || []).map((mr: any) => ({
        payment_method_id: mr.method_id,
        code: mr.payment_methods?.code ?? '',
        name: mr.payment_methods?.name ?? '',
        fee_bp: mr.charge_bp,
        charges_borne_by: p.charges_borne_by ?? 'business',
      })),
    };
  };

  return new Response(JSON.stringify({
    published: formatProfile(publishedRows?.[0]),
    draft: formatProfile(draftRows?.[0]),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = draftRateSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  // 100% deduction upper-bound check
  const vatBp = parsed.data.vat.mode === 'manual' ? 0 : (parsed.data.vat.rateBp ?? 0);
  const maxCharge = parsed.data.methodRates.length > 0
    ? Math.max(0, ...parsed.data.methodRates.map((m) => m.fee_bp))
    : 0;

  if (vatBp + parsed.data.commission.rateBp + maxCharge > 10000) {
    return new Response(JSON.stringify({
      error: 'deductions_exceed_100_percent',
      message: 'Sum of VAT, commission, and maximum method charge exceeds 10,000 basis points (100%).',
    }), { status: 422 });
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('create_or_update_draft_rate_profile', {
    p_profile_id: parsed.data.draftId ?? null,
    p_effective_from: parsed.data.effectiveFrom,
    p_vat_mode: parsed.data.vat.mode,
    p_vat_bp: parsed.data.vat.rateBp ?? 0,
    p_commission_base: parsed.data.commission.base,
    p_commission_bp: parsed.data.commission.rateBp,
    p_method_rates: parsed.data.methodRates.map((mr) => ({
      method_id: mr.payment_method_id,
      charge_bp: mr.fee_bp,
    })),
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true, profileId: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.11 `apps/web/src/routes/api/v1/admin/rates/publish/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const publishSchema = z.object({
  profileId: z.string().uuid(),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('publish_rate_profile', {
    p_profile_id: parsed.data.profileId,
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.12 `apps/web/src/routes/api/v1/admin/methods/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const manageMethodSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  active: z.boolean(),
  requires_txn_ref: z.boolean(),
  sort_order: z.number().int().min(0).default(0),
});

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('payment_methods')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ methods: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = manageMethodSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const action = parsed.data.id ? 'update' : 'create';
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('admin_manage_payment_method', {
    p_action: action,
    p_id: parsed.data.id ?? null,
    p_code: parsed.data.code,
    p_name: parsed.data.name,
    p_sort_order: parsed.data.sort_order,
    p_active: parsed.data.active,
    p_requires_txn_ref: parsed.data.requires_txn_ref,
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true, methodId: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.13 `apps/web/src/routes/api/v1/admin/payables/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const managePayableSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  kind: z.enum(['vat', 'method_charge']),
  method_id: z.string().uuid().nullable().optional(),
  due_day: z.number().int().min(1).max(28),
  remind_days_before: z.number().int().min(0).max(14).default(3),
  active: z.boolean(),
});

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('payables')
    .select('*, payment_methods(name)')
    .order('created_at', { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const payables = (data || []).map((row: any) => ({
    ...row,
    method_name: row.payment_methods?.name ?? null,
  }));

  return new Response(JSON.stringify({ payables }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = managePayableSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const action = parsed.data.id ? 'update' : 'create';
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('admin_manage_payable', {
    p_action: action,
    p_id: parsed.data.id ?? null,
    p_kind: parsed.data.kind,
    p_method_id: parsed.data.kind === 'vat' ? null : parsed.data.method_id,
    p_code: parsed.data.code,
    p_name: parsed.data.name,
    p_due_day: parsed.data.due_day,
    p_remind_days_before: parsed.data.remind_days_before,
    p_active: parsed.data.active,
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true, payableId: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.14 `apps/web/src/routes/api/v1/admin/settings/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const updateSettingsSchema = z.object({
  net_label: z.string().min(1).max(100),
  reconcile_tolerance_poisha: z.number().int().min(0),
});

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();
  // app_settings primary key is boolean true check (id) per PRD §7.1
  const { data, error } = await supabase
    .from('app_settings')
    .select('id, timezone, currency, locale, net_label, reconcile_tolerance_poisha, updated_at')
    .eq('id', true)
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ settings: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const PATCH: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('admin_update_settings', {
    p_settings: {
      net_label: parsed.data.net_label,
      reconcile_tolerance_poisha: parsed.data.reconcile_tolerance_poisha,
    },
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.15 `apps/web/src/routes/api/v1/admin/devices/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const manageDeviceSchema = z.object({
  deviceId: z.string().uuid().transform((s) => s.toLowerCase()),
  action: z.enum(['revoke', 'unrevoke']),
});

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();
  const { data: deviceRows, error: devErr } = await supabase
    .from('devices')
    .select('id, device_id, device_name, last_seen_at, last_rate_version, revoked, user_id, profiles(full_name)')
    .order('last_seen_at', { ascending: false });

  if (devErr) {
    return new Response(JSON.stringify({ error: devErr.message }), { status: 500 });
  }

  // Group active user sessions by physical device_id
  const deviceMap = new Map<string, any>();
  for (const row of deviceRows || []) {
    if (!deviceMap.has(row.device_id)) {
      deviceMap.set(row.device_id, {
        device_id: row.device_id,
        label: row.device_name,
        platform: 'web-pwa',
        last_seen_at: row.last_seen_at,
        revoked: row.revoked,
        active_users: [],
      });
    }
    if (row.user_id) {
      deviceMap.get(row.device_id).active_users.push({
        user_id: row.user_id,
        full_name: (row.profiles as any)?.full_name || 'Staff User',
        email: '',
      });
    }
  }

  return new Response(JSON.stringify({ devices: Array.from(deviceMap.values()) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = manageDeviceSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('admin_manage_device', {
    p_device_id: parsed.data.deviceId,
    p_action: parsed.data.action,
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.16 `apps/web/src/routes/api/v1/admin/users/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const userManageSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update_role'),
    userId: z.string().uuid(),
    role: z.enum(['staff', 'admin']),
  }),
  z.object({
    action: z.literal('deactivate'),
    userId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('reactivate'),
    userId: z.string().uuid(),
  }),
]);

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();

  // Query profiles (columns per PRD §7.1: id, role, full_name, active, created_at, updated_at)
  const { data: profileList, error: pErr } = await supabase
    .from('profiles')
    .select('id, role, full_name, active, created_at, updated_at')
    .order('created_at', { ascending: true });

  if (pErr) {
    return new Response(JSON.stringify({ error: pErr.message }), { status: 500 });
  }

  // Merge auth emails via Supabase Admin API
  const { data: authData, error: aErr } = await supabase.auth.admin.listUsers();
  const emailMap = new Map<string, string>();
  if (!aErr && authData?.users) {
    for (const u of authData.users) {
      if (u.email) emailMap.set(u.id, u.email);
    }
  }

  const userRoster = (profileList || []).map((p) => ({
    id: p.id,
    display_name: p.full_name,
    email: emailMap.get(p.id) || '',
    role: p.role,
    active: p.active,
    created_at: p.created_at,
  }));

  return new Response(JSON.stringify({ users: userRoster, callerRole: caller.role }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const PATCH: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = userManageSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const supabase = getServiceSupabase();

  let targetRole = 'staff';
  let targetActive = true;

  if (parsed.data.action === 'update_role') {
    targetRole = parsed.data.role;
    targetActive = true;
  } else if (parsed.data.action === 'deactivate') {
    targetActive = false;
  } else if (parsed.data.action === 'reactivate') {
    targetActive = true;
  }

  const { error } = await supabase.rpc('admin_manage_user', {
    p_action: parsed.data.action,
    p_user_id: parsed.data.userId,
    p_role: targetRole,
    p_active: targetActive,
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  // Synchronize GoTrue app_metadata claims so Supabase RLS reflects role immediately upon token refresh
  if (parsed.data.action === 'update_role') {
    await supabase.auth.admin.updateUserById(parsed.data.userId, {
      app_metadata: { role: targetRole },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.17 `apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const transferSchema = z.object({
  newOwnerId: z.string().uuid(),
  confirmationPhrase: z.literal('TRANSFER OWNERSHIP'),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'owner_only_operation' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = transferSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_confirmation' }), { status: 400 });
  }

  // Prevent self-transfer deadlock
  if (parsed.data.newOwnerId === caller.userId) {
    return new Response(JSON.stringify({ error: 'cannot_transfer_to_self' }), { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('transfer_ownership', {
    p_new_owner_id: parsed.data.newOwnerId,
    p_caller_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  // Synchronize GoTrue app_metadata claims for both demoted and promoted owners
  await supabase.auth.admin.updateUserById(caller.userId, {
    app_metadata: { role: 'admin' },
  });
  await supabase.auth.admin.updateUserById(parsed.data.newOwnerId, {
    app_metadata: { role: 'owner' },
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.18 `apps/web/src/routes/api/v1/admin/users/invite/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const inviteUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(['staff', 'admin']),
  fullName: z.string().min(1).max(200),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = inviteUserSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const { email, role, fullName } = parsed.data;

  // Admin can only invite staff; only Owner can invite Admin
  if (caller.role === 'admin' && role !== 'staff') {
    return new Response(JSON.stringify({ error: 'admin_can_only_invite_staff' }), { status: 403 });
  }

  const supabase = getServiceSupabase();
  const { error: rpcErr } = await supabase.rpc('admin_invite_user', {
    p_email: email.toLowerCase(),
    p_role: role,
    p_full_name: fullName,
    p_actor_id: caller.userId,
  });

  if (rpcErr) {
    if (rpcErr.message.includes('409') || rpcErr.message.includes('user_already_exists')) {
      return new Response(
        JSON.stringify({ error: 'user_already_exists', message: 'User is already active.' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (rpcErr.message.includes('403')) {
      return new Response(
        JSON.stringify({ error: 'unauthorized', message: rpcErr.message }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ error: rpcErr.message }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Provision Supabase Auth User with raw_app_meta_data claims sync (PRD §3, §7.3, Hard Rule 7)
  const redirectTo = `${event.url.origin}/callback`;
  const { data: authData, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email.toLowerCase(), {
    data: { full_name: fullName },
    redirectTo,
  });

  if (inviteErr) {
    // If user already exists in auth.users (reactivation flow), synchronize metadata directly
    const { data: existingUser } = await supabase.auth.admin.listUsers();
    const matched = existingUser?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (matched) {
      await supabase.auth.admin.updateUserById(matched.id, {
        app_metadata: { role, full_name: fullName },
      });
      return new Response(
        JSON.stringify({ success: true, userId: matched.id, reactivated: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: inviteErr.message }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (authData.user) {
    await supabase.auth.admin.updateUserById(authData.user.id, {
      app_metadata: { role, full_name: fullName },
    });
  }

  return new Response(
    JSON.stringify({ success: true, userId: authData.user?.id }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
```


### 6.19 `apps/web/src/routes/api/v1/admin/entries/stale-reviews/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();

  // Query entries table (PRD §7.1: columns gross_poisha, vat_poisha, net_poisha; version is derived from snapshot)
  const { data, error } = await supabase
    .from('entries')
    .select('id, entry_number, entry_date, gross_poisha, vat_poisha, net_poisha, device_id, snapshot, created_at')
    .eq('stale_rates', true)
    .eq('stale_review_status', 'flagged')
    .order('created_at', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const entries = (data || []).map((row: any) => ({
    id: row.id,
    entry_number: row.entry_number,
    entry_date: row.entry_date,
    gross_amount: String(row.gross_poisha),
    vat_amount: String(row.vat_poisha),
    net_amount: String(row.net_poisha),
    device_id: row.device_id,
    rate_profile_version: row.snapshot?.version ?? 1,
    created_at: row.created_at,
  }));

  return new Response(JSON.stringify({ entries }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.20 `apps/web/src/routes/api/v1/admin/entries/stale-review/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const staleReviewSchema = z.object({
  entryId: z.string().uuid(),
  action: z.enum(['approved', 'rejected']),
  reason: z.string().min(1).max(500),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = staleReviewSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('admin_review_stale_entry', {
    p_entry_id: parsed.data.entryId,
    p_action: parsed.data.action,
    p_actor_id: caller.userId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.21 `apps/web/src/routes/api/v1/admin/entries/stale-anomalies/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('view_device_stale_rate_anomalies')
    .select('*')
    .order('stale_ops_last_hour', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ anomalies: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.22 `apps/web/src/routes/api/v1/admin/audit/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const table = event.url.searchParams.get('table');
  const action = event.url.searchParams.get('action');
  const actor = event.url.searchParams.get('actor');
  const startDate = event.url.searchParams.get('startDate');
  const endDate = event.url.searchParams.get('endDate');
  const limit = Math.min(100, Math.max(1, parseInt(event.url.searchParams.get('limit') || '50', 10)));

  const supabase = getServiceSupabase();
  let query = supabase
    .from('audit_log')
    .select('*')
    .order('id', { ascending: false })
    .limit(limit);

  if (table) query = query.eq('target_table', table);
  if (action) query = query.ilike('action', `%${action}%`);
  if (actor) query = query.eq('actor', actor);
  if (startDate) query = query.gte('at', startDate);
  if (endDate) query = query.lte('at', endDate + 'T23:59:59.999Z');

  const { data, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ events: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.23 `apps/web/src/lib/api/client.ts`

```ts
import { supabase } from '$lib/supabase/client';

/**
 * Authenticated client-side fetch wrapper for SvelteKit SPA mode.
 * Automatically inspects the local Supabase session and attaches
 * Authorization: Bearer <access_token> header to all API requests.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const headers = new Headers(init?.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(input, {
    ...init,
    headers,
  });
}
```

### 6.24 `apps/web/src/lib/admin/admin.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const methodRateItemSchema = z.object({
  payment_method_id: z.string().uuid(),
  fee_bp: z.number().int().min(0).max(10000),
  charges_borne_by: z.enum(['business', 'customer']).default('business'),
});

const draftRateSchema = z.object({
  draftId: z.string().uuid().optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vat: z.object({
    mode: z.enum(['manual', 'percent_of_gross', 'percent_inclusive']),
    rateBp: z.number().int().min(0).max(10000).optional(),
  }),
  commission: z.object({
    rateBp: z.number().int().min(0).max(10000),
    base: z.enum(['gross_minus_vat', 'gross']),
  }),
  methodRates: z.array(methodRateItemSchema).min(1),
  note: z.string().optional(),
});

const manageMethodSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  active: z.boolean(),
  requires_txn_ref: z.boolean(),
  sort_order: z.number().int().min(0).default(0),
});

const managePayableSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  kind: z.enum(['vat', 'method_charge']),
  method_id: z.string().uuid().nullable().optional(),
  due_day: z.number().int().min(1).max(28),
  remind_days_before: z.number().int().min(0).max(14).default(3),
  active: z.boolean(),
});

const updateSettingsSchema = z.object({
  net_label: z.string().min(1).max(100),
  reconcile_tolerance_poisha: z.number().int().min(0),
});

const staleReviewSchema = z.object({
  entryId: z.string().uuid(),
  action: z.enum(['approved', 'rejected']),
  reason: z.string().min(1).max(500),
});

const manageDeviceSchema = z.object({
  deviceId: z.string().uuid().transform((s) => s.toLowerCase()),
  action: z.enum(['revoke', 'unrevoke']),
});

function validateTotalDeductions(
  vatMode: string,
  vatBp: number,
  commBp: number,
  methodRates: { fee_bp: number }[]
): boolean {
  const effectiveVat = vatMode === 'manual' ? 0 : vatBp;
  const maxCharge = methodRates.length > 0 ? Math.max(...methodRates.map((m) => m.fee_bp)) : 0;
  return effectiveVat + commBp + maxCharge <= 10000;
}

function validateDueDay(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= 28;
}

describe('Admin Panel Validation & Guard Rules', () => {
  describe('Deduction Upper Bounds (10,000 bp ceiling)', () => {
    it('blocks submissions where total deductions exceed 100% (10,000 bp)', () => {
      const vatMode = 'percent_of_gross';
      const vatBp = 500; // 5%
      const commissionBp = 9000; // 90%
      const methodRates = [{ fee_bp: 600 }]; // 6% -> total 101%

      expect(validateTotalDeductions(vatMode, vatBp, commissionBp, methodRates)).toBe(false);
    });

    it('permits submissions where total deductions are exactly 100% (10,000 bp)', () => {
      const vatMode = 'percent_of_gross';
      const vatBp = 500; // 5%
      const commissionBp = 9000; // 90%
      const methodRates = [{ fee_bp: 500 }]; // 5% -> total 100%

      expect(validateTotalDeductions(vatMode, vatBp, commissionBp, methodRates)).toBe(true);
    });

    it('ignores VAT bp in manual mode when computing deduction ceiling', () => {
      const vatMode = 'manual';
      const vatBp = 1500; // should be ignored
      const commissionBp = 8500; // 85%
      const methodRates = [{ fee_bp: 1500 }]; // 15% -> total 100%

      expect(validateTotalDeductions(vatMode, vatBp, commissionBp, methodRates)).toBe(true);
    });
  });

  describe('Payable Due Day Constraints (1 to 28)', () => {
    it('validates payable due day strictly within 1 to 28', () => {
      expect(validateDueDay(1)).toBe(true);
      expect(validateDueDay(15)).toBe(true);
      expect(validateDueDay(28)).toBe(true);

      expect(validateDueDay(0)).toBe(false);
      expect(validateDueDay(29)).toBe(false);
      expect(validateDueDay(30)).toBe(false);
      expect(validateDueDay(31)).toBe(false);
      expect(validateDueDay(-5)).toBe(false);
    });

    it('validates managePayableSchema schema parsing', () => {
      const validPayable = {
        code: 'vat_nbr',
        name: 'National Board of Revenue VAT Account',
        kind: 'vat',
        due_day: 15,
        remind_days_before: 3,
        active: true,
      };
      expect(managePayableSchema.safeParse(validPayable).success).toBe(true);

      // Rejects invalid due_day
      expect(managePayableSchema.safeParse({ ...validPayable, due_day: 30 }).success).toBe(false);
      // Rejects invalid remind_days_before
      expect(managePayableSchema.safeParse({ ...validPayable, remind_days_before: 20 }).success).toBe(false);
      // Rejects empty code
      expect(managePayableSchema.safeParse({ ...validPayable, code: '' }).success).toBe(false);
    });
  });

  describe('Payment Method Schema Validation', () => {
    it('validates manageMethodSchema parsing and defaults sort_order', () => {
      const valid = {
        code: 'bkash',
        name: 'bKash Merchant',
        active: true,
        requires_txn_ref: true,
      };
      const parsed = manageMethodSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.sort_order).toBe(0);
      }

      // Rejects negative sort_order
      expect(manageMethodSchema.safeParse({ ...valid, sort_order: -1 }).success).toBe(false);
      // Rejects empty name
      expect(manageMethodSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    });
  });

  describe('Application Settings Schema Validation', () => {
    it('validates updateSettingsSchema with net_label and non-negative tolerance', () => {
      const valid = {
        net_label: 'Final Net after Deductions',
        reconcile_tolerance_poisha: 100,
      };
      expect(updateSettingsSchema.safeParse(valid).success).toBe(true);

      // Rejects negative tolerance
      expect(updateSettingsSchema.safeParse({ ...valid, reconcile_tolerance_poisha: -1 }).success).toBe(false);
      // Rejects empty label
      expect(updateSettingsSchema.safeParse({ ...valid, net_label: '' }).success).toBe(false);
    });
  });

  describe('Stale Review and Device Management Schemas', () => {
    it('validates staleReviewSchema requires mandatory reason', () => {
      const valid = {
        entryId: 'a0000000-0000-0000-0000-000000000001',
        action: 'approved',
        reason: 'Verified against merchant slip',
      };
      expect(staleReviewSchema.safeParse(valid).success).toBe(true);

      // Rejects empty reason
      expect(staleReviewSchema.safeParse({ ...valid, reason: '' }).success).toBe(false);
      // Rejects invalid action
      expect(staleReviewSchema.safeParse({ ...valid, action: 'dismissed' }).success).toBe(false);
    });

    it('validates manageDeviceSchema actions and lowercases deviceId', () => {
      const valid = {
        deviceId: 'A0000000-0000-0000-0000-000000000001',
        action: 'revoke',
      };
      const parsed = manageDeviceSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.deviceId).toBe('a0000000-0000-0000-0000-000000000001');
      }

      // Rejects legacy invalid action 'restore'
      expect(manageDeviceSchema.safeParse({ ...valid, action: 'restore' }).success).toBe(false);
      // Accepts 'unrevoke'
      expect(manageDeviceSchema.safeParse({ ...valid, action: 'unrevoke' }).success).toBe(true);
    });
  });

  describe('Rate Profile Draft Schema Validation', () => {
    it('parses valid rate profile draft payloads with method rates array and charges_borne_by', () => {
      const validPayload = {
        effectiveFrom: '2026-11-01',
        vat: { mode: 'percent_of_gross', rateBp: 500 },
        commission: { rateBp: 4200, base: 'gross_minus_vat' },
        methodRates: [
          {
            payment_method_id: 'a0000000-0000-0000-0000-000000000001',
            fee_bp: 150,
            charges_borne_by: 'business',
          },
          {
            payment_method_id: 'a0000000-0000-0000-0000-000000000002',
            fee_bp: 115,
            charges_borne_by: 'customer',
          },
        ],
        note: 'Updated card fee structure',
      };

      const parsed = draftRateSchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);
    });
  });
});
```


## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| Deduction 100% Guard | 10,100 bp total | `validateTotalDeductions(...) === false` | §8.6 | `apps/web/src/lib/admin/admin.test.ts` |
| Payable Due Day Range | Days 0, 29, 31 | `d >= 1 && d <= 28 === false` | §8.6 | `apps/web/src/lib/admin/admin.test.ts` |
| Test #14 Rate Profile Draft-Publish Immutability | Update published profile | Trigger raises exception; draft modifications succeed | §16.2 #14 | `apps/web/src/routes/api/v1/admin/rates/draft/+server.ts` |
| Test #15 Atomic Ownership Transfer | Admin transferred to owner | Demote caller to admin before promoting target in one tx | §16.2 #15 | `apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts` |
| Test #21 Payment Method Code Immutability | Update method code | Trigger `trg_payment_methods_immutable_code` raises exception | §16.2 #21 | `apps/web/src/routes/api/v1/admin/methods/+server.ts` |
| Test #28 Payment Method Activation Profile Guard | Activate method without rate | Trigger blocks activation when no published profile covers it | §16.2 #28 | `apps/web/src/routes/api/v1/admin/methods/+server.ts` |
| Test #33 Duplicate Payable Prevention & Method Consistency | Duplicate active VAT/method | Unique index rejects duplicate active payable per stream | §16.2 #33 | `apps/web/src/routes/api/v1/admin/payables/+server.ts` |
| Test #44 Two-Step Atomic Ownership Transfer Demote-Before-Promote Ordering | Execute ownership transfer | Deactivating sole owner blocked; transfer atomically swaps roles | §16.2 #44 | `apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts` |
| Test #57 >৳50,000 Stale-Rate Review Workflow | Approve/void >৳50k stale entry | Updates status to approved/voided with reviewer metadata | §16.2 #57 | `apps/web/src/routes/api/v1/admin/entries/stale-review/+server.ts` |
| Test #58 Closed Month Stale Review Gate | Review in closed month | Error `422 month_closed`; month close gated on flagged entries | §16.2 #58 | `apps/web/src/routes/api/v1/admin/entries/stale-review/+server.ts` |
| Test #59 Admin User Provisioning & Privilege Escalation Defense | Admin invites owner/admin | Admin can only invite staff; Owner can invite admin; owner invite blocked | §16.2 #59 | `apps/web/src/routes/api/v1/admin/users/invite/+server.ts` |
| Test #62 Multi-User Shared Device Presence & Global Device Killswitch | Revoke physical device | Blocks future sync pushes & pulls for all users on device | §16.2 #62 | `apps/web/src/routes/api/v1/admin/devices/+server.ts` |
| Test #63 Deactivated User Re-Invite Role Guard & Privilege Escalation Defense | Re-invite deactivated user | Re-invite reactivates account, preserves/updates role, logs audit | §16.2 #63 | `apps/web/src/routes/api/v1/admin/users/invite/+server.ts` |
| Test #65 Stale-Rate Device Anomaly Burst Aggregation & Security Isolation | >=5 stale ops in 1 hour | Aggregated in `view_device_stale_rate_anomalies`; staff denied | §16.2 #65 | `apps/web/src/routes/api/v1/admin/entries/stale-anomalies/+server.ts` |

## 8. Acceptance criteria

1. Rate profiles block submissions exceeding 10,000 basis points total deduction.
   - Command: `pnpm --filter @clt/web test admin.test.ts`
   - Expected output: `All tests passing`.
2. Admin routes reject non-admin callers with HTTP `403`.
   - Command: `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5173/api/v1/admin/settings`
   - Expected output: `401` or `403`.
3. SvelteKit route typecheck passes cleanly with zero errors.
   - Command: `pnpm --filter @clt/web check`
   - Expected output: `0 errors`.

## 9. Hard rules touched

- Rule 1: Never hardcode rates; all rates configured through versioned `rate_profiles`.
- Rule 2: Integer poisha used exclusively for all money values, tolerances, and amounts.
- Rule 4: Entries are immutable snapshots; rate changes never alter historical entries.
- Rule 5: Every configuration change appends an `audit_log` row inside the transaction.
- Rule 7: Admin mutations execute through privileged `SECURITY DEFINER` RPCs under `service_role`.
- Rule 9: Server trusts nothing from the client; roles, watermarks, and deduction bounds verified.
- Rule 10: Respect lock hierarchy when executing stale entry review voids.
- Rule 11: Zod validation on client forms and server endpoint request handlers.

## 10. Pitfalls

- Trap: Publishing a rate profile with incomplete method coverage or total deductions > 100%.
  - Fix: Validate `vat_bp + commission_bp + max(charge_bp) <= 10000` on client and server before invoking `publish_rate_profile` per PRD §8.6.
- Trap: Updating payment method code violates immutability trigger `trg_payment_methods_immutable_code`.
  - Fix: Make payment method `code` field read-only once created per PRD §7.3.
- Trap: Setting payable `due_day` to 29, 30, or 31 causes calendar errors in February.
  - Fix: Enforce `due_day` strictly in range 1 to 28 per PRD §8.6 and check constraint `chk_payables_due_day`.
- Trap: Sending `method_rates` as an object to `create_or_update_draft_rate_profile`.
  - Fix: Format `p_method_rates` as a JSON array of records `[{"payment_method_id": "...", "fee_bp": 150, "charges_borne_by": "business"}]` so `jsonb_to_recordset` parses cleanly.
- Trap: Querying `email` from `profiles` table.
  - Fix: `profiles` contains display names and roles; user emails reside in `auth.users` and must be merged via `supabase.auth.admin.listUsers()`.
- Trap: Querying `rate_profile_version` column on `entries`.
  - Fix: `entries` stores rate version inside the `snapshot` JSONB column (`snapshot->>'version'`).

## 11. PRD ISSUES and DECISION PENDING

- none

## 12. Handoff

- Admin configuration routes available under `/admin/*` covering S19–S27.
- Server mediation endpoints under `/api/v1/admin/*` available for remote administration under `service_role`.
- Authenticated client helper `authFetch` available at `apps/web/src/lib/api/client.ts`.

## 13. Suggested task breakdown

- `CLT-PLAN-009-A`: Build admin hub, application settings, payables manager, and authenticated API client helper (Files: `apps/web/src/lib/api/client.ts`, `apps/web/src/routes/(app)/admin/+page.svelte`, `settings/+page.svelte`, `payables/+page.svelte`, `apps/web/src/routes/api/v1/admin/settings/+server.ts`, `payables/+server.ts`; Depends on: none; Role: Builder; Priority: P1).
- `CLT-PLAN-009-B`: Implement rate profiles draft editor, publish modal, deduction upper-bound guard, and server endpoints (Files: `apps/web/src/routes/(app)/admin/rates/+page.svelte`, `apps/web/src/routes/api/v1/admin/rates/draft/+server.ts`, `rates/publish/+server.ts`, `apps/web/src/lib/admin/admin.test.ts`; Depends on: `CLT-PLAN-009-A`; Role: Builder; Priority: P0).
- `CLT-PLAN-009-C`: Implement payment methods manager, user provisioning & role management, atomic ownership transfer, device killswitch, and server routes (Files: `apps/web/src/routes/(app)/admin/methods/+page.svelte`, `users/+page.svelte`, `devices/+page.svelte`, `apps/web/src/routes/api/v1/admin/methods/+server.ts`, `users/+server.ts`, `users/invite/+server.ts`, `transfer-ownership/+server.ts`, `devices/+server.ts`; Depends on: `CLT-PLAN-009-B`; Role: Builder; Priority: P1).
- `CLT-PLAN-009-D`: Implement stale rate review queue, device anomaly tracker, chronological audit viewer with filters, and test verification (Files: `apps/web/src/routes/(app)/admin/stale-reviews/+page.svelte`, `audit/+page.svelte`, `apps/web/src/routes/api/v1/admin/entries/stale-reviews/+server.ts`, `entries/stale-review/+server.ts`, `entries/stale-anomalies/+server.ts`, `audit/+server.ts`; Depends on: `CLT-PLAN-009-C`; Role: Builder; Priority: P0).

## Changelog

- Revision 2.2 — 2026-11-01:
  - Corrected `admin_update_settings` RPC signature to 2 arguments `(p_settings jsonb, p_actor_id uuid)` and scoped `app_settings` schema to `net_label` and `reconcile_tolerance_poisha` per PRD §4 Q2, §7.1, and Plan 004.
  - Aligned `admin_manage_payment_method` RPC parameters with Plan 004 (`p_action`, `p_sort_order` instead of `p_display_order`), and updated table sorting from `display_order` to `sort_order`.
  - Refactored `admin_manage_payable` RPC call and `payables/+page.svelte` to use real schema columns (`code`, `name`, `kind`, `method_id`, `due_day`, `remind_days_before`, `active`), purging hallucinated `recipient_name` and `recipient_account`.
  - Fixed `create_or_update_draft_rate_profile` method rates array mapping to pass objects with `{ method_id, charge_bp }` matching database `jsonb_to_recordset` unpacker; joined `payment_methods` in draft GET query.
  - Replaced queries to non-existent `device_sync_state` with `devices` table grouped by `device_id`; updated killswitch actions to `'revoke'` and `'unrevoke'`.
  - Purged non-existent `profiles` columns (`display_name`, `phone`, `default_route`), querying `full_name` and merging `auth.users` emails.
  - Corrected `entries` query in `stale-reviews/+server.ts` to `gross_poisha, vat_poisha, net_poisha` string representations.
  - Fixed parameter name `p_reason` in `admin_review_stale_entry` (was `p_note`).
  - Corrected `audit_log` filter column to `actor` (was `actor_id`).
  - Fixed client Supabase import in `apps/web/src/lib/api/client.ts` to `$lib/supabase/client` (was `$lib/db/supabaseClient`).
  - Swapped server Supabase imports across all 13 endpoints to `$lib/server/supabase` (was `$lib/supabase/server`).
  - Replaced unsupported `Button variant="primary"` with `variant="default"` / `variant="commission"` across all 9 UI pages.
  - Added required `onclose` handlers on all `<Modal>` components.
  - Restored GoTrue `raw_app_meta_data` synchronization via `updateUserById` on user role updates, invitations, and ownership transfers, eliminating RLS stale JWT token vulnerabilities.
  - Added self-ownership transfer rejection (`newOwnerId === caller.userId`).
  - Added Dhaka timezone formatting helper for `effectiveFrom` default date.
  - Integrated `view_device_stale_rate_anomalies` into Admin Hub dashboard with real-time burst alert banner (&ge; 5 in 1 hour) per Test #65.
  - Expanded `admin.test.ts` with comprehensive unit tests for all admin Zod request validation schemas and boundary rules.
  - Wrapped bash check commands with quotes to prevent subshell syntax errors on `(app)`.
- Revision 2.1 — 2026-10-30:
  - Replaced non-existent `Badge.svelte` and `Table` imports with `Chip.svelte` from Plan 007 and native Tailwind styled tables across all screens.
  - Replaced non-existent `formatBdt` import with `formatPoishaToBdt` from `@clt/shared` in stale rate review queue.
  - Corrected `app_settings` query from string ID `'app'` to boolean PK `id = true` in `settings/+server.ts`.
  - Fixed `profiles` query in `users/+server.ts` by removing non-existent `email` column and merging `supabase.auth.admin.listUsers()`.
  - Fixed `entries` query in `stale-reviews/+server.ts` by deriving `rate_profile_version` from `snapshot->>'version'` and referencing exact PRD amount columns.
  - Corrected `create_or_update_draft_rate_profile` RPC invocation to pass `p_method_rates` as a JSON array of records with `charges_borne_by` and added `note` parameter support in UI and server handler.
  - Aligned `admin_manage_user` action parameters to `'update_role'`, `'deactivate'`, and `'reactivate'`.
  - Introduced `authFetch` client helper in `apps/web/src/lib/api/client.ts` with session bearer token attachment across all admin screens.
  - Aligned route names with PRD §13 and `000_TOC.md`: `/api/v1/admin/transfer-ownership` and `/api/v1/admin/users/invite`.
  - Corrected verification commands to `pnpm --filter @clt/web check` and aligned PRD §16.2 test names in §7.
  - Updated task breakdown in §13 to `CLT-PLAN-009-A` through `CLT-PLAN-009-D` with `Role: Builder`.
  - Added `startDate`, `endDate`, `actor`, `table`, `action` query filters to the audit viewer and endpoint.
- Revision 2.0 — 2026-10-30:
  - Fully populated specifications for all 9 admin UI screens and 12 server mediation endpoints under `/api/v1/admin/*`.
  - Enforced 100% deduction upper-bound check on client and server.
  - Added Vitest validation test suite for admin calculations.
