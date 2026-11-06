# CLT-T-050 — Task Report

```
=== TASK REPORT ===
TASK ID:         CLT-T-050
AGENT ID:        A-IMPL-1 (Implementer)
STATUS:          DONE
SUMMARY:         The floating menu's keyboard and pointer activation defects are fixed and
                 proved with real input. Root cause of the pointer defect was not only
                 pointer capture: the dock was computed from pre-layout fallback sizes
                 (140x48) and settled 45px past the right edge, so real taps landed on the
                 region's padding. The offline E2E's dispatchEvent workarounds are gone.
FILES CHANGED:   apps/web/src/lib/ui/FloatingMenu.svelte — modify — region handler yields
                   Enter/Space that bubble from the anchor and the toggle button.
                 apps/web/src/lib/ui/actions/draggable.ts — modify — ignore presses that
                   start on a control, drop stale drag origins, capture on the neutral
                   press only, settle the dock once real layout exists.
                 apps/web/tests/e2e/floating_menu.spec.ts — create — 8 cases with real
                   clicks, focus + Enter/Space, drag, and double-tap reset.
                 apps/web/tests/e2e/offline_sync.spec.ts — modify — real clicks replace
                   both dispatchEvent('click') workarounds.
COMMANDS RUN:    see "Evidence" below. Raw logs are on the dev machine at
                 docs/orchestration/reports/CLT-T-050-e2e.log and
                 docs/orchestration/reports/CLT-T-050-defect-reproduction.log;
                 the repo's .gitignore excludes *.log, so they are not committed.
                 Every result cited here is quoted inline instead.
ACCEPTANCE:      A1 PASS | A2 PASS | A3 PASS | A4 PASS | A5 PASS (evidence below)
DEVIATIONS:      1. Added a dock-settle fix (see below) that the brief did not name:
                    without it R5/R6 cannot pass, because the menu itself moves out from
                    under the pointer.
                 2. Pointer capture moved from "first move past threshold" to "the press
                    itself", on the neutral surface only. R3 still holds: a press that
                    starts on a control captures nothing and starts no drag.
                 3. Added a stale-origin guard (`hasOrigin`), without which a press on a
                    control followed by movement could still start a phantom drag.
                 4. E2E locators corrected to real accessible names ("Toggle navigation
                    menu") and scoped to #floating-action-menu: the previous `.first()`
                    resolved to hidden desktop-sidebar links, which only worked because
                    dispatchEvent ignores visibility.
                 5. No CLT-D entry written: DECISIONS.md is outside this brief's SCOPE.
                    A deviation record is recommended (see OPEN ISSUES).
ASSUMPTIONS:     1. The 24px bottom-right dock is the intended default per PRD §14.5; the
                    fix only makes the measured size match the real one.
                 2. ResizeObserver and requestAnimationFrame exist in target browsers and
                    jsdom-run tests; both are feature-guarded.
OPEN ISSUES:     1. Rule 13 record missing: recommend CLT-D-026 "FloatingMenu dock settles
                    after first layout; pointer capture begins at the neutral press"
                    (orchestrator to author; kept out of this commit under SCOPE).
                 2. Gate 5 checklist items H15/H16 are no longer expected-fail; they still
                    need the physical-device run (GATE5_PHYSICAL_DEVICE_CHECKLIST.md).
                 3. GS-5 (PRD §14.5 bottom-sheet bar under 640px) is untouched and still
                    unresolved — separate decision, not part of this task.
QUESTIONS:       none
=== END REPORT ===
```

## What was actually wrong

Reproduction on the current tree (`CLT-T-050-defect-reproduction.log`): a real Playwright
click on the New Entry link retried for the full 120 s timeout with
`div#floating-action-menu intercepts pointer events`, and event tracing showed every
`pointerdown`/`click` in the sequence targeted the region, with the anchor's live rect
(681–725) sitting 31 px below and 69 px right of the rect measured moments earlier.

Two independent causes:

1. **Keyboard.** `handleKeydown` on the region `preventDefault()`ed every Enter/Space that
   bubbled from a descendant, cancelling the anchor's navigation and the toggle button's
   own `onclick`.
2. **Pointer/dock.** `loadInitialPosition()` ran before the pill had its final size and
   fell back to `140x48`, so the dock was `x = 393 − 121 − 24 = 248` while the real pill is
   190 px wide: the menu hung 45 px off the right edge, and `y` left it 7 px past the
   bottom. The pointer landed on the region's padding, not on the control. A second
   defect sat behind it: `setPointerCapture` only ran on the first move past the 6 px
   threshold, so a fast mouse drag left the pill before any move event arrived and the
   drag never started (touch input hides this via implicit capture).

## Evidence

**A1 — anchor is keyboard-activatable**

```
✓  b: focusing New Entry and pressing Enter navigates to /entries/new (1.3s)
```
The assertion is `pathname === '/entries/new'` after `waitForURL('**/entries/new')`.

**A2 — anchor is pointer-activatable without dispatchEvent**

```
✓  a: a real click on New Entry navigates to /entries/new (10.6s)
✓  E2E Local-First Offline Save, Latency, and Reconnect Sync (4.2s)
```
No `intercepts pointer events` line appears anywhere in `CLT-T-050-e2e.log`; the same run
that reproduced it in 120 s now completes the click in one attempt.

**A3 — toggle fires exactly once, by click and by keyboard**

```
✓  c: a real click on the toggle expands the panel exactly once (1.8s)
✓  d: Enter on the focused toggle expands, then collapses (1.3s)
✓  e: Space on the focused toggle toggles, and Escape collapses (1.6s)
```
`aria-expanded` asserted `true` → `false` per activation, `#mobile-nav-panel` count 0 → 1 → 0.

**A4 — drag behaviour unchanged**

```
✓  src/lib/ui/draggable.test.ts (5 tests) 23ms
      Tests  209 passed (209)   Test Files  17 passed (17)
✓  f: the pill still drags from its neutral area and snaps to an edge (2.2s)
✓  g: pressing on New Entry does not start a drag (1.6s)
✓  h: double-tapping the neutral area resets the docked position (2.3s)
```
`f` asserts >20 px of movement plus the 12 px clamp; `h` asserts the reset returns within
3 px of the docked box; `g` asserts <2 px movement when the press starts on the anchor.
The Plan 019 §10.4 haptic contract is untouched: `notifySnap('drag')` still fires only from
`onPointerUp` after a real drag, and no `native/` file was opened.

**A5 — type and lint clean**

```
svelte-check found 0 errors and 0 warnings
✖ 31 problems (0 errors, 31 warnings)      # all no-console, the existing baseline
typecheck: svelte-check found 0 errors and 0 warnings
```

**Full E2E run**

```
9 passed (34.4s)
```

## Behaviour now

- Pressing Enter on the focused New Entry link navigates; the region no longer intercepts it.
- Enter/Space on the focused ☰ runs the button's own handler exactly once.
- Enter/Space on the region itself (focused, not a child) still toggles; Escape still collapses.
- Pressing on a control never starts a drag and never captures the pointer.
- Dragging from the pill's padding still snaps, still clamps to 12 px, still haptics, still
  persists; a fast drag no longer dies when the pointer leaves the pill.
- The pill re-docks once its real size is known, and clamps (never re-docks) after the user
  has placed it — the earlier off-screen dock is gone.
- Double-tap on the neutral area still resets the position.

## Not done, deliberately

- `playwright.config.ts`, routes, the i18n catalog, `native/`, and everything under
  `packages/`, `supabase/`, `scripts/` and `docs/` (other than this report and its logs)
  were not touched.
- No retries, skips, `force: true`, or `dispatchEvent` fallbacks were introduced; the
  offline spec's two workarounds were removed.
