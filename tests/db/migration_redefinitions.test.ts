import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the class of regression that broke the seat's void.
 *
 * `20261114000008_super_admin_panel.sql` re-created `rpc_push_sync_op` from the 0005
 * body to add its suspension guard. It sorts after `20261029000009`, so the later
 * `create or replace` silently replaced the seat-aware body 0009 had installed: the
 * platform membership allowance, the device-presence exemption and the `void_entry`
 * role gate vanished, and the seat's void answered `403 unauthorized` on any database
 * built from the migrations in filename order.
 *
 * Applying migrations in order means the last definition wins, and nothing in SQL
 * complains when a later file drops a branch an earlier one added. Behavioural tests
 * catch a revert only after the database is built; this suite reads the files, so a
 * newly added migration that copies an old body fails here immediately — before it
 * reaches a database at all.
 *
 * The rule: when a function is re-issued, the definition that survives must still
 * contain the behaviour each earlier re-issue introduced. Tokens are chosen from the
 * behaviour, not from formatting, so a rewrite of the body keeps passing as long as
 * the branch is intact.
 */

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations', import.meta.url));

interface Definition {
  file: string;
  body: string;
}

/** Functions defined more than once, and the behaviour the surviving body must keep. */
const REISSUED: Record<
  string,
  {
    /** Literal fragments the last definition must contain, with what each one is. */
    requires: Array<[token: string, behaviour: string]>;
  }
> = {
  rpc_push_sync_op: {
    requires: [
      ['fn_center_write_block_reason', 'the suspension guard (20261114000008)'],
      ["'super_admin'", 'the platform seat allowance (20261029000009)'],
      ["'void_entry'", 'the void_entry branch the seat reaches'],
      ['actor_role', 'the actor_role field on the entry.create audit payload'],
    ],
  },
  rpc_supersede_entry: {
    requires: [["'super_admin'", 'the seat may supersede (20261029000009)']],
  },
  purge_expired_sync_ops: {
    requires: [
      ['retention_offset', 'a withheld centre keeps its retention clock (20261114000008)'],
    ],
  },
  admin_manage_user: {
    requires: [
      ["v_caller_role = 'super_admin'", 'the platform seat manages people (20261029000008)'],
    ],
  },
  admin_manage_device: {
    requires: [
      ["v_caller_role = 'super_admin'", 'the platform seat revokes devices (20261029000008)'],
    ],
  },
};

/** The file whose body must be the one that survives for the seat-aware push RPC. */
const PUSH_RPC_OWNER = '20261116000010_push_rpc_seat_authoritative.sql';

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/** Every `create or replace function <name>` in the migrations, in filename order. */
function definitions(name: string): Definition[] {
  const pattern = new RegExp(`create or replace function\\s+${name}\\s*\\(`, 'i');
  const found: Definition[] = [];

  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
    const match = pattern.exec(sql);
    if (!match) continue;

    // The body runs from the CREATE to the closing `$$;` of that function. Slicing it
    // matters: a token elsewhere in the same file (a comment, another function) must
    // not satisfy the check.
    const start = match.index;
    const end = sql.indexOf('$$;', start);
    found.push({ file, body: sql.slice(start, end === -1 ? sql.length : end + 3) });
  }

  return found;
}

describe('migrations that re-issue a function', () => {
  it('keeps the seat-aware rpc_push_sync_op as the definition that sorts last', () => {
    const defs = definitions('rpc_push_sync_op');
    const last = defs.at(-1);

    expect(last, 'rpc_push_sync_op is not defined in any migration').toBeDefined();
    expect(
      last!.file,
      `the last definition of rpc_push_sync_op is in ${last!.file}; it must be ${PUSH_RPC_OWNER}, ` +
        'because a body re-created in a later file is what dropped the seat allowance before',
    ).toBe(PUSH_RPC_OWNER);
  });

  it('does not re-create rpc_push_sync_op in the panel migration', () => {
    // 20261114000008 sorts after 0009 and before the authoritative file; a copy here is
    // exactly the shape of the original defect, even while 00010 still wins.
    const defs = definitions('rpc_push_sync_op').map((definition) => definition.file);
    expect(defs).not.toContain('20261114000008_super_admin_panel.sql');
  });

  it.each(Object.keys(REISSUED))('keeps the behaviour earlier migrations gave %s', (name) => {
    const defs = definitions(name);
    expect(defs.length, `${name} is no longer defined more than once`).toBeGreaterThan(1);

    const winner = defs.at(-1)!;
    const missing = REISSUED[name]!.requires.filter(([token]) => !winner.body.includes(token)).map(
      ([token, behaviour]) => `${behaviour} — expected \`${token}\``,
    );

    expect(
      missing,
      `the surviving definition of ${name} in ${winner.file} has lost behaviour an earlier ` +
        `migration added. Files that define it: ${defs.map((d) => d.file).join(', ')}`,
    ).toEqual([]);
  });
});
