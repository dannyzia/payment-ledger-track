# CLT-T-050 — Fix FloatingMenu keyboard and pointer activation of its children

Scheduled: 2026-11-06. Origin: Plan 020 discovery (CLT-D-024 item 7); carried
into this brief unchanged because Plan 020 must not touch production code.

Belongs to: **Plan 007** (`docs/plans/007_design_system_and_ui_kit.md`, owns
`FloatingMenu.svelte` and `actions/draggable.ts`). Cross-reference:
**Plan 019** §10.4 owns the `onSnap` `source` contract the fix must preserve.

---

=== TASK BRIEF ===
TASK ID:         CLT-T-050
TITLE:           Fix FloatingMenu keyboard and pointer activation of children
ASSIGNED TO:     A-IMPL-1 (Implementer)
PRIORITY:        P1
DEPENDS ON:      none
PROJECT:         Cosmo Ledger Track | ROOT: /home/zia/Documents/My Projects/Cosmo_Ledger_Track | CONTEXT FILE: AGENTS.md
SOURCE OF TRUTH: apps/web/src/lib/ui/FloatingMenu.svelte (current), apps/web/src/lib/ui/actions/draggable.ts (current), docs/plans/007_design_system_and_ui_kit.md §6.9, docs/plans/019_capacitor_android_release.md §10.4, DECISIONS.md CLT-D-024 item 7, CLT-D-025
OS / SHELL:      Ubuntu 24.04 / bash (nvm use 22.23.4, corepack pnpm)

You are A-IMPL-1, role Implementer, working on the project "Cosmo Ledger Track" at /home/zia/Documents/My Projects/Cosmo_Ledger_Track.
You have no memory of earlier work. Everything you need is in this brief and the files it lists.
1. Read the project context file (AGENTS.md) before anything else. Its hard rules
   override this brief. If they conflict with this brief, stop and report BLOCKED.
2. Do exactly what this brief says. Do no extra work. Do not refactor, rename, or reformat
   anything not listed under SCOPE.
3. Touch only the files listed under SCOPE. If you need another file, stop and report BLOCKED.
4. Do not invent facts, numbers, prices, terms, or laws. If you do not know, write UNKNOWN
   and say exactly what is needed.
5. Run every step under VERIFICATION and paste the real output. Never write "should work"
   or "tests pass" without pasted output.
6. Never print, store, or request secrets, credentials, or personal data.
7. If anything is ambiguous, stop and put exactly one question under QUESTIONS in your
   report. Do not guess.
8. If you cannot complete a step, report BLOCKED with the reason. Do not improvise a
   workaround.
9. Finish by writing the TASK REPORT in the exact format given at the end of this brief.

CONTEXT
The floating mobile action pill (#floating-action-menu) contains a "New Entry" anchor
(href="/entries/new") and a ☰ toggle button. Two activation defects were found while
building the Plan 020 offline E2E and are logged, not fixed, in CLT-D-024 item 7:

1. Keyboard: the region div's onkeydown handler (FloatingMenu.svelte, handleKeydown) calls
   e.preventDefault() and toggles the menu for every Enter/Space that bubbles from ANY
   descendant. When the New Entry anchor has focus, Enter toggles the menu instead of
   following the link; when the ☰ button has focus, the button's native activation and the
   region handler both fire, and preventDefault suppresses the wiring the button was built for.
2. Pointer: the draggable action calls node.setPointerCapture(e.pointerId) on pointerdown
   at the region div (draggable.ts line 184). Pointer capture retargets every later pointer
   event of that sequence to the region div, so the click never lands on the child anchor or
   button. Playwright retried a click on the New Entry link for its full timeout with
   "div#floating-action-menu intercepts pointer events".

The E2E spec currently works around both defects with element.dispatchEvent('click'),
which proves the router wiring only, not that a human can activate the control.

OBJECTIVE
Make the floating menu's children activatable by real keyboard and real pointer input
without changing the drag, snap, haptic, or role-filtering behavior.

SCOPE (the ONLY files you may create or modify)
- apps/web/src/lib/ui/FloatingMenu.svelte — modify
- apps/web/src/lib/ui/actions/draggable.ts — modify
- apps/web/tests/e2e/floating_menu.spec.ts — create
- apps/web/tests/e2e/offline_sync.spec.ts — modify (replace dispatched clicks with real clicks)

OUT OF SCOPE (you MUST NOT do these)
- Any file under packages/, supabase/, scripts/, docs/ (except reporting), any route file.
- Changing the menu's visual design, geometry, role filtering, or i18n keys.
- Removing or weakening the Plan 019 haptic rule (buzz only on physical drag-release snaps).
- Replacing Playwright assertions with skips, retries, force:true, or dispatchEvent workarounds.
- Changing the port in apps/web/playwright.config.ts.

INPUTS (read these first)
- apps/web/src/lib/ui/FloatingMenu.svelte (whole file, ~100 lines)
- apps/web/src/lib/ui/actions/draggable.ts (pointerdown/pointerup/keydown handlers, lines 140–290)
- apps/web/playwright.config.ts (port, project, env injection)
- docs/plans/019_capacitor_android_release.md §10.4 (onSnap source contract)
- DECISIONS.md CLT-D-024 item 7 (discovery record)

REQUIREMENTS (numbered; each is testable)
R1. Enter or Space pressed while the New Entry anchor or the ☰ button has focus MUST NOT be
    preventDefault()ed by the region handler, and MUST NOT toggle the menu from the region
    handler. Toggling on Enter/Space MUST still work when the region div itself has focus.
R2. Escape while expanded MUST still collapse the menu (unchanged behavior).
R3. A pointerdown whose target is inside a focusable interactive child (anchor or button)
    MUST NOT start a drag and MUST NOT call setPointerCapture; a pointerdown on the pill's
    neutral area MUST still drag the menu, keep the 6 px threshold, and still call onSnap
    with source 'drag' on release (Plan 019 §10.4 contract unchanged).
R4. A single tap on the ☰ button MUST toggle the menu exactly once (no double fire), and a
    double tap on the neutral pill area MUST still reset to the docked position.
R5. floating_menu.spec.ts MUST prove, with real Playwright clicks and real keyboard input:
    (a) clicking the New Entry anchor navigates to /entries/new; (b) focusing the anchor and
    pressing Enter navigates to /entries/new; (c) clicking ☰ expands the nav panel; (d)
    focusing ☰ and pressing Enter expands and then collapses it.
R6. offline_sync.spec.ts MUST replace every dispatchEvent('click') workaround with the
    ordinary Playwright click/keyboard call, and the whole file MUST stay green.

HARD RULES THAT APPLY (cite the project context file by rule number)
- Rule 12: build order is PRD §17; this task is a defect fix inside implemented plans, no milestone change.
- Rule 13: where the PRD is silent choose the simplest option and record it in root DECISIONS.md.
- Rule 16: no absolute claims in the report; state what was measured.
- Rule 18: no destructive commands.

ACCEPTANCE CRITERIA (each maps to a check)
A1. Anchor is keyboard-activatable — verified by: pnpm test:e2e (floating_menu.spec.ts cases b)
    — expected: URL ends with /entries/new.
A2. Anchor is pointer-activatable without dispatchEvent — verified by: pnpm test:e2e
    (floating_menu.spec.ts case a and the rewritten offline_sync.spec.ts) — expected: navigation
    with no "intercepts pointer events" retry in output.
A3. ☰ toggles exactly once by click and by keyboard — verified by: pnpm test:e2e cases c and d
    — expected: nav panel visible then hidden; aria-expanded flips once per activation.
A4. Drag behavior unchanged — verified by: pnpm --filter @clt/web test (all green) and
    pnpm test:e2e — expected: existing drag/snap/haptic unit tests pass and the region is
    still draggable by the neutral area (assert position changes in spec).
A5. Type and lint clean — verified by: pnpm --filter @clt/web check; pnpm lint — expected: 0
    errors (no new warnings beyond the existing no-console set).

VERIFICATION (run in order; paste output)
1. cd "/home/zia/Documents/My Projects/Cosmo_Ledger_Track" && export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22.23.4 >/dev/null && corepack pnpm --filter @clt/web check
2. corepack pnpm lint
3. corepack pnpm typecheck
4. corepack pnpm --filter @clt/web test
5. corepack pnpm test:e2e
6. git diff --stat

STOP CONDITIONS (stop and report BLOCKED if)
- A fix requires a file outside SCOPE (for example the messages catalog or a route).
- Existing tests fail before your change in a way unrelated to the two defects.
- The Plan 019 haptic contract cannot be preserved without touching native/ files.
- Playwright cannot bind port 5199.

REPORT FORMAT: TASK REPORT (below). Return it to the Orchestrator via Zia.
=== END BRIEF ===

---

```
=== TASK REPORT ===
TASK ID:
AGENT ID:
STATUS:          DONE | PARTIAL | BLOCKED | FAILED
SUMMARY:         <max 5 lines>
FILES CHANGED:   <path — create/modify/delete — one-line reason>
COMMANDS RUN:    <each command, then the real output (trim to 40 lines; save longer logs to
                  docs/orchestration/reports/<TASK ID>.log and give the path)>
ACCEPTANCE:      A1 PASS|FAIL — evidence | A2 ... (every criterion listed)
DEVIATIONS:      <anything done differently from the brief, and why; "none" if none>
ASSUMPTIONS:     <list; "none" if none>
OPEN ISSUES:     <list; "none" if none>
QUESTIONS:       <exactly one, or "none">
=== END REPORT ===
```
