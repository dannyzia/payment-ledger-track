# Gate 5 — Physical Device Run Report

Run date: 2026-11-06. Device supplied by Zia, who authorised the run in chat
("pixel 6a (usb debugging on) is attatched to the machine. run whatever test u
need to run"). Executed by the coding agent; **not signed off** — §7 of
`GATE5_PHYSICAL_DEVICE_CHECKLIST.md` and Zia's signature are still required.

This run covers the parts of the checklist that could be exercised. It does
**not** clear Gate 5: three blocker/Major defects were found (§4), and several
items could not be reached because of them (§5).

## 1. Build identity

| Item | Value |
|---|---|
| Commit | `7d369f3cd22e4388ddbf5089e399dcc63f367bcd` |
| APK | `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`, 4,158,147 bytes |
| APK SHA-256 | `2b82b7ca45b20cfda3a7d63c9765e72b8c52aa83fa7454b1ddcd23dd502528c8` |
| Version | `versionName 1.0`, `versionCode 1`, `minSdk 22`, `targetSdk 34` — **debug build, unsigned**, so H-protocol item "whether the APK was signed" = no |
| Built with | `cap add android` → template manifest (`android-config/AndroidManifest.xml`) → `cap sync` → `./gradlew assembleDebug` under JDK 17 (Gradle 8.2.1 predates JDK 21) |
| Android SDK | `$HOME/android-sdk` (platforms 33/34, build-tools 30.0.3/33.0.1/34.0.0); `ANDROID_HOME` and `adb` are **not** on the normal PATH — GS-1 is bypassed per-run, not fixed |

## 2. Device

| Field | Value |
|---|---|
| Model | Pixel 6a (`bluejay`), serial `24261JEGR10296` |
| Android | 17 (`ro.build.version.release` 17, SDK 37) |
| WebView | `com.google.android.webview 156.0.8078.47` |
| Screen | 1080×2400 physical, 420 dpi → **411×816 CSS px, dpr 2.625** |
| WebView window offset | 132 device px from the top (status bar) — relevant when mapping screen coordinates to CSS |

### Harness

The packaged APK embeds its own assets, so airplane mode would not have hidden
the API: `adb reverse tcp:5174` (SvelteKit dev server) and `tcp:54321` (local
Supabase) keep working over USB even in airplane mode. Offline behaviour was
therefore simulated by **removing the reverse tunnels**, which is the closer
analogue of "no network".

The WebView was driven through Chrome DevTools Protocol
(`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`) so that
taps, drags and key presses were dispatched as real input events and geometry
was measured from `getBoundingClientRect()` instead of eyeballed.

## 3. Results

| # | Item | Result | Evidence |
|---|---|---|---|
| H1 | Installs and launches | **PASS** — `adb install -r` → `Success`; `am start -W` → `TotalTime: 996`; sign-in shell rendered, no white screen | `evidence/gate5/h01-first-launch.png` |
| H2 | Cloud backup disabled | **PASS** — `dumpsys package … \| grep -i allowBackup` → no `ALLOW_BACKUP`; `flags=0x0` | command output, §3 note |
| H3 | Native origin reaches the API | **FAIL in this pass** — see `CLT-R-012`: `/api/v1/*` resolved to the app's own asset server and returned `index.html` with HTTP 200. Fixed and re-run in §8: now PASS | `fetch('/api/v1/sync/pull…')` body began `<!doctype html>` |
| H3b | Request headers | **PARTIAL** — `Authorization` present on `/api/v1/auth/session` and `/api/v1/sync/pull`; **no `X-Device-Id` header** — the device id travels as a query parameter (`…&deviceId=943cb758-…`) | CDP `Network.requestWillBeSent` capture (header names only; token value never recorded) |
| H9 | Default dock | **PASS** — measured `gapRight 24.1 px`, `gapBottom 24.5 px` on a 411×816 viewport | `evidence/gate5/h09-dock-dashboard.png` |
| H10 | Drag snaps to nearest edge | **FAIL on touch** — see `CLT-R-013`; the same drag with a **mouse** moved the menu (`top 728 → 702.8`) and wrote `clt-floating-menu-pos`, proving the drag code itself works | `evidence/gate5/h10-touch-drag-no-move.png` |
| H11 | Collision avoidance against Save | **PARTIAL** — on `/entries/new` the menu sits at `top 728…791.5` while `#btn-save` occupies `410…457.6`: **zero vertical overlap**, and `elementFromPoint` at Save's centre returns `BUTTON#btn-save` | `evidence/gate5/h11-before-drag.png`, `h11-after-dodge.png` |
| H16 | Touch activation of the menu's own controls | **PASS** — a single real touch on the menu's "New Entry" link moved `/dashboard` → `/entries/new`; the first press registers (the CLT-T-050 defect is gone on hardware) | `evidence/gate5/h16-new-entry-first-tap.png` |
| — | Fonts render as specified | **FAIL** — see `CLT-R-014` | console: `Failed to decode downloaded font … OTS parsing error`; `document.fonts` → `Geist:error`, `Noto Sans Bengali:error` |
| H4 | Device id survives `pm clear` | **FAIL in §8** — a fresh UUID is issued after `pm clear`; the restore path only survives a web-storage wipe (`CLT-R-017`) |
| H5–H8 | Offline entry, kill, sync, duplicate | **Blocked in this pass** (`CLT-R-012`): no payment method could be selected, so the breakdown stayed `৳0.00` and `#btn-save` stayed disabled. All four re-run in §8 and PASS | `evidence/gate5/h05-offline-save.png` |
| H12 | Haptics only on drag release | **Not reachable** — requires a touch drag (H10) |
| H13 | Double-tap resets to dock | **Not reachable** — the reset path runs only after a drag |
| H14 | Position persists across restarts | **Not reachable** — no touch position can be created; mouse drag did persist a position, but that is not the hardware path |

## 4. Defects found

Severity per AGENTS.md §6. None is fixed in this commit; each needs a task.

### CLT-R-012 — **Blocker** — no `PUBLIC_*` env reaches the bundle, so the native app cannot reach its backend

`apps/web/vite.config.ts` sets `envDir: '../../'` but **no `envPrefix`**, so
Vite exposes only `VITE_*` through `import.meta.env`. The app reads
`import.meta.env.PUBLIC_API_BASE` and `PUBLIC_SUPABASE_URL`
(`src/hooks.client.ts`, `src/lib/api.ts`, `src/lib/supabase/client.ts`), which
are therefore always `undefined` at build time.

Measured:

- `grep -rl "127.0.0.1:5174" apps/web/build/_app/immutable` → **nothing**;
  `PUBLIC_API_BASE` appears nowhere in `build/`.
- The only Supabase URL in the bundle is the hardcoded fallback
  `http://localhost:54321` — the `.env.local` value `http://127.0.0.1:54321`
  never arrives.
- On the device, `fetch('/api/v1/sync/pull?…')` returned **HTTP 200 with
  `<!doctype html>`** — Capacitor's local asset server answering, not the API.

Consequences on hardware: `hooks.client.ts` never rewrites `/api/v1/*` (its
guard is `rawBase && Capacitor.isNativePlatform()`), the sync banner shows
"Sync error (tap to retry)" permanently (the HTML cannot be parsed as a sync
page), `payment_methods` never hydrate, no method chip renders (`0` nodes
matching bKash/Cash/Visa; `0` `select`/`[role=combobox]`), and `#btn-save` is
disabled — **a staff user cannot record a single entry on the device**.

Sign-in itself succeeded only by accident: Supabase fell back to
`http://localhost:54321`, which the adb reverse tunnel pointed at the host. In a
real deployment that fallback points at the phone.

Likely fix (not applied): add `envPrefix: ['PUBLIC_', 'VITE_']` to the Vite
config and rebuild; or migrate the client to `$env/static/public`. Either way
`scripts/build-android.sh`'s mandatory `PUBLIC_API_BASE` currently has no
effect, so Plan 019's packaging path is not proven.

### CLT-R-013 — **Major** — the floating menu cannot be dragged by touch

On the dashboard the pill is 206×64 px. Its hit map (`elementFromPoint`, 2 px
rows, 4 px columns) is neutral only in rows **0–8** and **56–62** — a ~9 px and a
~7 px strip; rows 10–54 belong to the "New Entry" anchor and the toggle button.

A `pointerdown` inside that 9 px strip is nevertheless delivered to the
anchor (`pointerdown@A`, `interactive: true`, `button: 0`, `pointerType:
"touch"`), i.e. the browser's touch-target adjustment promotes the press to the
nearby link, so `draggable`'s `isInteractiveTarget()` guard correctly refuses
the drag. The identical drag with a **mouse** at the identical coordinates
moves the menu and stores `{"x":181,"y":702.83}`.

Effect: H10, H12, H13 and H14 cannot pass on hardware, and the M5 sentence
"floating menu behaves on real hardware with docking" is not met — the menu is
pinned at its default dock. Fix direction: a real grab affordance (a ≥44 px
handle, or non-interactive padding band ≥16 px plus `touch-action: none` on it)
rather than relying on a 9 px strip.

### CLT-R-014 — **Major** — the self-hosted fonts are 31-byte stubs

`apps/web/static/fonts/{Geist-Regular,GeistMono-Regular,NotoSansBengali-Regular}.woff2`
are 31 bytes each — a bare `wOF2` header with an empty glyph table, referenced by
`src/app.css`. On device every load fails:

```
Failed to decode downloaded font: https://localhost/fonts/Geist-Regular.woff2
OTS parsing error: Size of decompressed WOFF 2.0 is less than compressed size
```

and `[...document.fonts]` reports `Geist:error`, `Noto Sans Bengali:error`
(`Geist Mono` stays `unloaded` until a mono element appears). PRD §14 requires
Geist + Geist Mono **tabular figures** + Noto Sans Bengali; every money column
in this build is rendered in a system font, so the tabular-figure requirement
has never been met on any platform. This is silent — no test covers it.

## 5. Not verified in this run

- H4 (device id after `pm clear`), H5–H8 (offline entry, kill, reconnect,
  duplicate), H12–H14: blocked by `CLT-R-012` / `CLT-R-013`.
- Contrast measurements: body text measured **16.6:1** against
  `rgb(246,245,241)`, comfortably AA. The placeholder colour is declared as
  `oklab(… / 0.5)`; the pixel sampling attempt did not land on the field (it was
  below the fold), so **placeholder contrast is unmeasured** and must not be
  quoted as passing or failing.
- Haptics, status-bar notifications, keyboard avoidance with the keyboard open,
  `prefers-contrast: more`, `prefers-reduced-transparency`, rotation.
- No `ZIA-APPROVED:` release line exists and none was requested (Rule 19); the
  APK is a debug artefact for hardware testing only (CLT-D-022).

## 6. Environment state after the run

- Temporary test-only edit `server.cleartext: true` in
  `apps/web/capacitor.config.ts` was **reverted**; the file is unchanged
  (`git diff` empty).
- The generated native project `apps/web/android/` (31 MB) is **untracked and
  not gitignored** — the build script regenerates it with `cap add android` when
  absent, so decide whether it belongs in the repo.
- `ANDROID_HOME` remains unset in the environment; this run exported
  `$HOME/android-sdk` per command. GS-1 in the checklist is still accurately
  described as a blocker for anyone repeating the run without that export.
- Local stack used: SvelteKit dev server on `127.0.0.1:5174` (5173 is occupied
  by an unrelated service), local Supabase on 54321/54322.

## 7. Evidence index

| File | Shows |
|---|---|
| `evidence/gate5/h01-first-launch.png` | First launch on device, sign-in shell |
| `evidence/gate5/h05-offline-save.png` | Entry form on device with the live breakdown at `৳0.00` and Save disabled |
| `evidence/gate5/h09-dock-dashboard.png` | Menu docked bottom-right on the dashboard |
| `evidence/gate5/h10-touch-drag-no-move.png` | Menu after a touch drag: unchanged dock |
| `evidence/gate5/h11-before-drag.png` | Entry screen, menu and Save positions before the collision test |
| `evidence/gate5/h11-after-dodge.png` | After the drag attempt: Save fully exposed, menu clear of it |
| `evidence/gate5/h16-new-entry-first-tap.png` | `/entries/new` reached from one real touch on the menu link |

No screenshot in this directory contains credentials: two captures of the
sign-in form with typed text were deleted during the run, before this commit.

---

# Second pass — after the CLT-R-012 fix

Run date: 2026-11-06 (same session, same device, same Zia authorisation).

**The fix under test** (`fix(web): expose PUBLIC_ env to the client bundle`):
`apps/web/vite.config.ts` now sets `envPrefix: ['PUBLIC_', 'VITE_']`. Before the
fix the built bundle contained no `PUBLIC_API_BASE` at all and only the
hardcoded `http://localhost:54321` fallback; after it, `127.0.0.1:5174` and the
real `PUBLIC_SUPABASE_URL` are both present in `build/_app/immutable`.

| Item | Value |
|---|---|
| APK | rebuilt debug APK, 4,188,833 bytes, SHA-256 `3e23b8d1d5ae5a5dd5459505903bb7d647fea6595fbb6fec3e761965003f50de` |
| Build | `CAPACITOR_BUILD=true PUBLIC_API_BASE=http://127.0.0.1:5174 pnpm build` → `cap sync android` → `./gradlew assembleDebug` (JDK 17, `ANDROID_HOME=$HOME/android-sdk`) → `BUILD SUCCESSFUL` |
| Secret check | the only JWT in the client bundle is the **public anon key** (SHA-256 prefix matches `PUBLIC_SUPABASE_ANON_KEY`); `SERVICE_ROLE` appears nowhere and the service-role key's digest does not match anything in the bundle (Rule 8 holds) |

## 8. Results

| # | Item | Result | Evidence |
|---|---|---|---|
| H3 | Native origin reaches the API | **PASS** — every sync cycle now hits the real server: `GET /api/v1/sync/pull?since=82&includeMeta=true&deviceId=6c6300a0-…` → `http://127.0.0.1:5174/api/v1/sync/pull…`, **200 `application/json`** (rewritten by `hooks.client.ts`). All five payment methods hydrate from the pull | instrumented `window.fetch`, §8 run log |
| H5 | Offline entry, timed | **PASS** — reverse tunnels removed (true offline from the app's point of view), fixture entered, real touch on Save → `Saved offline as #LOCAL-b1c6c9` in **92 ms** with `Offline (1 pending)`. The PRD §6.6 row-1 fixture was then entered exactly with `VAT manual 509.00` and saved in **42 ms** | in-page breakdown text and the H7a server query (§8); no screenshot of this form was captured |
| H5a | Breakdown arithmetic on device | **PASS** — `৳5,909.00` gross → VAT `৳509.00`, commission `৳2,268.00` (42.00%), bKash `৳67.95` (1.15%), net `৳3,064.05`; poisha `590900 − 50900 − 226800 − 6795 = 306405` | screenshot + §6 query |
| H6 | No loss on kill | **PASS** — `am force-stop`, relaunch while still offline: entry still listed as `#LOCAL-b1c6c9`, `৳5,909.00`, `Net: ৳3,359.27` | `evidence/gate5/h06-persisted-offline.png` |
| H7 | Sync resumes on reconnect | **PASS** — tunnels restored, indicator settled to `Synced`; entry became `E-202611-000051`; server row: gross `590900`, commission `248178`, charge `6795`, net `335927` — identical to the local breakdown | `evidence/gate5/h07-synced-after-reconnect.png` |
| H7a | Fixture row on the server | **PASS** — `E-202611-000053` stores gross `590900`, VAT `50900`, commission `226800`, charge `6795`, net `306405`, matching PRD §6.6 row 1 to the poisha | `evidence/gate5/h07-fixture-synced-ledger.png`; `select … where customer_name like 'TEST-G5-%'` |
| H8 | No duplicate after a flaky reconnect | **PASS** — second offline entry `#LOCAL-9431bd` (`৳1,234.00`, Cash), tunnel cut immediately after pressing retry (push in flight), restored: exactly one server row per fixture (`3` `TEST-G5-*` rows for `3` saves), no `#LOCAL` left in the ledger, no rejected op; `E-202611-000052` = `123400 / 51828 / 0 / 71572` | §6 query, `h07-synced-after-reconnect.png` |
| H4 | Device id survives `pm clear` | **FAIL** — see `CLT-R-017` | `643cb758…` before, `6c6300a0-bd57-4633-a1dd-332e614680cf` after |
| H10, H12–H14 | Drag, haptics, reset, persistence | **Still FAIL / not reachable** — `CLT-R-013` is untouched by this change | first-pass evidence |

Backend cross-check (all three fixtures, poisha):

```
 entry_number | customer_name | gross  | vat   | commission | charge | net
            51 | TEST-G5-Ayash | 590900 |     0 |     248178 |   6795 | 335927
            52 | TEST-G5-FLAKY | 123400 |     0 |      51828 |      0 |  71572
            53 | TEST-G5-VAT   | 590900 | 50900 |     226800 |   6795 | 306405
```

## 9. Findings from the second pass

- **`CLT-R-012` — RESOLVED** by the `envPrefix` fix, re-proved by H3, H5–H8 above.
- **`CLT-R-015` (Major, new): the app shell can be "signed in" with no Supabase
  session, and sync then fails silently as a generic error.** Observed when the
  Supabase URL host changed (session storage key `sb-localhost-auth-token` vs
  `sb-127-auth-token`): `/dashboard` rendered fully with a working Sign Out
  button, `/login` redirected back to `/dashboard`, yet
  `supabase.auth.getSession()` returned null, so `flushOutboxPush()` returned
  `{success:false}` **before issuing any request** and the indicator sat on
  "Sync error (tap to retry)" with a badge showing zero data. The same dead end
  is reachable on any lost or unrefreshable session. Expected instead: redirect
  to `/login` (or a distinct "signed out" state), never a silent error.
- **`CLT-R-016` (Minor, new): offline relaunch is labelled "Sync error".** With
  the server unreachable but `navigator.onLine === true` (the normal case for a
  dropped link, and for this harness), the first cycle fails inside the fetch
  and lands in `error`, so the shell shows "Sync error (tap to retry)" instead of
  "Offline (N pending)". Data is safe (H6 passed); only the wording is wrong,
  and it contradicts the offline state the same app shows while saving.
- **`CLT-R-017` (Major, new): H4's expectation is unachievable as specified.**
  `initPersistentDeviceId()` restores the UUID from `@capacitor/preferences`,
  which on Android is SharedPreferences — wiped by `pm clear` along with the
  WebView store. Measured: `943cb758-…` before, `6c6300a0-bd57-4633-a1dd-332e614680cf`
  after `pm clear`. The mechanism does work for the narrower reset it can
  handle: deleting only `clt_device_id` from `localStorage` and reloading
  restored `6c6300a0-…` from Preferences. Either the check is reworded to "web
  storage wipe", or the id must be derived from a hardware identifier such as
  `ANDROID_ID` — a privacy decision for Zia, not an implementation detail.
- Note (not a defect claim): the first H5 attempt recorded VAT `0.00` because
  the fixture's manual VAT had not been typed. The `#input-vat` field only
  renders when the active profile's `vat_mode` is `manual`, which it is; the
  exact-fixture entry (§8, H5a/H7a) is the authoritative money-path result.

## 10. State after the second pass

- Temporary `server.cleartext: true` edit reverted again; `git diff` shows only
  the `vite.config.ts` fix.
- Test data left in the local Supabase: entries 51–53 (`TEST-G5-*`). They are
  local-development rows only, never deployed.
- `apps/web/android/` remains untracked and un-gitignored (31 MB, regenerable).
- H10/H12–H14 were still failed by `CLT-R-013` at the end of this pass.

---

# Third pass — the floating menu drag (CLT-R-013)

Run date: 2026-11-06. Same Pixel 6a (`24261JEGR10296`), same authorisation.

- APK: debug, 4,203,110 bytes, SHA-256
  `22c11df69028e5a26a73b1cf1a7a923553c4293f187ff6e4b2b53cd497f0ed00`.
- Build: `CAPACITOR_BUILD=true PUBLIC_API_BASE=http://127.0.0.1:5174 pnpm build` →
  `npx cap sync android` → `./gradlew assembleDebug` → `BUILD SUCCESSFUL` →
  `adb install -r` → `Success`.
- Server reachable through `adb reverse tcp:5174 tcp:5174` (H3 path still works).

## 11. What changed

1. **`apps/web/src/lib/ui/actions/draggable.ts` — the press origin no longer
   decides.** Android's touch-target adjustment retargets a press on the pill's
   narrow neutral strip to the nearest `<a>` or `<button>`, so the old rule
   ("only a non-interactive origin may drag") made the pill undraggable by
   finger. Now a press on a control is tracked too: movement past the 6 px
   threshold is a drag, and the one click belonging to that release is swallowed
   in the capture phase (`preventDefault` + `stopPropagation`). A press that
   does not move is left completely alone, so taps, navigation and onclick all
   behave exactly as before (the CLT-T-050 regression guard). Pointer capture is
   still never taken on press over a control — only at the moment the gesture
   becomes a drag — and double-tap-to-reset still only listens on the pill's own
   surface.
2. **`apps/web/src/lib/ui/FloatingMenu.svelte` — the missing handle.** PRD §14.5
   says the collapsed pill shows "the primary action plus a handle". It was
   absent, so the only neutral surface was an 8 px padding band. The pill now has
   a 44×44 non-interactive grip (`data-drag-handle`, `touch-action: none`) on
   its leading edge.
3. **`draggable.ts` — a measurement guard (defect found by H14, `CLT-R-018`).**
   Above the `md` breakpoint the pill is `display:none` and measures 0×0; the
   resize/dock path clamped the live position with fallback dimensions, so one
   trip through landscape wrote a bogus position that survived the trip back.
   `isMeasurable()` now short-circuits both paths until the pill has a real box.

## 12. Results

| # | Item | Result | Measured evidence |
|---|---|---|---|
| H10 | Drag snaps, clamped, never under 12 px | **PASS** | drag from the top strip `(159,622)`: the pointerdown was retargeted to the grip (`tag: SPAN`, `interactive: false`) and the pill moved, releasing to `x=129` = **24.1 px** from the right edge · drag beyond the top-left corner `(-100,-40)`: settled at `(24, 12)` = **24 px** left, **12 px** top clamp · drag that *started on the New Entry label* (`interactive: true`): still a drag, `y 375 → 115`, and the URL stayed `/dashboard` (no accidental navigation) |
| H12 | Haptics only on drag release | **PASS** | `dumpsys vibrator_manager`, history filtered to `com.cosmo.ledgertrack`: **one** entry after the drag release — `usage: TOUCH`, `played: [Step=0ms(amplitude=0.00), Step=50ms(amplitude=0.43)]` at `22:29:30.671` — and **no new entry** after the ArrowUp nudge (y `198 → 178`), after the ☰ tap (`aria-expanded` became `true`), or after the double-tap reset (count stayed `3`) |
| H13 | Double-tap resets to the dock | **PASS** | `(129,178)` → double-tap → `(129,728)`, `transform: translate3d(129px, 728px, 0)`; storage rewritten to `{"x":129,"y":728}`; no vibration |
| H14 | Position persists across restarts and rotation | **PASS after `CLT-R-018`** | drag to `(129,618)` → `am force-stop` → relaunch → restored at exactly `(129,618)` from `clt-floating-menu-pos` · landscape (`816×383`): pill `display: none` by design (`md:hidden`), live transform untouched at `translate3d(129px, 396px, 0)` · back to portrait (`411×816`): **still 396** (before the guard this read 323 for a 618 start, a silent 295 px jump) |
| H16 | Touch activation of the menu's own controls (regression) | **PASS, still** | plain tap on New Entry → `/entries/new`; tap ☰ → `aria-expanded="true"` and `#mobile-nav-panel` present — first press, no dead tap |

Evidence: `evidence/gate5/h10-drag-from-strip.png`,
`h10-drag-starting-on-link.png`, `h10-left-top-clamp.png`,
`h13-double-tap-reset.png`, `h14-before-restart.png`,
`h14-after-restart.png`, `h14-landscape-clamped.png`,
`h14-portrait-restored.png`.

### Device settings this pass touched

The phone had `animator_duration_scale = 0` and `transition_animation_scale = 0`,
which makes the WebView report `prefers-reduced-motion: reduce` — and
`triggerHapticTick()` correctly returns early under reduced motion, so the first
H12 attempt measured nothing (and would have been reported as a false failure).
Both were set to `1` (plus `window_animation_scale = 1`) for the check and the
WebView needed a **fresh process** to re-read them: after `force-stop` +
relaunch, `matchMedia('(prefers-reduced-motion: reduce)').matches` went
`true → false`. The two measured values were restored to `0` afterwards, with
`window_animation_scale` left at `1` (its value was not recorded before the
change). Rotation was driven with `settings put system user_rotation` and
`accelerometer_rotation` was returned to `1`.

H11 (Save-button avoidance) was not re-run in this pass: it is a separate item
and its geometry was untouched by these edits. H15 stays failed (it is
`CLT-T-050`, keyboard only).

## 13. Verification run with this change

| Check | Result |
|---|---|
| `svelte-check --threshold error` | `COMPLETED 652 FILES 0 ERRORS 0 WARNINGS` |
| `apps/web` vitest | `207 passed`, 2 failed in `tests/reports/view_parity.test.ts` (`expected undefined to be defined`). **Pre-existing:** re-ran that file with this change stashed at HEAD — same two failures, same message |
| root `pnpm test` | `43 passed | 63 skipped`; 3 DB suites (`schema`, `entries_sync`, `settlement_recon`) fail during seeding with `duplicate key value violates unique constraint "one_owner"` because the local database already holds the bootstrapped Owner. **Pre-existing:** `tests/db/schema.test.ts` fails identically with the change stashed at HEAD |
| Device | H10, H12, H13, H14 above, plus H16 and the H3 tunnel path re-checked |

Not run: the full PRD §16.2 65-test regression suite and `pnpm test:e2e`.

## 14. State after the third pass

- Gate 5 items still open: H4 (`CLT-R-017`), H11 (not re-run), H15 (`CLT-T-050`),
  and everything after H16 in this report's scope.
- `apps/web/android/` remains untracked (regenerable).
- The device is left signed in with the menu docked at 24/24.

