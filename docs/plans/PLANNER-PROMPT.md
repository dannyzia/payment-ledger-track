# PLANNER-PROMPT.md — Brief for the planning model

Revision 2.1 — 2026-10-29 (aligned to PRD v1.19, AGENTS.md rev 8, 000_TOC.md rev 2.1).

How to use: paste everything between `=== TASK BRIEF ===` and `=== END BRIEF ===` into the planning model, in a session that can read and write files in the project folder. Run once per batch. The `BATCH` line near the top says which plans that run produces. Batch 1 is below. To run another batch, change only the `TASK ID`, the `BATCH` line, the `OBJECTIVE`, the `SCOPE` file list, the plan-specific requirements R6 to R9 (replace with the requirements for that batch's plans, written in the same style), and the numbers in A1 and the verification globs. Note: for Batches 2–4, S6/A4 verify route, screen, and component ownership instead of database functions, and Batch 5 is permitted to populate the `## Coverage matrix` in `docs/plans/000_TOC.md`. Leave every other line unchanged.

Batches (review one batch at a time before issuing the next):

| Batch | Plans | Theme |
|---|---|---|
| 1 | 001–006 | Foundation, calc engine, database, bootstrap (M0 core) |
| 2 | 007–011 | Design system, auth, admin, entry form, sync engine (M1) |
| 3 | 012–016 | Ledger, reports, settlements, reconciliation A and month close, dashboards (M2) |
| 4 | 017–019 | PWA hardening, Mode B adapters, Capacitor release (M3–M5) |
| 5 | 020–021, coverage matrix | Test suites, readiness gates, deployment and runbooks |

Important: the PRD and AGENTS.md were edited by other sessions several times on 2026-10-29 (PRD v1.12 → v1.19 in one day). The planner must read the files as they are on disk at run time and record the PRD version header it read. If the header differs from v1.19, the planner reports the new version and checks every count and number in this brief against the file before using it.

---

=== TASK BRIEF ===
TASK ID:         CLT-T-001
TITLE:           Write implementation plans 001 to 006 from the PRD
ASSIGNED TO:     A-PLN-1 (Planner)
PRIORITY:        P0
DEPENDS ON:      none
PROJECT:         Cosmo Ledger Track | ROOT: /home/zia/Documents/My Projects/Cosmo_Ledger_Track | CONTEXT FILE: /home/zia/Documents/My Projects/Cosmo_Ledger_Track/AGENTS.md
SOURCE OF TRUTH: docs/plans/PRD-payment-ledger-app.md (v1.19 when this brief was written; the file on disk is authoritative), docs/plans/000_TOC.md (rev 2.1), AGENTS.md (rev 8 or later)
OS / SHELL:      Linux / bash (taken from the project path /home/zia/...; UNVERIFIED, so every plan states the shell once and uses bash syntax)
BATCH:           1 of 5 (plans 001, 002, 003, 004, 005, 006)

You are A-PLN-1, role Planner, working on the project "Cosmo Ledger Track" at /home/zia/Documents/My Projects/Cosmo_Ledger_Track.
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
Cosmo Ledger Track is an offline-first payment ledger (SvelteKit 2, Svelte 5, Dexie, Supabase/Postgres 15+). Its requirements document, the PRD, is long, dense, and organised by topic, not by build order. A coding model (weaker than you, no memory, no ability to ask questions mid-task) will implement the product from your plans. A plan is good only if that coding model can execute it from the first step to the last with zero hesitation: no design decisions left to it, no PRD hunting, no guessing at file names, commands, SQL, or expected values. Nothing is built yet: no code, no migrations, no `package.json`, no CI. AGENTS.md section 2 fixes the toolchain: Node 22 LTS, pnpm workspaces, and nine root scripts (`dev`, `build`, `test`, `test:e2e`, `lint`, `typecheck`, `format`, `db:bootstrap`, `db:reset`; note that PRD §13 lists seven scripts, and AGENTS.md §2 defines the complete set of nine by adding `typecheck` and `db:reset`). The PRD gives no package dependency versions or shell commands, so your plans supply the rest.

OBJECTIVE
Produce plan files 001 to 006 exactly as registered in docs/plans/000_TOC.md, each complete enough that a coding model can implement it without asking a question.

SCOPE (the ONLY files you may create or modify)
- docs/plans/001_repo_foundation_and_tooling.md — create
- docs/plans/002_calc_engine.md — create
- docs/plans/003_db_schema_and_security.md — create
- docs/plans/004_db_functions_entries_rates_sync.md — create
- docs/plans/005_db_functions_settlement_recon_month.md — create
- docs/plans/006_bootstrap_and_seed.md — create
- docs/plans/000_TOC.md — modify ONLY: (a) append rows to the Changelog table, (b) fix a plan's `Depends on`, `Scope`, or `PRD reference` cell, or the milestone-to-plan map, if your plans prove it wrong, with a changelog entry saying why. Never change a Status cell. Never rename a plan file.

OUT OF SCOPE (you MUST NOT do these)
- Do not write production code, migrations, or scripts. SQL, TypeScript, and shell appear inside plan files as specifications for the coding model to copy; none is created as a real file in the repo.
- Do not edit docs/plans/PRD-payment-ledger-app.md, AGENTS.md, README.md, CLAUDE.md, ORCHESTRATOR.md, or anything under .agents/.
- Do not decide an open owner item. 000_TOC.md lists none that block planning. If you find a new one, follow R10: write the affected steps so that settling it changes exactly one clearly marked step, label that step `DECISION PENDING`, and give your recommended option with a reason.
- Do not silently fix, reinterpret, or improve the PRD. Contradictions and gaps go in a `PRD ISSUES` entry (see R10), never into quiet workarounds.
- Do not write plans 007 to 021.
- Do not use web search for facts about the product. Web use is permitted only to verify a dependency version, and every such version needs a source URL and capture date.
- Do not trust AGENTS.md section 7 where it says a PRD finding is RESOLVED. Read the PRD and confirm each one yourself; report any claim the PRD does not support.

INPUTS (read these first, in this order, completely)
1. AGENTS.md — whole file. Hard rules 1 to 20 bind every plan.
2. docs/plans/PRD-payment-ledger-app.md — line 1 to the last line, with no skipping. Report the version header and the last line number you read.
3. docs/plans/000_TOC.md — whole file.
4. ORCHESTRATOR.md — sections 7.1, 7.2, 8 (how work is verified), so your acceptance checks match how the orchestrator will verify.
5. All already-written plan files in docs/plans/ (for Batches 2–5, to maintain interface, file path, and dependency consistency).

PLAN FILE FORMAT (every plan uses this exact structure and heading order)

```
# NNN_name.md — <title>

- Plan Identifier: CLT-PLAN-NNN
- Phase: <from 000_TOC.md>
- Milestone: <M0..M5 per PRD §17>
- Parent Document: docs/plans/PRD-payment-ledger-app.md (<version read>)
- PRD sections covered: <exact section numbers>
- Depends on: <plan numbers>
- Current Status: Not Implemented
- Revision: 1.0 — <date>

## 1. Purpose            (3 to 6 lines)
## 2. Scope              (IN: list. OUT: list.)
## 3. Preconditions      (what must exist and pass before step 1; each with a check command)
## 4. Files              (table: exact path | create or modify | one-line purpose)
## 5. Steps              (numbered; see STEP RULES)
## 6. Specifications     (full SQL, TypeScript signatures, config, command lists the steps refer to)
## 7. Tests              (table: test name | input | exact expected output | PRD source | file)
## 8. Acceptance criteria (each: observable result | exact verify command | exact expected output)
## 9. Hard rules touched  (AGENTS.md rule numbers with one line each)
## 10. Pitfalls          (specific traps for this plan, each with the symptom and the fix)
## 11. PRD ISSUES and DECISION PENDING (contradictions, gaps, open items; see R10)
## 12. Handoff           (what later plans may rely on once this one is Implemented: file paths, exported names, commands)
## 13. Suggested task breakdown (tasks the orchestrator can turn into briefs: id suffix, one-line objective, scope files, depends on, role, priority)
## Changelog
```

STEP RULES (apply inside section 5)
- One step, one outcome, one verb. A step that contains "and" joining two actions is split.
- Each step lists the exact files it touches, the exact commands (with working directory), and the exact check with expected output.
- A step that creates SQL or code points to the exact block in section 6 that the coding model copies.
- A step is small enough for one agent sitting: at most 5 files, at most 150 lines of new code, or one migration file.
- Steps run in a strict order. State the dependency of any step on an earlier step by number.

REQUIREMENTS (numbered; each is testable)
R1.  MUST write exactly the six plan files in SCOPE, each using PLAN FILE FORMAT with all 13 sections plus Changelog, in that order, and every section filled (write `none` where nothing applies).
R2.  MUST make each plan self-sufficient. A coding model reads AGENTS.md, then the one plan, then only the PRD sections the plan cites by number. Nothing the model must know may live only in your head or in an uncited PRD section.
R3.  MUST copy numbers, constants, SQL, names, and error codes from the PRD verbatim. A constant (basis points, poisha amounts, lock class IDs `1001`/`1002`/`1003`, the push batch size, the pull page size, the clock-skew limit, the retention window, the reconciliation tolerance, the due-day range) is quoted with its PRD section. Never paraphrase a number, and never take a number from this brief or from AGENTS.md without confirming it in the PRD text.
R4.  MUST give every function, type, RPC, trigger, constraint, index, view, route, and table an exact name taken from the PRD. Where the PRD gives a name, use it unchanged. Where the PRD describes behaviour but gives no name or no code, write the exact implementation yourself and label that block `PLAN-DERIVED (not in PRD)` so the orchestrator can audit it. Examples: RLS policy SQL (when the PRD describes policies in words only), immutability triggers described only by purpose, `updated_at` triggers, supabase migration file names and ordering.
R5.  MUST specify the exact repository layout, file names, and migration file names for your plans. Migration files use the form `supabase/migrations/<14-digit UTC timestamp>_<snake_case>.sql` with fixed, ascending timestamps you choose and list in plans 003, 004, and 005, so file order equals execution order and no two plans share a timestamp.
R6.  MUST write plan 001 so that, after it is Implemented, every command the later plans use exists and works. The toolchain is fixed by AGENTS.md section 2: Node 22 LTS pinned in `.nvmrc` and root `package.json` `engines`, pnpm workspaces with `pnpm-workspace.yaml` covering `packages/*` and `apps/*`, and the nine root scripts named in CONTEXT (reconciling PRD §13's seven scripts with AGENTS.md §2's nine by including `typecheck` and `db:reset`). The plan states, for each script, its exact command line, its working directory, its expected exit code on a clean repository, and where it is defined. Plan 001 also defines `.github/workflows/ci.yml` (GitHub Actions, because the remote is GitHub) running install, lint, typecheck, test, and the database tests; `.env.example` (variable names only, no values); `.nvmrc`; root `DECISIONS.md` seeded with the entries the PRD already requires; and the root `tsconfig` base. For every dependency, either give a version verified with a source URL and capture date, or write `UNVERIFIED` and include a step where the coding model reads the version from the package registry with the exact command and records it in root `DECISIONS.md`. Plan 001 MUST decide, with reasons, the database test framework (pgTAP or Vitest with a Postgres client) and the local Postgres method (Supabase CLI local stack or a Postgres 15+ container), and give the exact start and reset commands, because plans 003 to 006 depend on both.
R7.  MUST write plan 002 so the coding model implements `packages/calc` and `packages/shared` from it alone: file list, exported names, full TypeScript signatures for `mulBp`, `roundHalfUp`, the entry-calculation function (use the PRD's own name; if the PRD gives none, label the name PLAN-DERIVED), every type in PRD section 6.1, the error classes with their exact messages from PRD section 6.3, the guard order, the three VAT modes, the override rules and their mandatory reasons (PRD section 6.8), the wire-format helpers (bigint to decimal string and back) with Zod schemas, and the 2-decimal BDT input rule (both from PRD section 9.1). Section 7 MUST contain every fixture as a table with exact poisha values copied from the PRD: all rows and asserted totals of section 6.6, every fixture of section 6.7, the two rounding traps, the mutual-exclusivity cases, the deductions-exceed-gross cases, and the property tests listed in section 16.1 with the fast-check generators (value ranges stated as numbers). Because AGENTS.md rule 3 says the database independently verifies arithmetic and the PRD requires differential tests between the TypeScript engine and SQL, plan 002 MUST define one shared fixture file (path and JSON schema) that both the TypeScript tests and the SQL parity tests in plan 004 read, and MUST state the handoff in section 12.
R8.  MUST write plan 003 as the complete database foundation: a migration list in execution order; for each migration file, the exact tables, enums, sequences, constraints, indexes, generated columns, and views it creates (derive the complete list from PRD section 7 and section 10; do not rely on any list in this brief); the revocation block; `ENABLE ROW LEVEL SECURITY` for every table the PRD names; every RLS policy as executable SQL (PLAN-DERIVED where the PRD describes policies in words only); and the routine grants and default privileges (PRD section 7.1). Section 7 lists schema tests: for each table, an assertion that RLS is on and that `INSERT`, `UPDATE`, `DELETE` are revoked from `anon` and `authenticated`; for each named constraint and index, one positive and one negative SQL case with the exact error expected. Assign each PRD section 16.2 test to the plan that owns it, by reading the test text: schema-only tests belong to plan 003; tests that call a function belong to plan 004 or 005.
R9.  MUST write plans 004, 005, and 006 so that every function, RPC, and trigger the PRD defines in sections 7.3 and 7.4, and every one named in the "Database Triggers" list and elsewhere in section 7, is owned by exactly one of the three. Ownership rule: plan 004 owns functions and triggers for entries, sync operations, rate profiles, payment methods, payables, settings, users and invites, ownership transfer, devices, stale-entry review, and the retention job; plan 005 owns functions and triggers for settlements, settlement payments, statements, statement lines, reconciliation exceptions, overpayment approval, month close and reopen, the pure database function `calc_settlement_status(p_expected bigint, p_paid bigint)`, and the recalculation and invalidation triggers; plan 006 owns `scripts/bootstrap.ts`, its seed SQL, and the clean-database verification (PRD section 7.4). If an object fits neither rule, assign it to the plan with the nearest domain and record the choice in that plan's section 11. For each function, the plan gives: exact signature copied from the PRD, caller roles, ordered body steps, which advisory locks and row locks are taken in which order (PRD section 7.2), every error code string it can raise (from sections 7.3, 9.2.2, 16.2), the `audit_log` action names it writes (PRD section 15.1), and the section 16.2 test numbers that exercise it. Plan 004 MUST also specify the SQL arithmetic backstop that independently verifies non-override fields (PRD sections 6.5 and 7.3) and the parity test that reads the shared fixture file from plan 002.
R10. MUST handle every PRD problem by this procedure, with no exceptions: (a) put it in section 11 of the plan it affects, as `PRD ISSUE <plan>-<n>` with the PRD section and line numbers, what contradicts or is missing, the options, and your recommendation; (b) do not decide it; (c) mark every step it touches `DECISION PENDING`. Also list it again in the TASK REPORT. Run these checks and report each result (a found mismatch, or `no mismatch found` with the PRD line ranges you compared): function signatures in section 7.3 against their call sites in section 9.1; every error code in the section 9.2.2 matrix against where section 7.3 raises it; lock acquisition order in each section 7.3 function against section 7.2; column names used in section 7.3 functions against the section 7 DDL; trigger event lists against the columns the trigger bodies read; every section 16.2 test against a function or constraint that makes it pass; each milestone Definition of Done in section 17 against the section 16.2 numbering and against section 18 gate wording; every route named in section 13 against a function it calls; and every claim in AGENTS.md section 7 marked RESOLVED against the PRD text.
R11. MUST make every expected value in sections 7 and 8 concrete: an exact string, number, SQL error code and message fragment, or exit code. Do not write "passes", "succeeds", "works", or "returns the correct value" as an expected result.
R12. MUST NOT use any of these words or phrases in a plan, except inside a string quoted from the PRD: etc. · and so on · as needed · appropriately · properly · clean up · improve · optimize · best practices · similar to · where applicable · if possible · consider · feel free · a few · some · soon · fast (except in fast-check) · robust · make sure it works. Replace each with a number, a path, or a test.
R13. MUST state units on every number (poisha, bp, ms, rows, seconds, bytes). MUST state the working directory on every command. MUST write the shell once per plan (bash) and keep every command in that shell.
R14. MUST NOT put a secret, password, key, or token in any plan. Environment variables appear by name only. Plan 006 names `BOOTSTRAP_OWNER_EMAIL` and `BOOTSTRAP_OWNER_PASSWORD` (PRD section 7.4) and says they come from the environment; the plan never shows a value.
R15. MUST give each plan section 13 (suggested task breakdown) with tasks sized so a coding model finishes one in a single sitting, each naming its scope files and dependencies, using ID suffixes `A`, `B`, `C` (for example `001-A`). The orchestrator assigns real CLT-T numbers.
R16. MUST, after writing all six plans, run the SELF-AUDIT below and fix every failure before reporting. Report the audit results in the TASK REPORT.

SELF-AUDIT (run after writing; paste results)
S1.  For each plan, confirm all 13 sections and the Changelog exist in order. Command: `grep -n '^## ' docs/plans/00N_*.md` and compare with the format.
S2.  Banned-word scan. Command: `grep -n -i -E "etc\.|and so on|as needed|appropriately|properly|clean up|improve|optimi[sz]e|best practices|similar to|where applicable|if possible|consider|feel free|a few|some |soon|robust|make sure it works" docs/plans/00[1-6]_*.md`. Expected: no output, or each hit justified as a quoted PRD string.
S3.  Secret scan. Command: `grep -n -i -E "password *=|secret *=|eyJ|sk_live|service_role *key *=" docs/plans/00[1-6]_*.md`. Expected: no real values.
S4.  Constant check. For each constant in R3, grep the plan and the PRD and show both lines match.
S5.  Name check. For every function, trigger, constraint, index, view, and route a plan names, show one grep hit in the plans and one in the PRD, and list any name present in one and absent in the other.
S6.  Ownership check. Every function, RPC, and trigger the PRD defines appears in exactly one of plans 004, 005, 006. Show the table. Derive the left column by grepping the PRD for `create or replace function`, `create trigger`, `RPC`, and the headings in sections 7.3 and 7.4, not from memory.
S7.  Test ownership. Every PRD section 16.2 test number is mapped to the plan that owns it (plans 002 to 006 own those that depend only on their content; for the rest write `later plan: <number from 000_TOC.md>`). Count the tests in the PRD first and state the count (65 at v1.19). Show the table. Put the table in the TASK REPORT, not in a plan file.
S8.  Zero-hesitation read-through. Re-read each plan as the coding model: list every place where it would have to choose a name, a path, a command, a value, or a design. Fix each. Report the count found and fixed, per plan.

HARD RULES THAT APPLY (AGENTS.md)
- Rule 1: never hardcode rates; fixtures are test fixtures only.
- Rule 2: money is integer poisha; poisha and 64-bit values are decimal strings on the wire.
- Rule 3: one authoritative calculation module, `packages/calc`; the database verifies independently.
- Rule 5: every state change writes `audit_log` in the same transaction.
- Rule 7: writes go only through SECURITY DEFINER RPCs under service_role with `search_path = public, pg_temp`.
- Rule 8: no secrets anywhere.
- Rule 10: respect the lock hierarchy.
- Rule 12: build order follows PRD section 17.
- Rule 13: where the PRD is silent, choose the simplest option and record it; in a plan, that means a PLAN-DERIVED label plus a line for root `DECISIONS.md`.
- Rule 14: do not edit the PRD.
- Rule 17: no invented figures, commands, or versions.

ACCEPTANCE CRITERIA
A1.  Six files exist at the six paths in SCOPE — verified by: `ls -1 docs/plans/00[1-6]_*.md | wc -l` — expected: `6`.
A2.  Each plan has the 13 sections and a Changelog in the specified order — verified by: S1 — expected: all six match.
A3.  No banned word and no secret in the plans — verified by: S2 and S3 — expected: no unjustified hit.
A4.  Every function, RPC, and trigger the PRD defines is owned by exactly one plan among 004, 005, 006 — verified by: S6 — expected: table with zero blanks and zero duplicates.
A5.  Every section 16.2 test has an owner — verified by: S7 — expected: one row per test in the PRD, zero blanks, and the row count equals the PRD test count stated in S7.
A6.  Every PRD problem found is in a `PRD ISSUE` entry with PRD line numbers, and every R10 check has a reported result — verified by: inspection of the TASK REPORT against `grep -n "PRD ISSUE" docs/plans/00[1-6]_*.md` — expected: each issue in the report appears in a plan, and every R10 check is listed.
A7.  000_TOC.md Status cells unchanged and plan file names unchanged — verified by: `grep -c -E '^\| 0[0-2][0-9] \|.*\| Not Implemented \|$' docs/plans/000_TOC.md` — expected: `21`.
A8.  No file outside SCOPE changed — verified by: `git status --porcelain` — expected: only the seven SCOPE paths listed as new or modified, plus any files other sessions changed before this task began (list them in the report with their `git diff --stat` so the orchestrator can tell them apart).
A9.  The TASK REPORT lists the PRD version header and the last PRD line number read — verified by: comparing them with the first lines of the PRD and the `wc -l` output of VERIFICATION step 1 — expected: the version matches and the line numbers are equal.

VERIFICATION (run in order; paste output)
1. `cd "/home/zia/Documents/My Projects/Cosmo_Ledger_Track" && head -3 docs/plans/PRD-payment-ledger-app.md && wc -l docs/plans/PRD-payment-ledger-app.md` (confirms the version and the line count you read to)
2. `ls -1 docs/plans/00[1-6]_*.md | wc -l`
3. Every S1 to S8 command and table above.
4. `git status --porcelain`

STOP CONDITIONS (stop and report BLOCKED if)
- You cannot read the PRD to its last line.
- You cannot write files under docs/plans/. In that case do not stop: output each file in full, in a separate fenced block headed by its path, then report BLOCKED with the reason.
- An AGENTS.md hard rule conflicts with this brief.
- Two PRD passages contradict each other in a way that changes a function body, a column, or a constraint and you cannot write the step without choosing: write the PRD ISSUE, mark the step DECISION PENDING, and continue with the other steps. Stop only if the contradiction blocks an entire plan.
- The PRD version header is not v1.19 and the difference changes a count or name used in this brief: finish reading, list every changed item, and report PARTIAL with the list; do not write plans against numbers you have not confirmed.

REPORT FORMAT: TASK REPORT (below). Return it to the Orchestrator via Zia.

=== TASK REPORT ===
TASK ID:
AGENT ID:
STATUS:          DONE | PARTIAL | BLOCKED | FAILED
SUMMARY:         <max 5 lines>
FILES CHANGED:   <path — create/modify/delete — one-line reason>
COMMANDS RUN:    <each command, then the real output (trim to 40 lines; save longer logs to
                  docs/orchestration/reports/CLT-T-001.log and give the path)>
ACCEPTANCE:      A1 PASS|FAIL — evidence | A2 ... (every criterion listed)
DEVIATIONS:      <anything done differently from the brief, and why; "none" if none>
ASSUMPTIONS:     <list; "none" if none>
OPEN ISSUES:     <list, including every PRD ISSUE with PRD line numbers; "none" if none>
QUESTIONS:       <exactly one, or "none">
=== END REPORT ===

=== END BRIEF ===
