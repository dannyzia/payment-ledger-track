# Physical Device Journey Runbook — Cosmo Ledger Track

How to run `scripts/e2e/test-device-journey.ts` against a chosen centre on a real
handset, including switching fixture accounts. Plan 019 §8 and the Gate 5 device
items are the motivating checks; this runbook is the operating procedure, not an
approval. Nothing here is "passed" without pasted output or a dated screenshot.

## 1. What the journey proves

One entry, end to end, on hardware rather than in Chromium:

| Step | Assertion |
|---|---|
| 1 | The signed-in account matches, and Dexie holds only `KumonLedger_<center id>` |
| 2 | The form shows `<code> - <name>`, `Online`, and an `E-<code>-…` ID preview |
| 3 | bKash is selectable and the live breakdown matches the published rates |
| 4 | The local save completes quickly and reports `#LOCAL-xxxx` |
| 5 | The sync indicator reaches `Synced` |
| 6 | The row exists in Postgres under the expected `center_id` |
| 7 | The ledger lists the new customer |
| 8 | The dashboard totals move |

Screenshots land in `docs/orchestration/evidence/device-e2e/` (five PNGs). A capture
that cannot be taken is logged and skipped: evidence never decides whether the
functional checks pass.

## 2. Prerequisites

| # | Prerequisite | Check |
|---|---|---|
| P1 | JDK 17 (the Gradle wrapper 8.2.1 predates JDK 21) | `bash -c 'JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 java -version'` |
| P2 | Android SDK with `adb`; the project records it in `apps/web/android/local.properties` | `test -x "$(sed -n 's/^sdk.dir=//p' apps/web/android/local.properties)/platform-tools/adb"` |
| P3 | Device attached and authorised | `adb devices` shows it as `device` |
| P4 | Handset **unlocked** and screen awake | `adb shell dumpsys trust \| grep deviceLocked` must report `0` |
| P5 | The app installed and running | `adb shell am start -n com.cosmo.ledgertrack/.MainActivity` |
| P6 | A dev server for **this** project, reachable from the handset | see §3 |

A locked handset is the most common false alarm: its WebView produces no animation
frames, so Playwright's clicks time out and screenshots never return. That looks
exactly like a broken app and is not one.

## 3. Backend and tunnels

`PUBLIC_API_BASE` is baked into the APK at build time (AGENTS.md §2). The debug APK
on the test handset targets `http://localhost:5173`, and `adb reverse` points that
device port at this project's dev server.

**On this machine port 5173 is occupied by an unrelated application** (its login
page titles itself *Rakazo*), so the dev server runs on 5180 and is mapped over the
device's 5173:

```bash
set -a; . ./.env.local; set +a
pnpm --filter @clt/web dev --port 5180 --strictPort   # in another terminal

adb reverse tcp:5173 tcp:5180   # the app's baked API origin → this project
adb reverse tcp:54321 tcp:54321 # local Supabase for auth
```

Confirm the mapping before blaming the app:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5180/api/v1/auth/session  # 401 = this app
adb reverse --list
```

## 4. Fixture accounts

Three fixtures exist in the local development database. Fixtures are named, so two
of them can share the Mohakhali centre:

| Fixture | Centre | Account | Role |
|---|---|---|---|
| `MHK` | MHK — Kumon Mohakhali Center | `device.check@cosmoledger.local` | staff |
| `MHK_OWNER` | MHK — Kumon Mohakhali Center | `owner.mhk@cosmoledger.local` | owner |
| `RMP` | RMP — Kumon Rampura Center | `rmp.check@cosmoledger.local` | staff |

The owner fixture is what makes owner-only screens (`/reports`, `/settlements`,
`/admin`) exercisable on the handset; a staff session is redirected away from them.

### One command for the whole set

```bash
pnpm test:e2e:device
```

Runs three checks in order, stopping at the first failure: the fixture smoke check
(`verify-device-fixtures.ts`), the owner screens and API access, then the staff
guard. Each one signs the handset in through the app's own form, and the fixture
and owner checks put the handset back on the account it started on. It needs the
device connected with the WebView and backend reachable — the same preflight every
script runs — and nothing else: credentials come from `.env.local`.

`owner.mhk@cosmoledger.local` (owner, MHK) is the fallback account when no fixture
variable is set.

Passwords are **not** in this repository (AGENTS.md Rule 8). They live in the
gitignored `.env.local`:

| Variable | Meaning |
|---|---|
| `CLT_DEVICE_FIXTURES` | Fixture registry, e.g. `MHK,MHK_OWNER,RMP`. Unset means every centre is itself a fixture (`MHK` → `CLT_DEVICE_MHK_*`), which is the older behaviour |
| `CLT_DEVICE_<NAME>_ACCOUNT` | Sign-in email for that fixture |
| `CLT_DEVICE_<NAME>_PASSWORD` | Its password |
| `CLT_DEVICE_<NAME>_CENTER` | The centre code the fixture belongs to (`MHK`, `RMP`) |
| `CLT_DEVICE_<NAME>_ROLE` | Role it should hold; default `staff` (`MHK_OWNER` sets `owner`) |
| `CLT_DEVICE_ACCOUNT` / `CLT_DEVICE_PASSWORD` | Any account, overrides the per-fixture pair for a journey |

These are local development fixtures only. To recreate or refresh one:

```bash
E2E_STAFF_EMAIL='rmp.check@cosmoledger.local' \
E2E_STAFF_PASSWORD='<from .env.local>' \
E2E_FIXTURE_ROLE=staff \
E2E_FIXTURE_CENTER_CODE=RMP \
npx tsx --env-file=.env.local scripts/e2e/create-staff.ts
```

`create-staff.ts` goes through the Supabase admin API, so the profile's role and
centre are derived by `fn_auth_users_create_profile` exactly as in production.

**Do not point `create-staff.ts` at an existing owner to change its password.** It
upserts `app_metadata`, so it would re-assign the role and demote the single owner
account. Rotate a credential instead:

```bash
CLT_FIXTURE_PASSWORD='<new value>' npx tsx scripts/e2e/set-fixture-password.ts \
  --email=owner.mhk@cosmoledger.local
```

It changes only the password and prints the role and centre it left untouched.

### Checking the owner-only screens

```bash
pnpm exec tsx scripts/e2e/verify-owner-screens.ts            # the declared owner fixture
pnpm exec tsx scripts/e2e/verify-owner-screens.ts --fixture=MHK
```

It signs the handset in as the fixture whose `CLT_DEVICE_<NAME>_ROLE` is `owner`
(`--fixture` overrides the choice; `--account` + `--password` works without a
fixture), then visits `/reports`, `/settlements` and `/admin` and requires each one
to stay on its route, render its own heading, and — for the two guarded pages —
not render the "Access Restricted" notice that a staff session gets. It also
checks the mobile menu, because `/admin` has no in-page guard: the menu link and
the admin APIs returning 403 are its only gate. The handset is restored to the
account it started on, and the exit code is the verdict.

It then probes the same seven endpoints as the owner: the four reads must answer
200 and the three owner-only writes must stop at their schema (400) — an owner has
to be able to use them, and an empty body cannot close a month. A 403 on any of
them fails the run, because that would mean the owner is locked out of their own
operations. Together the two modes cover both sides of the role gate:

```
Signed in: owner.mhk@cosmoledger.local (owner, center MHK) — fixture MHK_OWNER (Kumon Mohakhali Center)
  /reports      PASS  Monthly Reports rendered, no restriction notice
  /settlements  PASS  Monthly Settlements rendered, no restriction notice
  /admin        PASS  Admin Hub rendered, no restriction notice
  /nav          PASS  menu offers /reports, /settlements, /admin
  /api          PASS  4 reads 200, 3 writes 400 at validation (no mutation), none refused
  Restored session: device.check@cosmoledger.local

Owner screens: 3 routes, mobile menu and 7 endpoints passed as owner.mhk@cosmoledger.local
```

A staff fixture is refused rather than checked, since those screens would fail for
the right reason:

```
❌ OWNER SCREEN CHECK FAILED:
  • device.check@cosmoledger.local has role staff, so the owner-only screens cannot be checked with it.
```

### Checking staff is actually kept out (CLT-R-031)

```bash
pnpm exec tsx scripts/e2e/verify-owner-screens.ts --expect=staff
```

It signs in as a staff fixture (the first one; `--fixture=RMP` picks another) and
asserts the other half of the same rule:

- `/reports` and `/settlements` must not render their content — a redirect away
  counts, as does the "Access Restricted" notice, since both keep the staff
  session out.
- The mobile menu must not offer `/reports`, `/settlements` or `/admin` at all
  (CLT-R-031 is about the link, not just following it).
- Every probed endpoint must answer 403 to the staff token: the four admin GETs
  (`users`, `devices`, `settings`, `audit`) and the three owner-only writes
  (`POST months/close`, `POST months/reopen`, `POST admin/transfer-ownership`).
  This is the check that matters for `/admin`, which has no in-page guard. A 200
  means the endpoint trusted the session; any other status (400 from the schema,
  422, 500) also fails, because then something other than the role gate answered
  and the pass would be a guess.

The write probes post an empty JSON body. Each owner-only route checks the role
before reading the body, so `{}` is refused without reaching the RPC — and every
one of those bodies fails its own schema too, so a route that lost its guard
returns 400 rather than closing a month or transferring the ownership account.
That is exactly why a 400 is treated as a failure rather than a pass.

Real output from the handset:

```
Signed in: device.check@cosmoledger.local (staff, center MHK) — fixture MHK (Kumon Mohakhali Center)
  /reports      PASS  redirected to /dashboard, so the page was never shown
  /settlements  PASS  redirected to /dashboard, so the page was never shown
  /nav          PASS  menu omits /reports, /settlements, /admin
  /admin api    PASS  /api/v1/admin/users 403, /api/v1/admin/devices 403, /api/v1/admin/settings 403, /api/v1/admin/audit 403, POST /api/v1/months/close 403, POST /api/v1/months/reopen 403, POST /api/v1/admin/transfer-ownership 403
  note: /admin sent the staff session to /dashboard of its own accord.

Staff guard: 2 routes, mobile menu and 7 admin endpoints passed as device.check@cosmoledger.local
```

The `note` records what the staff session was actually shown at `/admin`, which is
informational rather than a verdict. In these runs it was sent to `/dashboard`. The
API probe is what carries the verdict there: the redirect is client-side and not
instantaneous — an earlier run of this check caught the hub shell painting before
the redirect landed — so the 403s, not the redirect, are the evidence that staff
cannot read or change anything on that page.

### Check the credentials still work

After rotating a password, changing a fixture, or picking the project up later:

```bash
pnpm exec tsx scripts/e2e/verify-device-fixtures.ts            # every configured centre
pnpm exec tsx scripts/e2e/verify-device-fixtures.ts --center=RMP  # one of them
```

It signs the handset in as each fixture through the app's form, then checks the
profile the app cached: the account, the role the fixture should hold
(`CLT_DEVICE_<CODE>_ROLE`, default `staff`), and that it is scoped to that centre.
The database row is read too, so a drifted role or a stale session is reported with
which side disagrees. It restores the account the phone started on:

```
  MHK  PASS  device.check@cosmoledger.local → MHK (Kumon Mohakhali Center)
  RMP  PASS  rmp.check@cosmoledger.local → RMP (Kumon Rampura Center)
  Restored session: device.check@cosmoledger.local

Fixture credentials: 2 passed, 0 failed, 0 skipped
```

A centre with a missing variable is reported as `SKIP` naming the variable; exit
code is non-zero when any configured fixture fails, or when nothing is configured
to check. A wrong password is reported with the variable it came from, so the run
is a one-line diagnosis rather than a login-screen mystery. A role that no longer
matches its expectation prints both what the session holds and what the database
row says, which separates a stale cached profile from a changed account.

## 5. One command per centre

```bash
pnpm exec tsx scripts/e2e/test-device-journey.ts --center=RMP
```

That is the whole switch: the journey resolves `RMP` from `centers`, picks up
`CLT_DEVICE_RMP_ACCOUNT` and `CLT_DEVICE_RMP_PASSWORD` from `.env.local`, signs the
handset out and back in when it is on another account, and only then runs the
assertions.

Resolution order (first hit wins):

| Setting | Order |
|---|---|
| Centre | `--center` → `CLT_DEVICE_CENTER` → `MHK` |
| Account | `--account` → `CLT_DEVICE_ACCOUNT` → `CLT_DEVICE_<CODE>_ACCOUNT` → `owner.mhk@cosmoledger.local` |
| Password | `--password` → `CLT_DEVICE_PASSWORD` → `CLT_DEVICE_<CODE>_PASSWORD` |

`--center` accepts a code (`RMP`) or a UUID. With no password available and the
handset on the wrong account, the run stops and names what it found rather than
continuing under the wrong identity.

Switch accounts without running the journey:

```bash
pnpm exec tsx scripts/e2e/device-sign-in.ts --email=rmp.check@cosmoledger.local --password="$CLT_DEVICE_RMP_PASSWORD"
```

It prints the cached profile and the entry form's centre chips, which is how you
see the switch actually took.

## 6. When it stops

The journey runs a preflight first and reports environment faults as themselves:

| Message | Cause and fix |
|---|---|
| `The handset is at its lock screen (deviceLocked=1)` | Unlock it, keep the screen awake, re-run |
| `No WebView DevTools socket` | App not running, or WebView debugging off: `adb shell am start -n com.cosmo.ledgertrack/.MainActivity` |
| `No 'adb reverse' rules` | Tunnels lost (they drop on reconnect): re-issue the §3 commands |
| `No reversal reaches this app's API (… HTTP 404)` | The port is serving another application; map the device port at this project's dev server |
| `adb could not be run` | Set `ADB`, `ANDROID_HOME`, or `sdk.dir` in `apps/web/android/local.properties` |
| `Phone is signed in as X, but this journey targets Y` | Nothing to switch with: the message names the exact `CLT_DEVICE_<CODE>_ACCOUNT` and `_PASSWORD` lines to add to `.env.local`, or pass `--password` |
| `Sign-in as X did not reach the dashboard` | Rejected credentials: the message names the flag or the environment variable that supplied the password, so you know which value to correct |
| `that account belongs to center …` | The chosen account is scoped elsewhere; pick the account for that centre |
| `Center "ZZZ" was not found` | Lists the code of every centre in the database |

Steps 5 and 6 tolerate a slow push (they poll), so a slow sync is not a failure;
a missing row after the polling window is.

## 7. Evidence and cleanup

- Screenshots: `docs/orchestration/evidence/device-e2e/{1-dashboard-initial,2-entry-form-filled,3-entry-saved-success,4-ledger-view,5-dashboard-updated}.png`
- Each run writes one immutable entry. Entries are not deletable from the app
  (`CLT-R-029`); owner-authorised cleanup is
  `pnpm db:purge-entry --entry <uuid> --reason "<why>"` (local databases only
  unless `--allow-local` is waived with `--allow-remote`).
- Record what was run — centre, account, result, row id — in
  `docs/orchestration/`. Never paste a password into a record, brief, report, or
  chat (AGENTS.md Rule 8).
