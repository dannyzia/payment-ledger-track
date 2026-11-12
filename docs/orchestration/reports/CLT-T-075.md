# CLT-T-075 Report — Client Storage Multi-Center Isolation & Entry Capture Alignment

Date: 2026-11-09
Agent: A-IMP-1 (Implementer)
Status: DONE
Verified by: Orchestrator (Independent skeptic audit: `pnpm --filter @clt/web test src/lib/db/dexie.test.ts` passed 5/5; `pnpm --filter @clt/web check` passed with 0 errors / 0 warnings; verified dynamic `db` Proxy delegation, shift-safe outbox protection on sign-out, outbox tenant stamping, and isolated Dexie database naming)

=== TASK REPORT ===
TASK ID:         CLT-T-075
AGENT ID:        A-IMP-1
STATUS:          DONE
SUMMARY:         Client storage is now tenant-isolated: Dexie is physically scoped per
                 center (KumonLedger_<centerId>) behind a backward-compatible Proxy,
                 entries/ops stamp centerId into wire payloads, flush pulls same-center
                 ops across shifts, sign-out warns before dropping a pending outbox
                 (never wiped), and the entry form passes centerId and previews the
                 center-prefixed ID. Dexie tests 5/5; svelte-check 0 errors.
FILES CHANGED:
  apps/web/src/lib/db/index.ts                    modify  CosmoDatabase(databaseName) + getCenterDb cache + db Proxy resolving session.user.centerId per access; LocalEntry/LocalOutboxOp + 7 cached interfaces get center_id/centerId
  apps/web/src/lib/db/entries.ts                  modify  SaveEntryInput.centerId; center_id stamped on entries; wirePayload.centerId (also inside supersede replacement); centerId forwarded to enqueue helpers; checkDuplicate filters by center_id when provided
  apps/web/src/lib/db/outbox.ts                   modify  enqueueCreateEntry/enqueueSupersedeEntry accept centerId and store it on LocalOutboxOp
  apps/web/src/lib/ledger/void.ts                 modify  requestEntryVoid/executeEntryVoid payloads now carry centerId (entry.center_id ?? null)
  apps/web/src/lib/sync/push.ts                   modify  body carries centerId; every pushed payload stamped with centerId when absent; flush filter now includes same-center ops from prior shifts
  apps/web/src/lib/sync/pull.ts                   modify  super_admin appends &centerId=<clt_super_center> when a specific center is selected
  apps/web/src/lib/auth/session.svelte.ts         modify  signOut(force=false): Promise<boolean>; counts pending outbox ops, confirm() warns and cancels, clearLocalSession unchanged (outbox never wiped)
  apps/web/src/routes/(app)/entries/new/+page.svelte modify handleLocalSave passes centerId; header Chip previews E-{centerCode}-… with #LOCAL-xxxx fallback
  apps/web/src/lib/db/dexie.test.ts               modify  new test #5: per-center DB isolation via getCenterDb
ACCEPTANCE:
  A1 PASS — tests 5/5 pass (4 existing + 1 isolation test).
  A2 PASS — svelte-check found 0 errors and 0 warnings.
  A3 PASS — only the 9 specified SCOPE files were touched.
=== END REPORT ===

