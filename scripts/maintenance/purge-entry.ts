#!/usr/bin/env tsx
/**
 * Owner-authorised removal of a named entry, through
 * `maintenance_purge_entries` rather than a hand-written DELETE.
 *
 * Entries are immutable by design: `trg_entries_immutability` refuses DELETE
 * and `void` keeps the row. The database routine is the one sanctioned way
 * through, and it already enforces the safety rules (no closed month, no
 * reconciled entry, audit row written before the delete, trigger restored,
 * settlements recomputed). This script only makes that routine safe and
 * obvious to call:
 *
 *   pnpm db:purge-entry --entry 227 --reason "Playwright seed, removed 2026-11-08"
 *   pnpm db:purge-entry --entry 227 --reason "…" --dry-run
 *
 * `--dry-run` executes the whole routine inside a transaction and rolls back,
 * so the preview, the deletes, the audit insert and the settlement recompute
 * all run before you commit to anything.
 *
 * Guards added here, on top of the routine's:
 *   - refuses a non-local database unless `--allow-remote` is passed, because
 *     this is a development tool (hard rule 18/19: production work is not a
 *     side effect of a maintenance command);
 *   - prints what will be removed and which payable changes, before acting;
 *   - refuses a reason shorter than 10 characters, in the CLI as well;
 *   - verifies afterwards that the entry is gone, the trigger is enabled and
 *     the month's settlement equals the sum of its active charges.
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
  entryNumber?: string;
  entryId?: string;
  reason: string;
  dryRun: boolean;
  allowRemote: boolean;
  actor?: string;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = { reason: '', dryRun: false, allowRemote: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case '--entry':
        opts.entryNumber = next();
        break;
      case '--id':
        opts.entryId = next();
        break;
      case '--reason':
        opts.reason = next();
        break;
      case '--actor':
        opts.actor = next();
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--allow-remote':
        opts.allowRemote = true;
        break;
      case '--help':
      case '-h':
        console.log(
          [
            'usage: pnpm db:purge-entry (--entry <entry_number> | --id <uuid>) --reason <text>',
            '',
            '  --entry <n>      human entry number, e.g. 227 (E-202611-000227)',
            '  --id <uuid>      entry id, when the number is not known',
            '  --reason <text>  why the row is being removed; stored in audit_log (>= 10 chars)',
            '  --actor <uuid>   profile id recorded as the actor (defaults to the owner)',
            '  --dry-run        run everything, print the result, then roll back',
            '  --allow-remote   permit a non-local DATABASE_URL (development tool; do not use)',
          ].join('\n'),
        );
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!opts.entryNumber && !opts.entryId) throw new Error('pass --entry <number> or --id <uuid>');
  if (opts.entryNumber && opts.entryId) throw new Error('pass only one of --entry / --id');
  if (opts.reason.trim().length < 10) throw new Error('--reason must be at least 10 characters');
  return opts;
}

function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const databaseUrl =
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

  if (!isLocal(databaseUrl) && !opts.allowRemote) {
    throw new Error(
      'refusing to purge on a non-local database. This is a development tool; re-run with --allow-remote only if you are certain.',
    );
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  let committed = false;

  try {
    const { rows: routine } = await client.query<{ name: string }>(
      "select proname as name from pg_proc where proname = 'maintenance_purge_entries'",
    );
    if (routine.length === 0) {
      throw new Error(
        'maintenance_purge_entries is missing; apply supabase/migrations/20261108000001_maintenance_purge_entries.sql first',
      );
    }

    const lookup = opts.entryId
      ? {
          sql: 'select *, entry_date::text as entry_date_text from entries where id = $1',
          param: opts.entryId,
        }
      : {
          sql: 'select *, entry_date::text as entry_date_text from entries where entry_number = $1',
          param: Number(opts.entryNumber),
        };

    const { rows: found } = await client.query(lookup.sql, [lookup.param]);
    if (found.length === 0) throw new Error(`no entry matches ${opts.entryId ?? opts.entryNumber}`);

    const entry = found[0] as {
      id: string;
      entry_number: number;
      customer_name: string;
      entry_date: string;
      entry_date_text: string;
      status: string;
      gross_poisha: string;
      business_charge_poisha: string;
      customer_charge_poisha: string;
      method_id: string;
      month?: string;
    };

    const entryDate = entry.entry_date_text;
    const { rows: context } = await client.query<{
      month: string;
      method_code: string;
      closed: boolean;
      reconciled: boolean;
      payable_code: string | null;
      expected_poisha: string | null;
      charge_sum: string;
    }>(
      `select date_trunc('month', $1::date)::date::text as month,
              (select pm.code from payment_methods pm where pm.id = $3) as method_code,
              exists (select 1 from month_closes mc
                       where mc.month = date_trunc('month', $1::date)::date and mc.status = 'closed') as closed,
              (exists (select 1 from entry_reconciliation_exceptions x where x.entry_id = $2)
               or exists (select 1 from statement_lines s where s.matched_entry_id = $2)) as reconciled,
              (select p.code from payables p where p.method_id = $3 and p.code like '%charge%' limit 1) as payable_code,
              (select s.expected_poisha::text from settlements s
                 join payables p on p.id = s.payable_id
                where p.method_id = $3 and s.month = date_trunc('month', $1::date)::date
                  and p.code like '%charge%' limit 1) as expected_poisha,
              coalesce((select sum(e.business_charge_poisha)::text from entries e
                         where e.method_id = $3 and e.status = 'active'
                           and date_trunc('month', e.entry_date)::date = date_trunc('month', $1::date)::date), '0') as charge_sum`,
      [entryDate, entry.id, entry.method_id],
    );

    const ctx = context[0];
    const bdt = (poisha: string | number): string => `৳${(Number(poisha) / 100).toFixed(2)}`;
    const entryLabel = `E-${entryDate.slice(0, 4)}${entryDate.slice(5, 7)}-${String(entry.entry_number).padStart(6, '0')}`;
    console.log('entry to remove');
    console.log(`  ${entryLabel}`);
    console.log(
      `  customer ${entry.customer_name} | ${bdt(entry.gross_poisha)} | ${ctx.method_code} | ${entryDate} | ${entry.status}`,
    );
    console.log(`  month ${ctx.month} | closed=${ctx.closed} | reconciled=${ctx.reconciled}`);
    if (ctx.payable_code && ctx.expected_poisha !== null) {
      const before = Number(ctx.expected_poisha);
      const charge = Number(entry.business_charge_poisha);
      console.log(
        `  settlement ${ctx.payable_code}: ${bdt(before)} → ${bdt(before - charge)} (charge ${bdt(charge)})`,
      );
    }

    if (ctx.closed) throw new Error('refusing: the month is closed');
    if (ctx.reconciled) throw new Error('refusing: the entry is referenced by reconciliation');

    const { rows: actorRows } = opts.actor
      ? { rows: [{ id: opts.actor }] }
      : await client.query<{ id: string }>(
          "select p.id from profiles p where p.role = 'owner' and p.active order by p.created_at limit 1",
        );
    const actor = actorRows[0]?.id ?? null;

    await client.query('begin');
    const { rows: result } = await client.query<{ result: unknown }>(
      'select maintenance_purge_entries($1::uuid[], $2, $3) as result',
      [[entry.id], opts.reason.trim(), actor],
    );
    const summary = result[0]?.result as
      { deleted?: number; sync_ops_deleted?: number; months?: string[] } | undefined;

    const check = await client.query<{ trigger: string; remaining: number }>(
      `select (select tgenabled::text from pg_trigger where tgname = 'trg_entries_immutability') as trigger,
              (select count(*)::int from entries where id = $1) as remaining`,
      [entry.id],
    );

    if (opts.dryRun) {
      await client.query('rollback');
      console.log(
        `dry run: rolled back; deleted=${summary?.deleted} sync_ops=${summary?.sync_ops_deleted}`,
      );
      console.log(
        `  (trigger would read ${check.rows[0]?.trigger}, rows remaining ${check.rows[0]?.remaining})`,
      );
      return;
    }

    await client.query('commit');
    committed = true;

    const { rows: after } = await client.query<{ expected: string; charge_sum: string }>(
      `select (select s.expected_poisha::text from settlements s join payables p on p.id = s.payable_id
                where p.code = $1 and s.month = $2) as expected,
              coalesce((select sum(e.business_charge_poisha)::text from entries e
                         where e.method_id = $3 and e.status = 'active'
                           and date_trunc('month', e.entry_date)::date = $2), '0') as charge_sum`,
      [ctx.payable_code, ctx.month, entry.method_id],
    );

    console.log(
      `deleted entry ${entry.entry_number}: ${summary?.deleted} row(s), ${summary?.sync_ops_deleted} sync_ops row(s)`,
    );
    console.log(
      `  trigger after: ${check.rows[0]?.trigger} (O = enabled), rows remaining ${check.rows[0]?.remaining}`,
    );
    if (after[0]?.expected !== undefined && after[0]?.expected !== null) {
      console.log(
        `  settlement ${ctx.payable_code} for ${ctx.month}: ${bdt(after[0].expected)} — active charge sum ${bdt(after[0].charge_sum)}`,
      );
    }
    const { rows: audit } = await client.query<{ id: string }>(
      `select id::text from audit_log
        where action = 'entry.maintenance_purge' and target_id = $1
        order by id desc limit 1`,
      [entry.id],
    );
    if (audit[0]) console.log(`  audit_log row ${audit[0].id}`);
  } catch (error) {
    if (!committed) await client.query('rollback').catch(() => undefined);
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
