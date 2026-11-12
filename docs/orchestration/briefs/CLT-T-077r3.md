# Task Brief — `CLT-T-077r3`

- **Task ID:** `CLT-T-077r3`
- **Role / Owner:** Implementer (`A-IMP-2`)
- **Depends On:** `CLT-T-077r2`
- **Triggered By:** Independent audit `A-AUD-1` (`docs/orchestration/reports/CLT-T-077r2-audit.md`) — 1 pre-existing Major (`NULL`-role three-valued logic bypass in 7 `SECURITY DEFINER` RPCs in `006`, plus defense-in-depth `NULL` checks on `p_caller_role` in `005:1926, 1946`) and 2 actionable Minors (`006:294, 309` reversal trigger center scoping; `tests/db/schema.test.ts:339-344` nested `finally` cleanup).
- **Applicable Hard Rules:** Rules 5, 7, 9, 10, 18 (Dev DB on port `54322` `postgres` MUST NEVER be reset or mutated).

---

## Allowed SCOPE (Strictly 4 Files — Do Not Touch Anything Else)

1. `supabase/migrations/20261029000005_functions_entries_rates_sync.sql`
2. `supabase/migrations/20261029000006_functions_settlement_recon_month.sql`
3. `tests/db/settlement_recon.test.ts`
4. `tests/db/schema.test.ts`

---

## Requirements

### R1 — `supabase/migrations/20261029000006_functions_settlement_recon_month.sql`
1. **Fix `NULL`-role three-valued logic bypass in all 7 remaining `SECURITY DEFINER` RPCs (`403 unauthorized`):**
   - `record_settlement_payment` (line `466`): change `if v_caller_role not in ('admin', 'owner') then` to `if v_caller_role is null or v_caller_role not in ('admin', 'owner') then`.
   - `approve_settlement_overpayment` (line `590`): change `if v_caller_role != 'owner' then` to `if v_caller_role is distinct from 'owner' then`.
   - `create_statement` (line `804`): change `if v_caller_role not in ('admin', 'owner') then` to `if v_caller_role is null or v_caller_role not in ('admin', 'owner') then`.
   - `supersede_statement` (line `956`): change `if v_caller_role not in ('admin', 'owner') then` to `if v_caller_role is null or v_caller_role not in ('admin', 'owner') then`.
   - `match_statement_line` (line `1104`): change `if v_caller_role not in ('admin', 'owner') then` to `if v_caller_role is null or v_caller_role not in ('admin', 'owner') then`.
   - `unmatch_statement_line` (line `1221`): change `if v_caller_role not in ('admin', 'owner') then` to `if v_caller_role is null or v_caller_role not in ('admin', 'owner') then`.
   - `accept_statement_line` (line `1303`): change `if v_caller_role not in ('admin', 'owner') then` to `if v_caller_role is null or v_caller_role not in ('admin', 'owner') then`.
2. **Defense-in-depth `center_id` scoping in `fn_settlement_payments_reversal_lock` (lines `294, 309`):**
   - Line `294`: `from settlement_payments where id = NEW.reverses_payment_id and center_id = NEW.center_id for update;`
   - Line `309`: `where center_id = NEW.center_id and reverses_payment_id = NEW.reverses_payment_id and is_reversal = true` (keeping `and id != NEW.id`).

### R2 — `supabase/migrations/20261029000005_functions_entries_rates_sync.sql`
- In `rpc_push_sync_op` (`supersede_entry` line `1926` and `void_entry` line `1946`), guard against `NULL` `p_caller_role`:
  `if p_caller_role is null or p_caller_role not in ('admin', 'owner') then`

### R3 — `tests/db/settlement_recon.test.ts`
- Add regression assertions verifying that calling `approve_settlement_overpayment` (owner-only), `record_settlement_payment` (admin/owner), and `create_statement` (admin/owner) with a missing/non-existent or inactive or cross-center actor UUID raises `'403 unauthorized'` (and cannot slip past SQL `NULL NOT IN` / `NULL !=` logic).
- Keep all existing tests and strong assertions intact. Keep Prettier compliance (`pnpm exec prettier --check tests/db/settlement_recon.test.ts`).

### R4 — `tests/db/schema.test.ts`
- In `audit_log_select_policy blocks staff and allows admin/owner within the center` (`finally` block, lines `339-344`), wrap the `ROLLBACK` cleanup in an inner `try { ... } finally { ... }` so `await client.query('RESET ROLE')`, `await client.query('RESET ALL')`, and `client.release()` are guaranteed to run even if `ROLLBACK` throws (using inner `try/finally` around `ROLLBACK` / `RESET` cleanup cleanly).
- Keep Prettier compliance (`pnpm exec prettier --check tests/db/schema.test.ts`).

---

## Verification Checklist (Must All Run After Final Edit; Never Touch Port 54322 `postgres`)

1. Grep checks:
   - Confirm every `v_caller_role` comparison in `006` uses `is null or` or `is distinct from`.
   - Confirm `0` occurrences of `row_security` in `006`, `0` occurrences of `current_user` in `004`.
2. `pnpm test` (`clt_test` throwaway DB) — report exact test counts (confirming `clt_test` auto-reprovisions with the updated `005`/`006` SHA-256).
3. `pnpm typecheck` (`0` errors, `0` warnings).
4. `pnpm exec prettier --check tests/db/settlement_recon.test.ts tests/db/schema.test.ts` (`exit 0`) and `pnpm exec eslint tests/db/settlement_recon.test.ts tests/db/schema.test.ts` (`0` errors).
5. Output complete `=== TASK REPORT ===` (`Task: CLT-T-077r3`, `STATUS: DONE`) with verbatim outputs.

