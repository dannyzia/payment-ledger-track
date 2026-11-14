# Super Admin Panel

* **Author:** dannyzia
* **Date:** 2026-11-14
* **Basis:** `docs/plans/super-admin-panel-requirements-v0.4.md` (the draft this brief reviews), plus the repository as it exists today.
* **Review:** seven Goldfish lenses, run in fresh contexts with the persona files installed from `google/elephant-goldfish-model` (Apache-2.0). The reviewers were given a verified fact packet and had no filesystem access, so the code claims in this brief come from my own reading of the repo, not from their inspection. That limitation is recorded here rather than hidden.
* **Prior brief:** the earlier password-visibility brief now lives at `concepts_brief.md`.

## Overview

The Super Admin is Zia's own seat in a franchise payment ledger: one account, belonging to the app owner, that can act in every center. The centers are Kumon learning centers run by independent franchisees; each is a tenant in one shared Postgres database, and each has one owner, plus admins and staff.

v0.4 states the seat as "god" — every permission of every role, in every center — constrained only by the requirement that its actions are audited. It adds withholding a center, reading any ledger, creating, editing, voiding and purging entries, inheriting every Owner-only action, managing users and devices, mandatory two-factor login, an impact preview before ledger edits, and hiding the Super Admin's actions from the franchisees whose books it changes. The build is local only: no hosted database, no deployment, one developer, no franchisee yet.

The concept is sound in its aim and dangerous in its phrasing. Every blocker below is a consequence of one sentence being treated as a specification: "the Super Admin can do anything."

## Analysis

### What the lenses agreed on

**1. "God" is not a specification (Blocker).** Two lenses hit this independently. As written, an engineer cannot tell what is licensed, and an auditor cannot tell whether an action exceeded authority. The fix is not to weaken the power but to name it: a canonical capability registry, with Owner's capabilities a named subset of the Super Admin's, and a test asserting `Owner ⊆ SuperAdmin` whenever either changes. Cross-center reach becomes a separate scope constraint rather than duplicated role logic. Without the registry, every future Owner permission silently drifts out of the Super Admin's set, or enters it without being intended for cross-center use.

**2. The account cannot recover itself (Blocker).** Verified in the code: `scripts/bootstrap.ts` sets the role on an existing user and ignores `BOOTSTRAP_OWNER_PASSWORD` for that user, and nothing in `apps/web/src` touches MFA, password reset, factors or recovery links — zero matches. Adding mandatory TOTP without a recovery path builds a lock-out for the only account that can operate the platform. The recovery tool should be an operator-run CLI using the service credential, requiring the user id and a written reason, clearing only that user's factor, forcing re-enrolment, revoking refresh sessions, and writing an audit event. Recovery via the Supabase dashboard is a fallback, not a design.

**3. Re-authentication must be checked by the server, per request (Blocker).** A SPA prompt is not authority. The enforceable check is the assurance level in the token: super-admin routes reject anything that is not `aal2` at the point of use, for the specific actions named as destructive. This is also the cheapest thing to build early, because retrofitting an assurance check into every service-role route later touches all of them.

**4. Suspension and the offline outbox form a state machine nobody has drawn (Blocker).** The draft says queued entries survive suspension and sync on reactivation. It does not say that sync ops older than 90 days are routed into an admin review queue — and the suspended center's own admins cannot open it. A center withheld for a quarter therefore loses the queued payments it was promised would be kept. The resolution is not a new review queue in the panel but a pause: suspension stops the retention clock for that center's pending operations, and reactivation resumes it. Center lifecycle and sync-op lifecycle have to be specified as two machines with an explicit, idempotent interaction.

**5. A ledger edit after reconciliation breaks the evidence (Blocker).** Immutability of entries does not preserve correctness if a supersede or void changes the population behind a reconciliation that already passed. The edit has to produce a versioned correction, mark the affected reconciliation stale, recompute the settlement outputs, and require re-approval before that month reads as settled. The impact preview is the user-facing half of this and needs a definition, not a promise: which rows, which derived effects, which month state, and a version stamp so a stale preview cannot be applied.

**6. There is no backup, so there is no recovery story (Blocker).** Verified 2026-11-14: the repository has zero Actions secrets and zero environments, and the nightly archive step has failed on every scheduled run since at least 2026-11-08 — six consecutive failures, each about thirty seconds, which is the script exiting on a missing database URL. The storage sync in that same script targets a path the backup keys cannot reach, and the failure is swallowed by a catch block, so receipts and statement PDFs are never archived either. Supabase itself keeps 7 days of daily backups on Pro, 14 on Team, up to 30 on Enterprise; seven-year retention cannot come from the platform at any tier short of Enterprise. Until the archive runs and a restore drill passes, every claim about audit retention is blank.

**7. Ownership of a Super Admin entry is undefined (Blocker).** Creating an entry inside a franchisee's books raises three questions the draft leaves open: what the entry is attributed to, how it takes a number under that center's sequence lock after the month lock, and how it reaches the center's devices through pull without the devices treating the platform account as a center user. Each has a natural answer; none is written down.

**8. Hiding audit rows is not access control (Major, and it contradicts the export).** Filtering at render time makes the rule depend on every screen, search and export remembering to filter. Three lenses converged on the same fix: record visibility at the write boundary and enforce one shared read model. That immediately exposes the contradiction the draft carries — a per-center export that includes audit, and therefore hands the franchisee what the UI withholds. Either the export filters too (and the "full backup" is not full), or the center eventually sees everything. This is the one place where the reviewers and the owner's recorded decision disagree, so it is listed as an open decision rather than quietly resolved.

**9. Deferring is not cutting (Major).** For a local-only build with one user and no franchisee, the honest first panel is the two screens that exist, plus the assurance check, plus real suspension enforcement. Dashboard, cross-center user and device management, exports, purge UI, seven-year retention and Bangla are not wrong; they are waiting for a hosted fleet and a real support case. The trigger for each should be written down, so they are deferred deliberately instead of forgotten.

**10. Bangla and exports must not be written twice (Major).** Both are cheaper as one shared layer: every user-facing string through the catalog from the start, and every export built from the same authorized, center-scoped read model as the screen it mirrors. Two implementations of either will drift.

### Where the draft and the review collide

The draft hides the Super Admin's actions from franchisees and gives the owner a guarded hard purge. The Inventive Catalyst lens does not accept that boundary: it proposes that an affected center's own history always show that a platform action happened, with the actor's role and the timestamp, while personal data erasure stays separate from the financial record. That is the difference between "silent" and "attributable", and it is the single decision in this concept I would not let pass without an explicit yes or no from the owner.

### Contradictions and how to resolve them

| Contradiction | Resolution | Cost of the resolution |
|---|---|---|
| Unlimited owner writes vs an immutable ledger | Every owner action is a recorded command through the audited RPCs; no direct row edits; purge stays an out-of-band script | More command surface to build and test |
| Hiding the owner vs a complete center export | One write-time visibility rule, applied in every read path; the center sees that an action happened | The "hidden" promise weakens to "unattributed" |
| Immediate suspension vs queued staff payments | Suspension pauses retention instead of expiring queued work | Suspension needs a defined end state, not just a flag |
| One all-powerful account vs independent recovery | Pre-enrolled recovery codes plus an operator CLI, tested before TOTP is enforced | A second credential to custody |
| Local-only build vs fleet requirements | Defer with named unlock triggers | The panel does not grow this month |
| Shared database vs tenant isolation | Center-scoped by default; cross-center reads only through one audited administrative path | Every cross-center path needs its own isolation test |

## Goals vs. Non-Goals

**In scope**
- One owner seat that can act in any center, expressed as a named capability set with Owner ⊆ SuperAdmin.
- Withholding a center that actually withholds: blocked at the route, at sync and at the database, with queued staff work preserved.
- Server-verified assurance level and re-authentication for the destructive actions.
- A recovery path that works without the Supabase dashboard.
- Cross-center read for support, with filters and pagination.
- Ledger powers that go through the existing void and supersede chain with an impact preview, attribution and audit.
- A working off-Supabase archive with failure alerting, and a restore drill.

**Out of scope**
- Billing, subscriptions, delegated support roles, view-as impersonation (settled in v0.4).
- Any change to what center Owner and Admin may do inside their own center.
- Multi-currency.
- A second Super Admin, or approvals split across people.

## Alternatives Weighed

- **Rejected by the author (v0.1–v0.4):** a read-only "audit oversight portal", as the original multi-tenancy design described the seat. Superseded by the owner's decision that the seat can act, not only observe.
- **Rejected by review, Contrarian:** building the whole v0.4 must-have list now. With no hosted fleet, dashboard, device management, exports, purge UI, retention and Bangla should wait for named triggers.
- **Rejected by review, Comprehension:** leaving "god" as the requirement and trusting the implementer to infer the boundary. Replaced with a capability registry and an explicit deny-by-default sentence.
- **Rejected by review, Structural:** filtering audit rows in the UI. Replaced with write-time classification and one shared read model.
- **Rejected by review, Implementation Readiness:** treating "session cut off" as a token revocation alone. Supabase access tokens stay valid until they expire, so the cut-off must also be enforced where data is read.
- **Rejected by review, Inventive Catalyst:** a separate escrow intake for suspended centers' queued payments. Pausing the retention clock achieves the same preservation without a second intake path.
- **Rejected earlier, in the multi-tenancy design:** an instance or a schema per center. Row-level tenancy was chosen instead, and that choice is not reopened here.

## Key Decisions & Staging for Next Steps

**Decisions to carry into `/egm-draft`**
1. Express the seat as a capability registry, not as prose. Owner's capabilities are a named subset, tested.
2. Assurance level is checked in `getCallerContext` for super-admin routes, at the point of use.
3. Suspension pauses sync-op retention for that center; it does not expire queued work.
4. Every owner ledger action is an audited command with a versioned impact preview.
5. Audit visibility is decided at write time and applied in one read model used by screens, search and export.
6. The archive is fixed and a restore drill passes before any retention claim is made.
7. Deferred items each get a written unlock trigger.

**Still the owner's to decide**
1. Do franchisees see that a platform action happened to their center (attributable, actor unnamed), or nothing at all (silent)?
2. Does the guarded hard purge exist in the panel, or stay as the `pnpm db:purge-entry` CLI where it already previews, refuses closed and reconciled months, and audits?
3. Which v0.4 must-haves are deferred until the first hosted center, given the build is local-only today?

**Unresolved by this brief**
The reviewers worked from a fact packet, not the repository. Anything in the draft that depends on a code detail I did not read is still unverified, and should be re-checked when the draft is turned into a plan.
