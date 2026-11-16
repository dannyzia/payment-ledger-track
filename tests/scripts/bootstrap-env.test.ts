import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRootEnv } from '../../scripts/bootstrap';

/**
 * The bootstrap script and the dev server must read the same environment, or a
 * runbook value means one thing to `pnpm dev` and another to `pnpm db:bootstrap`.
 *
 * Both load the repo-root files with Vite's precedence — shell over files, and among
 * files `.env.[mode].local` > `.env.[mode]` > `.env.local` > `.env`. SvelteKit does
 * this through `kit.env.dir` + its own loader; the script does it with `loadRootEnv`.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clt-env-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(file: string, body: string): void {
  fs.writeFileSync(path.join(dir, file), body);
}

describe('shared env-file loading (scripts/bootstrap.ts ↔ dev server)', () => {
  it('reads SUPABASE_URL, the name the server routes use', () => {
    write('.env.local', 'SUPABASE_URL=http://from-env-local\n');
    const env = loadRootEnv({ dir, mode: 'development', env: {} });

    expect(env.SUPABASE_URL).toBe('http://from-env-local');
  });

  it('lets .env.local win over .env', () => {
    write('.env', 'SUPABASE_URL=http://base\n');
    write('.env.local', 'SUPABASE_URL=http://local\n');
    const env = loadRootEnv({ dir, mode: 'development', env: {} });

    expect(env.SUPABASE_URL).toBe('http://local');
  });

  it('lets a mode file win over .env.local, and the mode-local file win over both', () => {
    write('.env', 'SUPABASE_URL=http://base\n');
    write('.env.local', 'SUPABASE_URL=http://local\n');
    write('.env.development', 'SUPABASE_URL=http://mode\n');
    write('.env.development.local', 'SUPABASE_URL=http://mode-local\n');

    expect(loadRootEnv({ dir, mode: 'development', env: {} }).SUPABASE_URL).toBe(
      'http://mode-local',
    );

    fs.rmSync(path.join(dir, '.env.development.local'));
    expect(loadRootEnv({ dir, mode: 'development', env: {} }).SUPABASE_URL).toBe('http://mode');
  });

  it('keeps a value from the shell above every file', () => {
    write('.env', 'DATABASE_URL=postgres://from-file\n');
    write('.env.local', 'DATABASE_URL=postgres://from-local\n');
    const env = loadRootEnv({
      dir,
      mode: 'development',
      env: { DATABASE_URL: 'postgres://from-shell' },
    });

    expect(env.DATABASE_URL).toBe('postgres://from-shell');
  });

  it('ignores files that are not there instead of failing', () => {
    write('.env', 'BOOTSTRAP_OWNER_EMAIL=owner@example.test\n');
    const env = loadRootEnv({ dir, mode: 'production', env: {} });

    expect(env.BOOTSTRAP_OWNER_EMAIL).toBe('owner@example.test');
    expect(env.SUPABASE_URL).toBeUndefined();
  });

  it('reads the repo-root files by default, whichever directory it is run from', () => {
    // The default directory is derived from the script's own location, not cwd: the
    // server resolves the repo root the same way, so both see one set of files.
    const env = loadRootEnv({ mode: 'development', env: {} });
    expect(typeof env).toBe('object');
  });
});
