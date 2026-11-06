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
| H3 | Native origin reaches the API | **FAIL** — see `CLT-R-012`: `/api/v1/*` resolves to the app's own asset server and returns `index.html` with HTTP 200 | `fetch('/api/v1/sync/pull…')` body began `<!doctype html>` |
| H3b | Request headers | **PARTIAL** — `Authorization` present on `/api/v1/auth/session` and `/api/v1/sync/pull`; **no `X-Device-Id` header** — the device id travels as a query parameter (`…&deviceId=943cb758-…`) | CDP `Network.requestWillBeSent` capture (header names only; token value never recorded) |
| H9 | Default dock | **PASS** — measured `gapRight 24.1 px`, `gapBottom 24.5 px` on a 411×816 viewport | `evidence/gate5/h09-dock-dashboard.png` |
| H10 | Drag snaps to nearest edge | **FAIL on touch** — see `CLT-R-013`; the same drag with a **mouse** moved the menu (`top 728 → 702.8`) and wrote `clt-floating-menu-pos`, proving the drag code itself works | `evidence/gate5/h10-touch-drag-no-move.png` |
| H11 | Collision avoidance against Save | **PARTIAL** — on `/entries/new` the menu sits at `top 728…791.5` while `#btn-save` occupies `410…457.6`: **zero vertical overlap**, and `elementFromPoint` at Save's centre returns `BUTTON#btn-save` | `evidence/gate5/h11-before-drag.png`, `h11-after-dodge.png` |
| H16 | Touch activation of the menu's own controls | **PASS** — a single real touch on the menu's "New Entry" link moved `/dashboard` → `/entries/new`; the first press registers (the CLT-T-050 defect is gone on hardware) | `evidence/gate5/h16-new-entry-first-tap.png` |
| — | Fonts render as specified | **FAIL** — see `CLT-R-014` | console: `Failed to decode downloaded font … OTS parsing error`; `document.fonts` → `Geist:error`, `Noto Sans Bengali:error` |
| H4 | Device id survives `pm clear` | **Not run** — blocked behind `CLT-R-012` (cannot reach the devices API meaningfully) |
| H5–H8 | Offline entry, kill, sync, duplicate | **Blocked** — see `CLT-R-012`: no payment method can be selected, so the live breakdown stays `৳0.00` and `#btn-save` stays disabled (`disabled={… \|\| !selectedMethodId \|\| …}`) | `evidence/gate5/h05-offline-save.png` |
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
