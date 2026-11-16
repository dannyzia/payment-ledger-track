import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RequestEvent } from '@sveltejs/kit';
import type { UserRole } from '@clt/shared';
import { hasCapability, hasCenterCapability } from '$lib/capabilities';

/**
 * `/admin/users` belongs to one center: it lists that center's roster, invites into it
 * and moves its ownership. The Platform Super-Admin has no center, so this screen is
 * refused for the seat — by the screen and by the route — and cross-center user
 * management stays on the platform tier's own surface (plan 023 step 15).
 *
 * This pins the decision from both ends: the capability matrix that produces it, and
 * the route's own refusal of a seat caller.
 */

const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCREEN = path.join(APP_ROOT, 'src/routes/(app)/admin/users/+page.svelte');

const ROLES: UserRole[] = ['staff', 'admin', 'owner', 'super_admin'];

const { fakeClient, caller } = vi.hoisted(() => {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'in', 'is']) {
    builder[method] = () => builder;
  }
  builder['then'] = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);

  return {
    fakeClient: {
      from: () => builder,
      auth: {
        admin: {
          listUsers: async () => ({ data: { users: [] }, error: null }),
          getUserById: async (id: string) => ({
            data: { user: { id, email: 'x@y.z' } },
            error: null,
          }),
        },
      },
      rpc: async () => ({ data: null, error: null }),
    },
    caller: { current: null as unknown },
  };
});

vi.mock('$lib/server/supabase', () => ({ getServiceSupabase: () => fakeClient }));
vi.mock('$lib/server/auth', () => ({ getCallerContext: async () => caller.current }));

const { GET, PATCH } = await import('../../src/routes/api/v1/admin/users/+server');

function event(method: 'GET' | 'PATCH'): RequestEvent {
  const url = new URL('http://localhost/api/v1/admin/users');
  return {
    request: new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'PATCH' ? JSON.stringify({ userId: 'u-1', active: false }) : undefined,
    }),
    url,
    params: {},
    locals: {},
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent;
}

async function outcome(run: () => Promise<Response> | Response) {
  try {
    const response = await run();
    return { status: response.status, body: await response.json().catch(() => ({})) };
  } catch (thrown) {
    const httpError = thrown as { status?: number; body?: { message?: string } };
    return { status: httpError.status ?? 500, body: { message: httpError.body?.message } };
  }
}

beforeEach(() => {
  caller.current = null;
});

describe('center user management refuses the platform seat (plan 023)', () => {
  it('holds user.read as a capability but not as a center scope', () => {
    expect(hasCapability('super_admin', 'user.read')).toBe(true);
    expect(hasCenterCapability('super_admin', 'user.read')).toBe(false);

    const centerRoles = ROLES.filter((role) => hasCenterCapability(role, 'user.read'));
    expect(centerRoles).toEqual(['admin', 'owner']);
  });

  it('refuses a super_admin caller on the roster route', async () => {
    caller.current = { userId: 'seat-1', role: 'super_admin', centerId: null, aal: 'aal2' };
    expect((await outcome(() => GET(event('GET')))).status).toBe(403);
  });

  it('refuses a super_admin caller on the update route', async () => {
    caller.current = { userId: 'seat-1', role: 'super_admin', centerId: null, aal: 'aal2' };
    expect((await outcome(() => PATCH(event('PATCH')))).status).toBe(403);
  });

  it('still serves an owner (control, so the refusal is not the mock failing)', async () => {
    caller.current = {
      userId: 'owner-1',
      role: 'owner',
      centerId: '11111111-1111-4111-8111-111111111111',
      aal: 'aal2',
    };
    const result = await outcome(() => GET(event('GET')));
    expect(result.status).toBe(200);
  });

  it('gates the screen on the same center-scoped capability, with an Access Denied branch', () => {
    const source = fs.readFileSync(SCREEN, 'utf8');

    expect(source).toContain("hasCenterCapability(session.user?.role ?? 'staff', 'user.read')");
    expect(source).toContain('{#if !canViewRoster}');
    expect(source).toContain('Access Denied');
    // The seat must not be offered the roster's controls through the unscoped helper.
    expect(source).not.toContain("hasCapability(callerRole as UserRole, 'ownership.transfer')");
    expect(source).not.toContain("hasCapability(callerRole as UserRole, 'user.invite_admin')");
  });
});
