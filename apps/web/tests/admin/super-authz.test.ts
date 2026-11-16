import { describe, it, expect, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Plan 023 steps 7 and 8 — route authorization for the platform tier.
 *
 * The test enumerates the route files instead of listing them, so a new
 * `/api/v1/admin/super/*` route is covered the moment it is created: a route that
 * forgets its role guard, or its `aal2` gate, fails here rather than in production.
 *
 * Only the Supabase service client is faked (the process boundary). The real
 * `getCallerContext`, `requireRole`, `requireCapability` and `requireAssurance` run,
 * and the tokens carry real `aal` claims so the assurance check is the shipped one.
 */

const CENTER_ID = '11111111-1111-4111-8111-111111111111';

type Role = 'owner' | 'admin' | 'staff' | 'super_admin';
type Aal = 'aal1' | 'aal2';

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** A structurally real JWT: `getCallerContext` decodes the `aal` claim from it. */
function tokenFor(role: Role, aal: Aal = 'aal2'): string {
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: `user-${role}`,
    role,
    aal,
    center_id: role === 'super_admin' ? null : CENTER_ID,
  })}.signature`;
}

/**
 * A seat token whose assurance level cannot be read: the claim is simply absent, which is
 * what a Supabase token issued before TOTP enrolment, or an older token shape, looks like
 * here. The role claim is present and valid, so only the assurance gate can refuse it.
 */
function tokenWithoutAssurance(role: Role): string {
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: `user-${role}`,
    role,
    center_id: roleCenter(role),
  })}.signature`;
}

/** A seat token whose `aal` claim is present but unreadable (unknown value or wrong type). */
function tokenWithAssurance(role: Role, claim: unknown): string {
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: `user-${role}`,
    role,
    aal: claim,
    center_id: roleCenter(role),
  })}.signature`;
}

function claimsOf(token: string): { sub: string; role: Role; aal: Aal } {
  const payload = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as {
    sub: string;
    role: Role;
    aal: Aal;
  };
}

/**
 * A permissive stand-in for the query builder: any chain resolves to empty data.
 * The seat's requests must reach the route body, so this must not fail on an
 * unanticipated chain.
 */
function queryBuilder(
  single: { data: unknown; error: unknown } = { data: null, error: null },
): unknown {
  const result = { data: [], error: null };
  const builder: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'neq',
    'in',
    'is',
    'or',
    'order',
    'limit',
    'range',
    'update',
    'insert',
    'upsert',
    'delete',
  ]) {
    builder[method] = () => builder;
  }
  builder['single'] = async () => single;
  builder['maybeSingle'] = async () => single;
  builder['then'] = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

vi.mock('$lib/server/supabase', () => ({
  getServiceSupabase: () => ({
    auth: {
      getUser: async (token: string) => {
        try {
          const claims = claimsOf(token);
          return {
            data: {
              user: {
                id: claims.sub,
                app_metadata: { role: claims.role, center_id: roleCenter(claims.role) },
              },
            },
            error: null,
          };
        } catch {
          return { data: { user: null }, error: { message: 'invalid token' } };
        }
      },
      admin: {
        mfa: {
          listFactors: async () => ({ data: { factors: [] }, error: null }),
          deleteFactor: async () => ({ data: null, error: null }),
        },
        listUsers: async () => ({ data: { users: [] }, error: null }),
        getUserById: async (id: string) => ({
          data: { user: { id, app_metadata: {} } },
          error: null,
        }),
        createUser: async () => ({ data: { user: null }, error: null }),
        inviteUserByEmail: async () => ({ data: { user: null }, error: null }),
        updateUserById: async () => ({ data: { user: null }, error: null }),
      },
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return queryBuilder({
          data: {
            role: currentRole,
            active: true,
            center_id: roleCenter(currentRole),
          },
          error: null,
        });
      }
      return queryBuilder();
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}));

function roleCenter(role: Role): string | null {
  return role === 'super_admin' ? null : CENTER_ID;
}

/** The mocked profile row mirrors the token's role; each test sets this first. */
let currentRole: Role = 'staff';

const routeModules = import.meta.glob<Record<string, unknown>>(
  '/src/routes/api/v1/admin/super/**/+server.ts',
);

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

type Handler = (event: RequestEvent) => Promise<Response> | Response;

let loaded: Array<{ file: string; module: Record<string, unknown> }> = [];

async function loadAll(): Promise<void> {
  if (loaded.length > 0) return;
  loaded = await Promise.all(
    Object.entries(routeModules).map(async ([file, load]) => ({ file, module: await load() })),
  );
}

function handlersOf(module: Record<string, unknown>): Array<[string, Handler]> {
  return HTTP_METHODS.filter((method) => typeof module[method] === 'function').map((method) => [
    method,
    module[method] as Handler,
  ]);
}

function makeEvent(method: string, token: string): RequestEvent {
  const url = new URL('http://localhost/api/v1/admin/super/test');
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}` } };
  if (method !== 'GET' && method !== 'DELETE') {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = '{}';
  }
  return {
    request: new Request(url, init),
    url,
    params: { id: CENTER_ID },
    locals: {},
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent;
}

/** Normalizes a SvelteKit `error()` throw or a returned Response into status + message. */
async function outcome(
  run: () => Promise<Response> | Response,
): Promise<{ status: number; message: string }> {
  try {
    const response = await run();
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    return { status: response.status, message: body.message ?? body.error ?? '' };
  } catch (thrown) {
    const httpError = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpError.status !== 'number') {
      // A crash is not a refusal; surface it as such rather than as a pass.
      return { status: 500, message: String((thrown as Error)?.message ?? thrown) };
    }
    return { status: httpError.status, message: httpError.body?.message ?? '' };
  }
}

/** The assurance gate is deliberately absent from the route that creates `aal2`. */
const ASSURANCE_EXEMPT = '/admin/super/security/+server.ts';

describe('Super-admin route authorization (Plan 023 steps 7 and 8)', () => {
  it('enumerates the platform routes from the filesystem', async () => {
    await loadAll();
    const files = loaded.map((entry) => entry.file).sort();

    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.includes('/admin/super/'))).toBe(true);
    console.info(`super-admin routes covered: ${files.length}\n${files.join('\n')}`);
  });

  for (const role of ['owner', 'admin', 'staff'] as const) {
    it(`refuses a valid ${role} token on every super-admin handler`, async () => {
      await loadAll();
      currentRole = role;

      const results: string[] = [];
      let handlers = 0;

      for (const { file, module } of loaded) {
        for (const [method, handler] of handlersOf(module)) {
          handlers += 1;
          const result = await outcome(() => handler(makeEvent(method, tokenFor(role))));
          results.push(`${method} ${file.split('/admin/super/')[1]} → ${result.status}`);
          expect(result.status, `${role} reached ${method} ${file}`).toBe(403);
        }
      }

      expect(handlers, 'no handler was enumerated').toBeGreaterThan(0);
      console.info(`${role}: ${results.length} handler(s) refused\n${results.join('\n')}`);
    });
  }

  it('refuses an aal1 seat with 403 assurance_required on every power route', async () => {
    await loadAll();
    currentRole = 'super_admin';
    const token = tokenFor('super_admin', 'aal1');

    const checked: string[] = [];
    for (const { file, module } of loaded) {
      const exempt = file.endsWith(ASSURANCE_EXEMPT);
      for (const [method, handler] of handlersOf(module)) {
        const result = await outcome(() => handler(makeEvent(method, token)));
        checked.push(`${method} ${file.split('/admin/super/')[1]} → ${result.status}`);

        if (exempt) {
          // The enrolment path must stay reachable, or aal2 could never be obtained.
          expect(
            result.status === 403 && result.message === 'assurance_required',
            `${method} ${file} must not be behind the assurance gate`,
          ).toBe(false);
        } else {
          expect(
            { status: result.status, message: result.message },
            `${method} ${file} let an aal1 session through`,
          ).toEqual({ status: 403, message: 'assurance_required' });
        }
      }
    }

    expect(checked.length).toBeGreaterThan(0);
    console.info(`aal1 seat: ${checked.join('\n')}`);
  });

  it('refuses a seat whose assurance cannot be read at all, on every power route', async () => {
    // `null` is the absence of proof, not a weaker proof. A missing claim, an unknown
    // value and a wrong type all decode to null, and every route that requires aal2 must
    // refuse them — the panel must fail closed when the assurance cannot be determined.
    await loadAll();
    currentRole = 'super_admin';

    const variants: Array<[string, string]> = [
      ['claim absent', tokenWithoutAssurance('super_admin')],
      ['unknown value', tokenWithAssurance('super_admin', 'aal3')],
      ['wrong case', tokenWithAssurance('super_admin', 'AAL2')],
      ['non-string value', tokenWithAssurance('super_admin', 2)],
    ];

    const checked: string[] = [];
    for (const [label, token] of variants) {
      for (const { file, module } of loaded) {
        if (file.endsWith(ASSURANCE_EXEMPT)) continue;
        for (const [method, handler] of handlersOf(module)) {
          const result = await outcome(() => handler(makeEvent(method, token)));
          checked.push(
            `${label}: ${method} ${file.split('/admin/super/')[1]} → ${result.status} ${result.message}`,
          );
          expect(
            { status: result.status, message: result.message },
            `${method} ${file} let a seat with no readable assurance through (${label})`,
          ).toEqual({ status: 403, message: 'assurance_required' });
        }
      }
    }

    expect(checked.length).toBeGreaterThan(0);
    console.info(`unreadable assurance: ${checked.join('\n')}`);
  });

  it('lets an aal2 seat past both gates (control)', async () => {
    await loadAll();
    currentRole = 'super_admin';
    const token = tokenFor('super_admin', 'aal2');

    const checked: string[] = [];
    for (const { file, module } of loaded) {
      for (const [method, handler] of handlersOf(module)) {
        const result = await outcome(() => handler(makeEvent(method, token)));
        checked.push(
          `${method} ${file.split('/admin/super/')[1]} → ${result.status}${
            result.status >= 500 ? ` (${result.message})` : ''
          }`,
        );

        // Without this control the suite would pass even if every call failed.
        const gateRefusal =
          result.status === 403 &&
          /capability_denied|insufficient permissions|assurance_required/.test(result.message);
        expect(gateRefusal, `aal2 seat was refused on ${method} ${file}`).toBe(false);
      }
    }

    expect(checked.length).toBeGreaterThan(0);
    console.info(`aal2 seat control: ${checked.join('\n')}`);
  });
});
