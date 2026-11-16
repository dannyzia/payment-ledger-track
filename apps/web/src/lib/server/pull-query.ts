/**
 * The entries statement behind `GET /api/v1/sync/pull`.
 *
 * It lives here rather than inline in the route so the database suite can run the
 * statement Postgres actually executes (`tests/db/pull_attribution.test.ts`), instead
 * of asserting a copy of it or a mocked pool. The route and that test are the only
 * callers; nothing else should build this query.
 *
 * Parameters, in order:
 *   $1 `since`            — exclusive `server_seq` cursor (bigint)
 *   $2 caller role        — admin, owner and super_admin see every entry in scope
 *   $3 caller id          — a staff member sees only their own rows
 *   $4 effective center   — NULL means every center the caller may read
 *
 * `created_by_role` (Plan 023 step 12, design §6.7): a platform-created entry's author
 * belongs to no center, so that profile is never delivered in `profiles`; the role has
 * to travel with the row or a device can only show a bare user id. The join is on the
 * primary key, so it cannot duplicate a row, and it is a left join because the outer
 * `scanned` side is itself left-joined for the watermark row.
 */
export const PULL_ENTRIES_SQL = `
    with scanned as (
      select * from entries
      where ($4::uuid is null or center_id = $4) and server_seq > $1
      order by server_seq asc limit 200
    ),
    batch_meta as (
      select coalesce(max(server_seq), $1) as watermark,
             count(*) as scanned_count
      from scanned
    )
    select s.*, p.role::text as created_by_role, m.watermark, m.scanned_count
    from batch_meta m
    left join scanned s on ($2 in ('admin','owner','super_admin') or s.created_by = $3)
    left join profiles p on p.id = s.created_by
    order by s.server_seq asc nulls last;
  `;
