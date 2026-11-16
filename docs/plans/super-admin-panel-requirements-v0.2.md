# Super Admin Panel – Requirements

Draft v0.2 · 2026-11-14 · App: Kumon Ledger Track (repo `payment-ledger-track`, code state `939826b`, 2026-11-13)

## 1. Read this first

v0.1 was written blind. v0.2 is based on your answers and on the actual code. Five things matter most:

1. **"Withhold a center" does nothing today.** The Suspended and Archived statuses can be set from the Franchise Centers page, but I found no code that checks them at login, at sync push or pull, or in the database policies. A suspended center keeps working. This is the first thing to fix.
2. **There is no 2FA anywhere in the app.** The Super Admin account can read and (per your decision) change every center's books, and it is protected by a password only.
3. **God-mode ledger edits are not built, and the design docs say the opposite.** The multi-tenancy design calls the Super Admin a "read-only audit oversight portal". The void and supersede functions accept Owner and Admin only. Your decision (the Super Admin can do anything) is the new rule and the design doc needs updating to match.
4. **Bangla does not exist yet.** The UI is English only (`lang="en"`, one English message file). That is an app-wide job, not a panel feature, but a message catalog is already in place, so it is mostly translation plus a language switch, not a rewrite.
5. **7-year audit retention is not guaranteed.** The audit table is append-only and nothing purges it, and a daily encrypted off-Supabase backup runs, but nothing in the repo says how long those backup files are kept.

## 2. What a center is

A center is a Kumon learning center run by an independent franchisee. It is the tenant. Every tenant table carries `center_id`, and one database serves all centers. Each center has one owner (enforced by the database), plus admins and staff. A user's email belongs to exactly one center. A franchisee with two centers needs two email addresses.

Roles in the code: `super_admin` (no center, you), `owner`, `admin`, `staff`.

## 3. Your answers and what they changed

| Your answer | What it means for the panel |
|---|---|
| Kumon franchise centers, a mini ledger | Center = tenant (section 2). Owner per center is fixed at one. |
| Only you are Super Admin | Dropped delegated roles, multi-admin approvals and support-staff features. Recovery must not depend on anyone else. |
| Not monetized, but you must be able to withhold a center | Billing removed. Suspend and archive become the core control, and they must actually enforce. |
| The Super Admin can do anything; center owners cannot edit | Super Admin gets full ledger powers in every center (section 5.5). The code currently lets Owner and Admin void and supersede entries, which conflicts with "cannot" (see section 9). |
| English and Bangla | App-wide i18n task (SA-CFG-02). |
| Currencies: "both" | The code is BDT only, in integer poisha, all the way through. Written as BDT only. Confirm in section 9. |
| Audit kept 7 years | SA-AUD-03. |
| Never notify center owners | No notifications to centers about Super Admin actions. See SA-AUD-05 for the audit-log visibility consequence. |

## 4. Principles

- **Super Admin = every permission of every role, in every center.** Express "god" as a superset of Owner, not as a separate special case.
- **God does not mean unlogged.** Every action writes an audit row with before and after values. This is not optional, and it is the only brake on the one account that can change anything.
- **Money stays integer poisha**, and edits go through the existing void and supersede chain, so entry numbers, statement lines and settlement math stay consistent.
- **The panel is online only.** Center devices stay offline-first and keep working when the panel or server is down.

Priority: **M** must, **S** should, **C** could. Status: **Built** (in the repo today), **Partial**, **New**.

## 5. Functional requirements

### 5.1 Authentication and access

- **SA-AUTH-01 (M · Built)** Dedicated `super_admin` identity: no center, cannot be created through the invite flow (`403 cannot_invite_super_admin`), lands on Franchise Centers after login.
- **SA-AUTH-02 (M · New)** Mandatory TOTP 2FA for the Super Admin. No MFA exists anywhere in the code today.
- **SA-AUTH-03 (M · New)** Re-authentication (password plus 2FA code) before destructive actions: suspend or archive a center, replace an owner, set an owner's password, edit or void entries in a closed month.
- **SA-AUTH-04 (M · New)** Recovery codes issued at 2FA setup, plus a written recovery procedure (the repo has a bootstrap script that references the Super Admin; confirm it can restore access). You are the only Super Admin, so a lost phone must not lock you out of the whole platform.
- **SA-AUTH-05 (S · New)** Idle session timeout, active-session list, and an email alert on a login from a new device.
- **SA-AUTH-06 (C · New)** Optional IP allowlist for the Super Admin routes.

### 5.2 Dashboard

- **SA-DASH-01 (M · New)** A landing page with: centers by status, entries and gross amount today / 7 days / 30 days per center, centers with no entries in N days.
- **SA-DASH-02 (S · New)** Sync health: devices not seen in N days, rejected sync operations awaiting resolution, centers with stale rate profiles.
- **SA-DASH-03 (C · New)** Month-close status per center (which centers are late closing).

### 5.3 Center management

- **SA-CTR-01 (M · Built)** Create a center atomically: center record, five payment methods, four payables, rate profile v1, settings, entry counter and owner account (`rpc_create_center`).
- **SA-CTR-02 (M · Built)** Edit center profile. The center code is immutable by design.
- **SA-CTR-03 (M · Partial)** **Suspend and reactivate, enforced.** Status toggle and audit exist; enforcement does not. Required: a suspended center cannot log in, existing sessions are cut off (a valid login token otherwise keeps working until it expires), sync push and pull are refused with a clear error code, and the app shows a plain "account withheld" message. Reason is recorded.
- **SA-CTR-04 (M · New)** **Unsynced offline entries from a suspended center are held, not discarded.** Held entries go into a review queue you can accept or reject. (The design doc lists this as an unresolved question. This is the recommendation.)
- **SA-CTR-05 (M · Partial)** Archive: same blocking as suspend, hidden from the default list, reversible. No purge: a center that has data cannot be hard-deleted because other tables reference it, and that is the right default for financial records.
- **SA-CTR-06 (M · Built)** Replace an owner or rename one. Gap: the old owner is demoted to admin, not removed, so they keep access. Add a choice on transfer: demote to admin or deactivate.
- **SA-CTR-07 (S · Built)** Set an owner's password directly. This is built and fine for a sole admin; prefer a reset link when the owner has working email. Always audited.
- **SA-CTR-08 (S · New)** Editable provisioning template. Today the defaults (methods, payables, 42% commission, charge rates) are hardcoded in the migration, so changing them needs a code change.
- **SA-CTR-09 (S · New)** Per-center data export (entries, settlements, statements, audit) as an audited full backup.

### 5.4 User and device management

- **SA-USR-01 (M · New)** Search users across all centers by name or email. The current Global Search finds ledger entries, not users.
- **SA-USR-02 (M · New)** View any center's users; disable or enable an account; force sign-out.
- **SA-USR-03 (M · New)** View all devices across centers (name, user, last seen, rate version) and revoke or un-revoke. Revoke exists today but only for a center's own Admin and Owner.
- **SA-USR-04 (S · New)** Remote wipe of local data on next connect for a lost device.
- **SA-USR-05 (C · New)** Move a user to another center. Not supported by design today (one email, one center), so this is a deliberate change, not a quick feature.

### 5.5 Ledger powers (the "god" part)

- **SA-LED-01 (M · Partial)** Read everything in every center: entries, settlements, statements, reconciliation, month closes. Today only a Global Search over entries exists (customer name and transaction reference, max 100 results). Add browsing with filters (center, date, method, status, creator) and per-center totals.
- **SA-LED-02 (M · New)** Create, supersede (edit) and void entries in any center. Entries are marked as created or changed by the platform. Void requires a reason (the database already enforces this). Supersede takes an optional note.
- **SA-LED-03 (M · New)** Inherit every Owner-only action in every center: reopen a closed month, approve a settlement overpayment, review reconciliation exceptions, publish rates.
- **SA-LED-04 (M · New)** **Impact preview before applying.** An edit changes settlement liabilities and resets statement matches for that month. Show what will change, then apply. God powers without this will break a center's reconciliation silently.
- **SA-LED-05 (M · New)** Closed months: the Super Admin can reopen and edit, with re-authentication (SA-AUTH-03).
- **SA-LED-06 (M · Decision)** **No hard delete from the panel.** Void is delete. A hard delete breaks entry numbers, statement-line links and settlement math. A sanctioned purge path already exists outside the app (`pnpm db:purge-entry`, backed by `maintenance_purge_entries`): it previews the row and the settlement impact, refuses closed months and reconciled entries, and writes an audit row. Keep it there. You can overrule this.
- **SA-LED-07 (S · Partial)** Platform-wide anomaly view: duplicate transaction references and stale-rate flags exist per center today; surface them across all centers.
- **SA-LED-08 (S · New)** Export filtered ledger data (CSV, XLSX, PDF). Exports are audited.

### 5.6 Platform configuration

- **SA-CFG-01 (M · Built)** BDT only, integer poisha. Multi-currency would touch the calc engine, schema and every report, so it is out of scope unless you confirm you need it.
- **SA-CFG-02 (M · New)** English and Bangla across the whole app, panel included, through one i18n layer. Today: English only.
- **SA-CFG-03 (S · New)** Maintenance mode with a message shown on center devices.
- **SA-CFG-04 (S · New)** Minimum supported app version with forced update.
- **SA-CFG-05 (C · New)** Corporate rate template that centers cannot change. Open design question: do centers keep full control of their rates?

### 5.7 Audit and security

- **SA-AUD-01 (M · Built)** Append-only audit log. A database trigger blocks update and delete.
- **SA-AUD-02 (M · Partial)** Every Super Admin action logged with before and after values. Center create, status change, owner change and password reset are logged today. Add all ledger actions (SA-LED), user and device actions, exports.
- **SA-AUD-03 (M · New)** Keep audit records at least 7 years. Needed: a written retention rule; confirmation that the daily encrypted off-Supabase backup (GitHub Actions, 02:00 Dhaka) keeps its files for 7 years and includes the audit table (the repo does not say; the managed point-in-time recovery is a 7-day window, and whether your plan includes it is unverified); and an index plan so the table stays fast as it grows (it is not partitioned).
- **SA-AUD-04 (M · Built)** Super Admin audit viewer across all centers (`/admin/audit`).
- **SA-AUD-05 (M · Decision)** **Hide Super Admin actions from center-facing audit pages.** You said centers are never notified. Today a center's Owner and Admin can read their own center's audit rows, which would show your edits. Tag audit rows with the actor's role and filter Super Admin rows out of center views. Risk: silent changes to a franchisee's financial records are a trust problem if it ever comes out, and possibly a legal one. That is a question for counsel, not for this doc. You keep the full trail; centers do not see it.
- **SA-AUD-06 (C · New)** Tamper evidence (hash chain) and an off-platform copy of the audit log.

### 5.8 Other

- **SA-RPT-01 (S · New)** Platform reports: entries and gross by center and month, inactive centers, Super Admin changes by center, sync failures. Export CSV, XLSX, PDF.
- **SA-COM-01 (C · New)** Broadcast message to all or selected centers.
- **SA-DAT-01 (C · New)** Backup status and last successful backup shown in the panel. Backup and restore procedures already exist as runbooks.
- **Dropped:** billing and subscriptions (not monetized); delegated or support roles (you are the only admin); view-as impersonation (you can already read and act in every center directly, so it adds risk and no value).

## 6. Non-functional requirements

- **Authorization on the server, always.** Super Admin routes use the service-role database key, which bypasses row-level security, so the only protection is the role check at the top of each route. Add a test that every route under `/api/v1/admin/super` rejects every non-Super-Admin role, and run it on every change.
- **Integrity:** integer poisha, append-only audit, void and supersede chain, advisory locks on month, sequence and rate. God edits must take the same locks as center edits.
- **Offline conflicts:** a center device may hold a queued edit against an entry you already changed. It must fail with the existing error codes (for example `cannot_supersede_non_active`) and appear in a rejected-operations list, not corrupt data.
- **Availability:** panel downtime must not stop centers recording payments.
- **Performance:** server-side pagination everywhere; dashboard numbers cached; large exports run in the background.
- **Time:** store UTC, show Asia/Dhaka.

## 7. Suggested order of work

1. **Fix what is unsafe:** enforce suspend and archive (SA-CTR-03, 04, 05), TOTP 2FA and recovery codes (SA-AUTH-02, 03, 04), route-authorization test (section 6).
2. **God powers:** cross-center ledger browsing, create, supersede, void, owner overrides, impact preview, closed-month override, full audit (SA-LED-01 to 06, SA-AUD-02, 05).
3. **Operate the fleet:** dashboard, user search and disable, all-device view, audit retention and yearly export (SA-DASH, SA-USR, SA-AUD-03).
4. **Everything else:** Bangla, provisioning template, reports, maintenance mode, forced updates, exports.

## 8. Acceptance (headline)

- A suspended center cannot log in, cannot sync, and its existing sessions stop working. Its unsynced offline entries land in a review queue.
- No Super Admin login succeeds without a 2FA code.
- Every route under `/api/v1/admin/super` returns 403 to owner, admin and staff.
- Every Super Admin change to any center's data creates an audit row with before and after values.
- A Super Admin ledger edit shows an impact preview first, and takes the same month, sequence and rate locks as a center edit.
- Center-facing audit pages never show Super Admin rows.

## 9. Decisions still needed from you

1. **Owner and Admin ledger edits.** You said center owners cannot edit. The code and the PRD let Owner and Admin void and supersede entries (they cannot change an entry in place), and staff can only request a void. I left that as is. Say if you want it removed or narrowed.
2. **Currency.** You answered "both". The app is BDT only in integer poisha. I wrote BDT only. Confirm, or tell me what second currency you need, knowing it is a calc-engine and schema change.
3. **Hiding your edits from centers (SA-AUD-05).** I assumed yes, per "never notify". Confirm, and consider asking counsel.
4. **Offline entries from a suspended center (SA-CTR-04).** I chose "hold for your review" over "reject permanently". Confirm.
5. **Bangla scope.** App-wide, including center staff screens, using the existing message catalog. Confirm.
