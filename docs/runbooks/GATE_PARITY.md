# Gate Parity Runbook — Cosmo Ledger Track

Plan 023. `apps/web/tests/admin/gate-parity.test.ts` keeps the screen and the server in
step: a link, button or command that a role can reach must be backed by a route that
role may call. When the two disagree, either the screen offers a **dead control** (the
route refuses it) or it **hides work staff need** (the route would accept it). Neither
shows up in a typecheck and neither shows up in a manual click-through on one account.

This runbook is for the person who just saw the suite fail.

---

## 1. Running it

```bash
pnpm --filter @clt/web exec vitest run tests/admin/gate-parity.test.ts
```

About two seconds. It also runs as part of `pnpm test`, which CI runs on every push and
pull request, so a failure blocks the branch rather than surfacing after review.

Read the failure message: it names the file, the capability and — for role findings —
the exact expression. The failure families below say what each one means.

---

## 2. What it scans

| | |
| --- | --- |
| Roots | `apps/web/src/routes/(app)` and `apps/web/src/lib/ui` |
| Files | `.svelte` screens and components, plus `.ts` modules beside them (`*.test.ts` excluded) |
| Capability call sites | `hasCapability`, `hasCenterCapability`, `canManageUser` |
| Register | `apps/web/src/lib/capabilities.ts` — `PERMISSIONS`, `ALL_CAPABILITIES` |

Two kinds of check run over that set:

1. **Capability gates are declared.** Every gate call in a scanned file must appear in
   `DECLARED` in the test, with a coverage kind saying how its role set is justified.
2. **No raw caller-role branch.** A screen must decide by capability, not by comparing
   the caller's role. The detector reads the shapes that actually occur, not just the
   literal comparison: quoted and reversed comparisons, comparison against a constant,
   array membership, `.some/.filter/.every/.find/.findLast` callbacks,
   `.roles.includes(role)`, `switch (callerRole)`, a local `UserRole` helper, a
   role-keyed table read by the caller's role, and an imported helper traced to its
   definition — through named and aliased imports, a namespace import, and barrel
   re-exports (`export { x } from`, `export { x as y } from`, nested barrels,
   `export * from`).

---

## 3. Failure: "add these to DECLARED with the route (or offline/shell reason) they belong to"

A scanned file now gates on a capability the test has never seen. It is not a bug in the
test — an undeclared gate is how a screen silently diverges from its route.

Add an entry to `DECLARED` with the coverage that describes the gate:

| `kind` | Use it when | Fields |
| --- | --- | --- |
| `route` | The screen's action calls an API route | `apiPath`, `expected`, `strict`, optional `note` |
| `seat-route` | A `/admin/super/*` screen behind a seat route | `apiPath`, `expected` |
| `offline` | The data is read from Dexie and no route answers the read | `expected`, `reason` |
| `shell` | Navigation, a modal, a dashboard variant — no route of its own | `expected`, `reason` |

`expected` is the role set the gate yields, in `ROLES` order (`staff`, `admin`, `owner`,
`super_admin`) — copy it from the console line the suite prints for that gate rather than
reasoning it out by hand.

A `route` entry fails if the screen and the route disagree: *"`/api/v1/...` allows X but
the screen admits Y"*. Fix the screen to gate on the capability the route enforces. When
the route must necessarily admit a wider role set — an admin route whose per-target rule
lives in the handler — pin it with `strict: false` and a `note` saying why, or with
`knownGaps` naming each role and its reason. A pinned gap is checked too: it fails if it
disappears or grows.

Capabilities must exist in the registry; an invented id fails
"keeps every discovered capability in the registry".

---

## 4. Failure: "the source no longer gates on this; remove the declaration"

A declaration outlived its gate — the gate was deleted, or moved (for example, from a
component into `lib/ui/nav.ts`). Delete the entry. Do not leave a declaration "for
later": it makes the table describe code that is not there, and the next person reads it
as the truth.

---

## 5. Failure: "use hasCapability/hasCenterCapability (or isCenterScoped) instead of gating on the caller role"

The screen branches on the caller's role. Convert it:

1. **Find the capability the destination already enforces.** The route's guard, or the
   `DECLARED` entry for the screen it opens, names it.
2. **Gate on that.** `hasCenterCapability(role, 'report.read')` for a franchise screen;
   `hasCapability(role, 'center.create')` for the platform seat;
   `isCenterScoped(role)` only when the distinction really is centre-vs-platform.
3. **Declare it** if the file is newly gated (section 3), and **remove** any declaration
   for the branch you replaced.
4. **Keep the literal at the call site.** The scan reads source; a capability passed as a
   variable (`hasCapability(role, item.capability)`) fails with *"gate calls with a
   non-literal capability cannot be verified"*. Put the literal in the predicate that
   owns it — `nav.ts` does this for the shared navigation.

If the decision genuinely depends on the role and no capability separates it, name the
capability anyway: the dashboard variant reads `month.close` for Owner and `report.read`
for Admin, and staff fall through. That keeps one switch in the registry instead of two
role strings in a screen.

### Exceptions

`RAW_ROLE_EXCEPTIONS` exists but is **empty, on purpose**. Use it only when a role branch
is correct and a capability would misrepresent it, and then:

- give a `reason` that survives review, not "test is noisy";
- expect the exception to fail as **stale** the moment the branch moves or is deleted, so
  it cannot outlive its justification;
- prefer converting. The command palette used to filter on `cmd.roles.includes(role)`; it
  was converted to per-destination capabilities rather than excused, and the conversion
  is what exposed that the sidebar and the palette were gating settings differently.

---

## 6. Do not

- Skip, rename or delete the test, or narrow what it scans, to get a green run.
- Add a role list back into a screen because the capability was inconvenient.
- Add an exception without reading section 5 first — the finding is usually a real gate
  the route already enforces.

---

## 7. What the scan cannot see

The detector is lexical, not semantic. It will not flag, and does not protect:

- a **default export** — `export default (caller: UserRole) => …` or
  `export { x as default } from './x'`; the tracer follows named exports only;
- a helper reached through a **computed member** (`auth[name](role)`) or a **dynamic import**
  (`(await import('./owner')).isOwner(role)`), where the name is not in the source at the
  call site;
- a role branch built at runtime (`const gate = map[kind]`, or a table populated in a
  loop) or one indexed through an intermediate variable (`const r = role; VIEWS[r]`);
- a role passed through a helper and decided several calls later;
- route guards written in a shape `routeRoles()` does not recognise — that one fails
  loudly instead of being ignored, but a guard it *does* recognise is trusted;
- anything outside the two scanned roots: `apps/web/src/lib/auth`, `.../server`, the
  `+server.ts` routes themselves (guarded separately), and `.agents`/`.claude` content.

When you find a gate that slipped through, add its shape to the detector with a
self-check that proves it fires, and a negative case that proves it does not fire on a
roster row's role. The self-checks in the test file — `detects …` and `does not mistake …`
— are the pattern to copy, and each one was proved against real files before it was
trusted.
