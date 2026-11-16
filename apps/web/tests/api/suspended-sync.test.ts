import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Plan 023 step 3, at the API boundary.
 *
 * These tests import the real `/api/v1/sync/push` and `/api/v1/sync/pull` handlers
 * and let the real `getCallerContext` run; only the Supabase service client is
 * faked, because that is the process boundary (it would otherwise need a live Auth
 * server and a service-role key). Everything the routes decide — the order of the
 * checks, the status codes, the refusal before any body parsing — is the shipped code.
 *
 * A suspended center's access token stays valid until it expires, so this is where
 * the refusal has to happen: not at token issuance, but on every request.
 */

const CENTER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

type CenterStatus = 'active' | 'suspended' | 'archived';

let centerStatus: CenterStatus = 'active';

vi.mock('$lib/server/supabase', () => ({
  getServiceSupabase: () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: { id: USER_ID, app_metadata: { role: 'owner', center_id: CENTER_ID } },
        },
        error: null,
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data:
              table === 'profiles'
                ? { role: 'owner', active: true, center_id: CENTER_ID }
                : { status: centerStatus },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

const { POST: pushHandler } = await import('../../src/routes/api/v1/sync/push/+server');
const { GET: pullHandler } = await import('../../src/routes/api/v1/sync/pull/+server');

const DEVICE_ID = '33333333-3333-4333-8333-333333333333';

function pushEvent(body: unknown = {}): RequestEvent {
  return {
    request: new Request('http://localhost/api/v1/sync/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    url: new URL('http://localhost/api/v1/sync/push'),
    locals: {},
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent;
}

function pullEvent(query = ''): RequestEvent {
  const url = new URL(`http://localhost/api/v1/sync/pull?deviceId=${DEVICE_ID}${query}`);
  return {
    request: new Request(url, { headers: { Authorization: 'Bearer test-token' } }),
    url,
    locals: {},
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent;
}

/** SvelteKit's `error(status, message)` throws an object carrying the response. */
async function rejection(
  promise: Promise<unknown> | Response,
): Promise<{ status: number; message: string }> {
  try {
    const response = await promise;
    const body = (await (response as Response).json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    return {
      status: (response as Response).status,
      message: body.message ?? body.error ?? '',
    };
  } catch (thrown) {
    const httpError = thrown as { status: number; body: { message: string } };
    return { status: httpError.status, message: httpError.body?.message };
  }
}

describe('Suspended center is refused by the sync API (Plan 023 step 3)', () => {
  beforeEach(() => {
    centerStatus = 'active';
  });

  it('push returns 403 center_suspended before reading the body', async () => {
    centerStatus = 'suspended';

    const result = await rejection(pushHandler(pushEvent({ ops: [] })));

    expect(result.status).toBe(403);
    expect(result.message).toBe('center_suspended');
  });

  it('pull returns 403 center_suspended before parsing the cursor', async () => {
    centerStatus = 'suspended';

    const result = await rejection(pullHandler(pullEvent('&since=0')));

    expect(result.status).toBe(403);
    expect(result.message).toBe('center_suspended');
  });

  it('an archived center is refused with its own code on both routes', async () => {
    centerStatus = 'archived';

    expect(await rejection(pushHandler(pushEvent({ ops: [] })))).toEqual({
      status: 403,
      message: 'center_archived',
    });
    expect(await rejection(pullHandler(pullEvent('&since=0')))).toEqual({
      status: 403,
      message: 'center_archived',
    });
  });

  it('an active center passes the refusal and fails later, on its own validation', async () => {
    // Positive control: without it, these tests would still pass if every call threw.
    const push = await rejection(pushHandler(pushEvent({ not: 'a push body' })));
    expect(push.status).toBe(400);
    expect(push.message).not.toMatch(/center_(suspended|archived)/);

    const pull = await rejection(pullHandler(pullEvent('')));
    expect(pull.status).toBe(400);
    expect(pull.message).not.toMatch(/center_(suspended|archived)/);
  });
});
