#!/usr/bin/env tsx
/**
 * Prune stale rows from the device registry.
 *
 * Every Playwright or sweep browser context that signs in registers itself as a
 * device, so the table fills with rows no human ever used. Deleting them is
 * safe in one direction — a device re-registers on its next push — but not in
 * the other: a deleted row loses its revocation, and `entries.device_id` would
 * point at nothing. So the script keeps:
 *
 *   - any device referenced by an entry (provenance of who wrote what);
 *   - any revoked device (the hardware killswitch is state, not noise);
 *   - the newest N devices per user (default 1), which is the one a real
 *     install is still using.
 *
 * Every deletion writes an `audit_log` row (hard rule 5), because `devices`
 * has no audit trigger of its own: the RPCs audit their own operations, so a
 * maintenance DELETE has to do it explicitly.
 *
 *   pnpm db:prune-devices --dry-run
 *   pnpm db:prune-devices --apply
 *   pnpm db:prune-devices --apply --keep-per-user 2 --older-than-days 7
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

const { Pool } = pg;

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.resolve(dir, '..');
  }
  return process.cwd();
}

const root = repoRoot();
for (const envName of ['.env.local', '.env']) {
  const envPath = path.join(root, envName);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
}

type Options = {
  apply: boolean;
  keepPerUser: number;
  olderThanDays: number;
  reason: string;
  allowRemote: boolean;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    apply: false,
    keepPerUser: 1,
    olderThanDays: 0,
    reason: 'prune stale test-browser devices (maintenance)',
    allowRemote: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case '--apply':
        opts.apply = true;
        break;
      case '--dry-run':
        opts.apply = false;
        break;
      case '--keep-per-user':
        opts.keepPerUser = Number(next());
        break;
      case '--older-than-days':
        opts.olderThanDays = Number(next());
        break;
      case '--reason':
        opts.reason = next();
        break;
      case '--allow-remote':
        opts.allowRemote = true;
        break;
      case '--help':
      case '-h':
        console.log(
          [
            'usage: pnpm db:prune-devices [--apply] [--keep-per-user N] [--older-than-days N]',
            '',
            '  --apply              delete the rows (default is a dry run)',
            '  --keep-per-user <n>  newest devices kept per user (default 1)',
            '  --older-than-days    only consider devices not seen for N days (default 0)',
            '  --reason <text>      recorded in audit_log for every deleted row',
            '',
            'Never deleted: devices referenced by an entry, and revoked devices.',
          ].join('\n'),
        );
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(opts.keepPerUser) || opts.keepPerUser < 0) {
    throw new Error('--keep-per-user must be a non-negative number');
  }
  if (!Number.isFinite(opts.olderThanDays) || opts.olderThanDays < 0) {
    throw new Error('--older-than-days must be a non-negative number');
  }
  return opts;
}

function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

type Candidate = {
  id: string;
  device_id: string;
  email: string;
  last_seen_at: string;
  device_name: string | null;
};

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const databaseUrl =
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  if (!isLocal(databaseUrl) && !opts.allowRemote) {
    throw new Error('refusing to prune a non-local database without --allow-remote');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    const { rows: before } = await client.query<{
      total: string;
      revoked: string;
      referenced: string;
    }>(
      `select count(*)::text as total,
              count(*) filter (where revoked)::text as revoked,
              (select count(distinct e.device_id)::text from entries e
                where e.device_id is not null) as referenced
         from devices`,
    );

    const { rows: candidates } = await client.query<Candidate>(
      `with ranked as (
         select d.id, d.device_id, d.device_name, d.last_seen_at, d.revoked,
                u.email,
                row_number() over (partition by d.user_id order by d.last_seen_at desc) as rn
           from devices d
           join profiles p on p.id = d.user_id
           join auth.users u on u.id = p.id
       )
       select id, device_id, email, device_name, last_seen_at::text
         from ranked r
        where r.rn > $1
          and not r.revoked
          and not exists (select 1 from entries e where e.device_id = r.device_id)
          and ($2 = 0 or r.last_seen_at < now() - make_interval(days => $2::int))
        order by r.email, r.last_seen_at desc`,
      [opts.keepPerUser, opts.olderThanDays],
    );

    console.log(
      `devices: ${before[0].total} total, ${before[0].revoked} revoked, ${before[0].referenced} device ids referenced by entries`,
    );
    console.log(
      `candidates: ${candidates.length} (keeping newest ${opts.keepPerUser} per user, any referenced or revoked)`,
    );

    const byUser = new Map<string, number>();
    for (const row of candidates) byUser.set(row.email, (byUser.get(row.email) ?? 0) + 1);
    for (const [email, count] of byUser) console.log(`  ${email}: ${count}`);

    if (candidates.length === 0) {
      console.log('nothing to prune');
      return;
    }

    const { rows: actorRows } = await client.query<{ id: string }>(
      "select id from profiles where role = 'owner' and active order by created_at limit 1",
    );
    const actor = actorRows[0]?.id ?? null;

    await client.query('begin');
    let audited = 0;
    for (const row of candidates) {
      await client.query('select log_audit_event($1, $2, $3, $4, $5, $6)', [
        actor,
        'device.prune',
        'devices',
        row.device_id,
        JSON.stringify({ id: row.id, user: row.email, last_seen_at: row.last_seen_at }),
        JSON.stringify({ reason: opts.reason }),
      ]);
      await client.query('delete from devices where id = $1', [row.id]);
      audited += 1;
    }

    if (!opts.apply) {
      await client.query('rollback');
      console.log(`dry run: ${audited} deletion(s) and their audit rows rolled back`);
      return;
    }

    await client.query('commit');

    const { rows: after } = await client.query<{ total: string; orphan_refs: string }>(
      `select (select count(*)::text from devices) as total,
              (select count(distinct e.device_id)::text from entries e
                where e.device_id is not null
                  and not exists (select 1 from devices d where d.device_id = e.device_id)) as orphan_refs`,
    );
    console.log(
      `pruned ${audited} device row(s): ${before[0].total} → ${after[0].total}; audited as device.prune`,
    );
    console.log(`  entry device ids without a registry row: ${after[0].orphan_refs}`);
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
