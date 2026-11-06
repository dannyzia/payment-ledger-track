# Gate 5 — Physical Android Device Test Checklist

Prepared: 2026-11-06. Owner of the run: **Zia** (AGENTS.md §9 table, Gate 5 items).
This is a **protocol to execute**, not an approval. Nothing here is marked passed
without a pasted result, a dated screenshot, or a measured number. Tester fills §7;
Zia signs §8.

## 0. What must be proven

Verbatim requirements this run exists to satisfy:

- **PRD §17, M5 Definition of Done:** "App runs offline on device; floating menu
  behaves on real hardware with docking and collision avoidance; all 65 regression
  tests pass; all five Implementation Readiness Gates verified; Business Owner
  confirmation of open business policies (Q1–Q4) recorded in `DECISIONS.md`."
- **PRD §18, Gate 5 (Accessibility & Visual Proof),** five bullets: measured WCAG AA
  ≥ 4.5:1 design tokens; solid-colour fallback for button text where
  `background-clip: text` fails in Android WebView; floating menu default dock
  `bottom: 24px; right: 24px` with collision avoidance so it never covers the primary
  Save button (`#btn-save`); `prefers-contrast: more` and
  `prefers-reduced-transparency: reduce` verified across all views; backdrop filters
  bounded to interactive overlays for low-end mobile rendering.
- **Plan 019 §8 acceptance item 7:** airplane-mode entry under 20 s with `#LOCAL-xxxx`
  IDs; menu 12 px viewport clamping and tactile snap haptics; settlement notifications
  in the status bar with formatted BDT outstanding; sync resumes when airplane mode is
  disabled.
- **PRD §16.3 items 4–5** (E2E incl. floating menu drag/snap and reduced-motion
  fallbacks; visual check of pearl grain, glass menu, frosted buttons, light and dark
  contrast).

## 1. Scope of this run

**In scope:** Gate 5's device and visual items, the M5 device sentence, and the
Plan 019 item-7 hardware behaviours.

**Out of scope:** Google Play review and store listing (separate release step);
Q1–Q4 business-policy confirmation (Rule 20, packet:
`OWNER_DECISION_PACKET_Q1_Q4.md`); production deployment (Rule 19 `ZIA-APPROVED` line).

## 2. Prerequisites — measured state on 2026-11-06

| # | Prerequisite | Check command | Expected | Measured today |
|---|---|---|---|---|
| P1 | Plan 019 code present | `ls apps/web/capacitor.config.ts scripts/build-android.sh apps/web/android-config/AndroidManifest.xml apps/web/src/lib/native` | files listed | **PRESENT** (TOC row 019 = Partially Implemented) |
| P2 | JDK 17 or 21 | `javac -version` | `javac 17…`/`21…` | **PASS** — `javac 21.0.12.1` |
| P3 | Android SDK + adb | `test -n "$ANDROID_HOME" && test -x "$ANDROID_HOME/platform-tools/adb"` | exit 0 | **BLOCKED** — `ANDROID_HOME` unset, `adb` absent (GS-1) |
| P4 | Physical device, Android 10+, USB debugging | `adb devices` | device listed, not `unauthorized` | **TBD** — no device attached |
| P5 | Low-end device for the performance items | `adb shell getprop ro.build.version.release`, RAM via `adb shell cat /proc/meminfo` | Android 10+, RAM recorded | **TBD** |
| P6 | Build script syntax + executable | `bash -n scripts/build-android.sh && test -x scripts/build-android.sh` | exit 0 | **PASS** (`bash -n` ok) |
| P7 | `PUBLIC_API_BASE` set to the reachable HTTPS backend | `test -n "$PUBLIC_API_BASE"` | non-empty | **UNSET** — the script aborts without it, by design |
| P8 | Release keystore values available from the secret manager | names only: `RELEASE_KEYSTORE_PATH`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS` (Rule 8: never in repo, never in a brief) | present in secret store | **UNVERIFIED** |
| P9 | CLT-T-050 fixed (floating-menu keyboard/pointer activation) | `docs/orchestration/briefs/CLT-T-050.md` implemented | fix merged | **OPEN** — H16 and H15 are expected to fail until it lands |
| P10 | Test accounts for Staff, Admin, Owner | invited via admin panel; Owner exists from bootstrap | 3 accounts usable on device | Admin/Staff **TBD**; Owner exists |
| P11 | Test data only — never real customer names or transaction references | — | fixtures from PRD §6.6 row 1 (Ayash, bKash, ৳5,909.00 gross) | — |

Run does not start until **P3, P4, P7** are green. P9 is not a hard blocker for
starting, but H16/H15 must then be reported as *failed, known defect*, not waived.

## 3. Device matrix (tester fills before testing)

| Slot | Model | Android | WebView version | RAM | Screen dp | Tester |
|---|---|---|---|---|---|---|
| D1 (low-end) | `<fill>` | `<fill>` | `<fill>` | `<fill>` | `<fill>` | `<fill>` |
| D2 (typical phone) | `<fill>` | `<fill>` | `<fill>` | `<fill>` | `<fill>` | `<fill>` |

`adb shell dumpsys webviewupdate | grep "Current WebView package"` gives the WebView
version. Screen dp: `adb shell wm size` divided by `wm density`.

## 4. Build identity (record once, per device)

```bash
git rev-parse HEAD
sha256sum apps/web/android/app/build/outputs/apk/release/app-release-signed.apk 2>/dev/null \
  || sha256sum apps/web/android/app/build/outputs/apk/release/app-release-unsigned.apk
adb shell dumpsys package com.cosmo.ledgertrack | grep -E "versionName|versionCode|firstInstallTime"
```

Build with `./scripts/build-android.sh --apk` for the hardware run. `--apk` is
deliberately **not** Rule 20 gated (CLT-D-022), so the hardware run is not blocked by
Q1–Q4. `--aab` is the store artifact and refuses to build until `DECISIONS.md` carries
the four marker lines `Q1: Status: CONFIRMED` … `Q4: Status: CONFIRMED`; verified on
2026-11-06 that all four are currently **missing**, so an `.aab` build will exit 1 by
design — expected, not a defect. Record: commit SHA, APK SHA-256, `versionName`,
`versionCode`, and whether the APK was signed.

## 5. Protocol

Each item: perform the steps, then tick exactly one box per device slot and attach the
named evidence. "Pass" without evidence is not a pass (AGENTS.md §10, Zero-Trust rule).

### A. Install and identity

- [ ] **H1 — Installs and launches.**
  `adb install -r <apk>` then launch. Expected: no `INSTALL_FAILED_*`, app opens to the
  signed-in shell or the sign-in screen, no white screen, no console error in
  `adb logcat -d | grep -i "chromium\|capacitor"`.
  Evidence: install transcript + first-launch screenshot.

- [ ] **H2 — Cloud backup disabled.**
  `adb shell dumpsys package com.cosmo.ledgertrack | grep -i allowBackup`.
  Expected: `allowBackup=false` (financial records must not land in unencrypted cloud
  backup — Plan 019 §6.13).
  Evidence: command output.

- [ ] **H3 — Native origin reaches the API.**
  Sign in, open Ledger. In `chrome://inspect` (USB debugging) confirm `/api/v1/*`
  requests go to `PUBLIC_API_BASE`, succeed (2xx), and carry `X-Device-Id` and
  `Authorization`. Preflight `OPTIONS` returns 204 with
  `Access-Control-Allow-Origin: https://localhost`.
  Expected: no CORS error, no mixed-content block.
  Evidence: network panel screenshot, redacted of tokens.

- [ ] **H4 — Device identity survives an app-storage wipe.**
  Record the device UUID (Admin → devices, or the `X-Device-Id` header), then
  `adb shell pm clear com.cosmo.ledgertrack`, relaunch, sign in.
  Expected: same UUID restored via `@capacitor/preferences` (`initPersistentDeviceId`),
  new session registered against the existing device row — not a phantom duplicate.
  Evidence: before/after device list, header capture.

### B. Offline core loop

- [ ] **H5 — Offline entry, timed, under 20 s.**
  Airplane mode ON. Open New entry, enter PRD §6.6 fixture row 1: gross
  `5909.00`, method bKash, VAT `manual` `509.00`, txn ref `TEST-G5-0001`. Start timing
  when the entry screen is interactive; stop when the entry appears in the Ledger.
  Expected: saved with a `#LOCAL-xxxxx` ID; breakdown shows VAT ৳509.00, commission
  ৳2,268.00, bKash charge ৳67.95, net ৳3,064.05; elapsed **< 20 s**; elapsed recorded,
  not estimated.
  Evidence: two screenshots + the elapsed value in seconds.

- [ ] **H6 — No loss on kill.**
  With the entry saved offline, swipe the app out of recents (or
  `adb shell am force-stop com.cosmo.ledgertrack`), relaunch while still offline.
  Expected: entry still listed with its `#LOCAL-` ID; outbox count unchanged.
  Evidence: before/after screenshots.

- [ ] **H7 — Sync resumes on reconnect.**
  Airplane mode OFF. Wait for the sync indicator to settle.
  Expected: entry receives an `E-YYYYMM-XXXXXX` ID, amount unchanged, server totals
  match the local breakdown to the poisha; indicator returns to idle without a manual
  refresh.
  Evidence: screenshot with the real ID + the Reports/ledger totals.

- [ ] **H8 — No duplicate after a flaky reconnect.**
  Reconnect, disable data mid-push (toggle airplane mode twice within a second), let it
  settle. Expected: exactly one entry for the fixture, no rejected op left in the
  outbox for it.
  Evidence: ledger screenshot + Admin rejected-ops queue screenshot (empty).

### C. Floating menu on real hardware (Gate 5 core)

- [ ] **H9 — Default dock.**
  Clear app data, launch, sign in as Staff, stay on Dashboard.
  Expected: menu docked **24 px from the right and 24 px from the bottom** (measure from
  a screenshot at known density, not by eye).
  Evidence: annotated screenshot with pixel measurements.

- [ ] **H10 — Drag snaps to the nearest edge, clamped.**
  Drag the pill to the middle of the screen, release. Repeat toward each edge.
  Expected: springs to the nearer side edge at 24 px; never closer than **12 px** to any
  viewport edge; no clipping under the status bar or nav bar.
  Evidence: three screenshots + note if any gap is < 12 px.

- [ ] **H11 — Collision avoidance against Save.**
  On the New entry screen (where `#btn-save` exists), drag the menu directly over the
  Save button and release. Repeat on a narrow window (< 640 dp) and with the keyboard
  open.
  Expected: menu dodges to the opposite margin or vertically above/below Save;
  `#btn-save` remains fully tappable and fully visible after the dodge.
  Evidence: before/after screenshots; explicit statement that Save was tapped
  successfully while the menu was at the dodged position.

- [ ] **H12 — Haptics only on drag release.**
  With device vibration on: drag-release the menu (expect one light tick); then
  Arrow-key nudge it, then double-tap it, then tap the handle to expand.
  Expected: buzz **only** on the drag release (`onSnap.source === 'drag'`); silence on
  keyboard nudges, double-tap reset, and expand (Plan 019 §10.4).
  Evidence: written observation per action, plus `triggerHapticTick` invocation visible
  in the log if `adb logcat` shows it.

- [ ] **H13 — Double-tap resets to the dock.**
  Move the menu, double-tap it. Expected: returns to 24/24 with the spring transition.
  Evidence: screenshot after reset.

- [ ] **H14 — Position persists across restarts.**
  Move the menu, force-stop, relaunch. Expected: restored at the last position
  (`clt-floating-menu-pos`), still inside the viewport on a rotation.
  Evidence: screenshots before/after, plus one after rotating to landscape and back.

- [ ] **H15 — Keyboard operation.** *(expected to fail until CLT-T-050 lands)*
  Focus the menu region (TalkBack or hardware keyboard), press ArrowUp/Down/Left/Right,
  then Enter, then Space, then Escape.
  Expected: arrows move it 20 px per press and stay clamped; Enter and Space both expand
  the menu; Escape collapses it.
  Evidence: observation per key. A failure here is **CLT-T-050**, not a new defect.

- [ ] **H16 — Touch activation of the menu's own controls.** *(expected to fail until CLT-T-050 lands)*
  Tap "New entry" inside the menu, then tap the handle, then a nav item.
  Expected: every tap registers on the first press — no dead first tap caused by pointer
  capture retargeting.
  Evidence: one line per control, with the tap count needed.

- [ ] **H17 — Keyboard height and safe-area insets.**
  Open the entry form, focus the amount field so the IME appears; repeat on a device
  with a gesture bar and with 3-button navigation.
  Expected: content resizes (`windowSoftInputMode="adjustResize"`), Save stays
  reachable, menu never sits under the IME or the navigation bar, no content hidden
  behind the notch.
  Evidence: screenshots with IME open (both navigation modes).

- [ ] **H18 — Pinned modes for one-handed use.**
  Settings → menu position: `bottom`, `left`, `right`.
  Expected: the pill pins to the named edge, dragging does not move it (PRD §14.5
  "pins it for one-handed or assistive use"), and the setting survives a restart.
  Evidence: one screenshot per mode.

### D. Settlement reminders

- [ ] **H19 — Permission request is explicit and denial is graceful.**
  Fresh install → trigger reminder scheduling. Deny once, then grant.
  Expected: one clear Android permission prompt; denial leaves the app usable with no
  crash and no repeating prompt loop; granting proceeds to H20.
  Evidence: permission dialog screenshot + observation after denial.

- [ ] **H20 — Reminder fires with the right date, time, and amount.**
  Set a payable due day and `remind_days_before` in admin; create an unpaid settlement
  for the current month; schedule. Then set the device clock forward past the reminder
  time (or wait).
  Expected: notification at 09:00 local on `due − remind_days_before`, clamped to day 1
  when that goes negative, channel "Settlement Due Reminders", body shows the
  **outstanding** balance formatted as BDT (e.g. `৳3,064.05`), small icon renders.
  Evidence: status-bar screenshot + expanded notification screenshot + the computed date.

- [ ] **H21 — Paid settlements cancel their reminder.**
  Mark the settlement paid (or pay it fully), then inspect pending notifications
  (`adb shell dumpsys notification | grep -i cosmo`).
  Expected: that settlement's notification is cancelled; zero-liability payables never
  schedule one.
  Evidence: pending list before/after.

- [ ] **H22 — Reboot persistence.**
  Reboot the device. Expected: scheduled reminders still fire (local notifications are
  re-registered by the OS); no duplicate notifications for the same settlement.
  Evidence: post-reboot firing observation.

### E. Visual and accessibility proof in the WebView

Use `chrome://inspect` → DevTools on the device to read computed styles. Contrast is
computed from the actual rendered colours, not from the PRD's quoted ratios
(AGENTS.md §8: "re-measure before sign-off").

- [ ] **H23 — Token contrast ≥ 4.5:1, light and dark.**
  For each pair — `--muted`/`--ink` text on the page background, `--accent` on buttons,
  and the four category colours (`--c-vat`, `--c-bkash`, `--c-visa`, `--c-mastercard`)
  on their chips — read the computed colour values and compute the ratio.
  Expected: every text/background pair ≥ 4.5:1 for normal text (≥ 3:1 for large text).
  Record the **measured** ratio per pair per mode; the PRD's numbers are the author's,
  not this device's.
  Evidence: table of measured hex values and ratios, light and dark.

- [ ] **H24 — Frosted button labels stay readable (the WebView fallback).**
  Inspect a `.btn-glass` label's computed `color` and `background-image` in the device
  WebView. Expected: solid `color` applied and `-webkit-background-clip: text` either
  works or is overridden by the solid fallback — the label must never render invisible
  or as a filled block over the glass.
  Evidence: screenshot plus the computed `color` / `background-clip` values.

- [ ] **H25 — Pearl grain, glass menu, bento layout render.**
  Dashboard, Ledger, Reports at phone width. Expected: grain texture visible but
  subtle, menu glass has border + blur, radius and spacing intact, no layout overflow,
  no horizontal scroll.
  Evidence: three screenshots.

- [ ] **H26 — Dark mode.**
  System dark mode on. Expected: full dark theme, no light "flash" panels, contrast as
  measured in H23, grain not washed out.
  Evidence: the same three screens as H25 in dark mode.

- [ ] **H27 — `prefers-contrast: more`.**
  Enable Android high-contrast text (or DevTools emulation) and walk Dashboard, New
  entry, Ledger, Reports, Settlements, Reconcile, Admin. Expected: no backdrop blur,
  2 px ink borders on glass, engraved labels switch to the solid fallback, grain layer
  hidden.
  Evidence: one screenshot per view.

- [ ] **H28 — `prefers-reduced-transparency: reduce`.**
  Emulate. Expected: glass surfaces become opaque, text remains readable, nothing
  disappears.
  Evidence: screenshot.

- [ ] **H29 — `prefers-reduced-motion: reduce`.**
  Enable "Remove animations" in Developer options. Expected: no hero count-up, no
  spring snap (instant), no View Transitions, no skeleton shimmer; haptics suppressed
  by the reduced-motion check; the app is still fully operable.
  Evidence: written observation per animation, plus a screen recording if convenient.

- [ ] **H30 — Backdrop blur is bounded and scrolling stays smooth.**
  Scroll Ledger and Reports on D1 with the menu open. Expected: only the menu/sheets
  use blur; scrolling does not drop below roughly 30 fps on the low-end device (record
  what you see, do not assume 60); no jank that makes Save feel unresponsive.
  Evidence: observation + `adb shell dumpsys gfxinfo com.cosmo.ledgertrack` framestats
  summary.

### F. Performance targets on the low-end device

These are PRD targets that AGENTS.md §8 lists as unverified on real hardware. Measure
them; do not assert them.

- [ ] **H31 — Local save latency < 100 ms.** Instrument with `performance.now()` around
  the save call (as `apps/web/tests/e2e/offline_sync.spec.ts` already does) and record
  the number on D1. Expected: < 100 ms.
- [ ] **H32 — Month report < 1 s for a month of the seed dataset.** Time from navigation
  to rendered totals. Record the row count you tested with. Expected: < 1 s.
- [ ] **H33 — App cold start.** Force-stop, launch, time to interactive entry screen.
  Record the number; there is no PRD target, so record only.

### G. Hygiene checks during the run

- [ ] **H34 — No secrets in the shipped bundle or logs.**
  `grep -R "service_role\|SERVICE_ROLE_KEY\|SUPABASE_SERVICE" apps/web/build | head`
  must return nothing; `adb logcat -d | grep -iE "service_role|eyJhbGciOi"` must return
  no tokens. Expected: empty (Rule 8).
- [ ] **H35 — Cleartext traffic refused.**
  Expected: `usesCleartextTraffic="false"` in effect — an `http://` API base fails
  loudly rather than silently sending credentials in clear.
  Evidence: the failure observation, or the manifest dump.

## 6. Evidence rules

1. One file per item per device: `G5-<ID>-<slot>-<desc>.png` under
   `docs/orchestration/reports/gate5/` (create the directory when the run starts).
2. Timings come from `performance.now()` or adb, never a phone stopwatch.
3. Logs: `adb logcat -d > G5-<ID>-<slot>-logcat.txt`, then delete lines containing
   tokens or customer data before committing.
4. Fixtures only. No real customer names, no real transaction references, no receipts.
5. Passwords and keystore values are never screenshotted, pasted, or committed
   (Rule 8). Sign in from the secret manager.
6. A test that cannot be run is recorded as **BLOCKED with the reason**, not skipped
   silently.

## 7. Results

| ID | D1 | D2 | Evidence | Notes / defect ID |
|---|---|---|---|---|
| H1 | `<pass/fail/blocked>` | | | |
| H2 | | | | |
| H3 | | | | |
| H4 | | | | |
| H5 | | | | elapsed: `<s>` |
| H6 | | | | |
| H7 | | | | |
| H8 | | | | |
| H9 | | | | |
| H10 | | | | |
| H11 | | | | |
| H12 | | | | |
| H13 | | | | |
| H14 | | | | |
| H15 | | | | CLT-T-050 |
| H16 | | | | CLT-T-050 |
| H17 | | | | |
| H18 | | | | |
| H19 | | | | |
| H20 | | | | date computed: `<YYYY-MM-DD 09:00>` |
| H21 | | | | |
| H22 | | | | |
| H23 | | | | measured ratios: `<fill>` |
| H24 | | | | |
| H25 | | | | |
| H26 | | | | |
| H27 | | | | |
| H28 | | | | |
| H29 | | | | |
| H30 | | | | |
| H31 | | | | `<ms>` |
| H32 | | | | `<ms>` / `<rows>` |
| H33 | | | | `<s>` |
| H34 | | | | |
| H35 | | | | |

## 8. Verdict and sign-off

Gate 5 passes only when **every item is PASS on at least one physical device**, or an
item has an Owner decision ID recording the accepted exception. H15/H16 cannot be
excepted while CLT-T-050 is open — they are accessibility regressions, not polish.

```
Gate 5 verdict: <PASS | FAIL>
Devices covered: <D1 model, Android version>; <D2 model, Android version>
Build: commit <sha>, APK sha256 <hash>, versionName <x>
Tester: <name>, <YYYY-MM-DD>
Machine-checkable subset (§9) pasted: yes/no
Zia sign-off: <name>, <YYYY-MM-DD>          # required, per AGENTS.md §9
Rule 20 (Q1–Q4) status at sign-off: <CONFIRMED in DECISIONS.md | still PENDING>
Rule 19 deployment line: <not requested by this run>
```

Signing Gate 5 does **not** authorise a deployment or a store upload. Those need the
Rule 19 line (`ZIA-APPROVED: <release id> <environment> <date>`) and Rule 20.

## 9. Machine-checkable subset (runs without a device)

Run these before booking device time; they catch regressions that would waste it.

```bash
cd "/home/zia/Documents/My Projects/Cosmo_Ledger_Track"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22.23.4 >/dev/null

bash -n scripts/build-android.sh && test -x scripts/build-android.sh   # P6
grep -c "com.cosmo.ledgertrack" apps/web/capacitor.config.ts          # expect 1
grep -c 'allowBackup="false"' apps/web/android-config/AndroidManifest.xml  # expect 1
corepack pnpm --filter @clt/web test native.test.ts                   # native utilities
corepack pnpm test:regression                                          # 65 tests
corepack pnpm test:e2e                                                 # §16.3 E2E incl. reduced motion
corepack pnpm run test:gates --milestone M5                            # see caveat below
```

**Caveat, recorded as GS-4:** outside M2, `scripts/verify-gates.ts` evaluates Gate 5 as
"`pnpm test:e2e` exit 0". That does not test a physical device, contrast measurement,
`prefers-contrast`, `prefers-reduced-transparency`, haptics, notifications, or the
WebView `background-clip` fallback. So a green `--milestone M5` run is necessary but
**not sufficient** for Gate 5; this checklist supplies the missing proof. Until the
script is extended, the M5 gate report should state that explicitly rather than implying
Gate 5 was machine-verified.

## 10. Known blockers and divergences recorded on 2026-11-06

| ID | Item | Effect on this run | Owner |
|---|---|---|---|
| GS-1 | `ANDROID_HOME` unset and `adb` absent on the dev machine | P3/P4 cannot start; no install, no logcat, no screenshots | Zia (install Android SDK command-line tools + platform-tools) |
| GS-2 | CLT-T-050 open (menu activation: `preventDefault` on bubbled Enter/Space in `FloatingMenu.svelte`; `setPointerCapture` in `draggable.ts` retargeting clicks) | H15 and H16 will fail; a hardware tap test cannot pass before the fix | Implementer (brief exists) |
| GS-3 | Q1–Q4 unconfirmed (Rule 20): none of the `Qn: Status: CONFIRMED` marker lines exist in `DECISIONS.md` (checked 2026-11-06) | `--aab` refuses to build by design (store path only; `--apk` hardware builds are ungated); M5 sign-off needs the four confirmations | Zia (packet ready) |
| GS-4 | Gate 5 automated check is E2E-only (§9 caveat) | A green M5 gate run can be mistaken for Gate 5 proof; state the limitation in the report | Orchestrator |
| GS-5 | PRD §14.5 requires screens < 640 px to "dock cleanly into a bottom sheet bar"; `draggable.ts` only clamps and dodges (`snapToEdge`, `calculateAvoidance`) — no bottom-sheet bar exists in `apps/web/src` (grep for "bottom sheet" returns nothing) | H11 passes only if dodge-away is accepted as the intended behaviour on narrow screens; otherwise this is a spec gap needing a Decision Request | Zia decision / implementer |
| GS-6 | Performance targets (save < 100 ms, report < 1 s) unverified on low-end hardware (AGENTS.md §8) | H31/H32 measure rather than assert; results feed the §8 verdict | Tester |

## 11. What this document does not do

It does not confirm Q1–Q4, does not approve deployment, does not assert that the app
is accessible in general — it records one protocol and the results of one run. Claims
of "WCAG AA compliant" stay out of reports: state the measured ratios and the views
covered (Rule 16).
