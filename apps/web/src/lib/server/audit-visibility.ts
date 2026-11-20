/**
 * Plan 023 step 14 — audit visibility for center-facing reads. `CLT-D-037` is still
 * DECISION PENDING, so this file holds both answers and the recorded default.
 *
 * The question the owner has not answered is what a franchisee sees when the platform
 * seat acts on their center:
 *
 *   'silent'                 the center sees no platform row at all. This is the
 *                            recorded default (docs/orchestration/DECISIONS.md row 8).
 *   'attributable_unnamed'   the center sees that an action happened, attributed to
 *                            `platform`, with the operator's uuid not disclosed.
 *
 * The actor's role is recorded at the write boundary, so changing the answer is changing
 * `AUDIT_VISIBILITY_MODE` — not the schema, the query, or the screens. `audit-read-model.ts` is the
 * one reader that applies it; center audit screens, search and export must come through
 * that reader, or an export could be more revealing than the screen it accompanies.
 */
export type AuditVisibilityMode = 'silent' | 'attributable_unnamed';

/** The mode every center-facing read applies unless a caller injects another. */
export const AUDIT_VISIBILITY_MODE: AuditVisibilityMode = 'silent';
