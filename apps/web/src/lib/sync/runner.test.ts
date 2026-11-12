/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionState = vi.hoisted(() => ({
  ensureSession: vi.fn(async () => false),
  user: null as null | { role: string; centerId: string | null },
}));

vi.mock('$lib/auth/session.svelte', () => ({
  session: {
    ensureSession: sessionState.ensureSession,
    get user() {
      return sessionState.user;
    },
  },
}));
vi.mock('./push', () => ({ flushOutboxPush: vi.fn() }));
vi.mock('./pull', () => ({ executeIncrementalPull: vi.fn() }));

const { flushOutboxPush } = await import('./push');
const { executeIncrementalPull } = await import('./pull');
const { SyncRunner } = await import('./runner.svelte');

describe('Sync runner status handling (CLT-R-015, CLT-R-016, CLT-R-026)', () => {
  let runner: InstanceType<typeof SyncRunner>;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new SyncRunner();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    sessionState.user = { role: 'staff', centerId: '11111111-1111-1111-1111-111111111111' };
  });

  it('treats a missing session as signed out, never as a sync error', async () => {
    vi.mocked(flushOutboxPush).mockResolvedValue({
      success: false,
      pushedCount: 0,
      reason: 'no_session',
    });

    await runner.triggerCycle();

    expect(sessionState.ensureSession).toHaveBeenCalledTimes(1);
    expect(runner.status).toBe('signed_out');
    // PRD §9.1: pull only runs after a successful push.
    expect(executeIncrementalPull).not.toHaveBeenCalled();
  });

  it('still reports an ordinary push failure as an error and keeps push-before-pull', async () => {
    vi.mocked(flushOutboxPush).mockResolvedValue({ success: false, pushedCount: 0 });

    await runner.triggerCycle();

    expect(runner.status).toBe('error');
    expect(sessionState.ensureSession).not.toHaveBeenCalled();
    // A center session's push can succeed on a later cycle, so the ordering rule
    // still holds: no pull while its ops are unflushed.
    expect(executeIncrementalPull).not.toHaveBeenCalled();
  });

  it('pulls anyway when a centerless session can never push, so stale config still prunes', async () => {
    sessionState.user = { role: 'super_admin', centerId: null };
    vi.mocked(flushOutboxPush).mockResolvedValue({ success: false, pushedCount: 0 });
    vi.mocked(executeIncrementalPull).mockResolvedValue(undefined);

    await runner.triggerCycle();

    // Without a center the push is refused on every cycle; blocking the pull
    // behind it left Head Office config stale, including replaced methods.
    expect(executeIncrementalPull).toHaveBeenCalledTimes(1);
    // The queued ops are still reported rather than papered over as a clean sync.
    expect(runner.status).toBe('error');
  });

  it('reports offline when the pull fails for a centerless session', async () => {
    sessionState.user = { role: 'super_admin', centerId: null };
    vi.mocked(flushOutboxPush).mockResolvedValue({ success: false, pushedCount: 0 });
    vi.mocked(executeIncrementalPull).mockRejectedValue(new Error('network_offline'));

    await runner.triggerCycle();

    expect(runner.status).toBe('offline');
  });

  it('shows offline when the push fails at the transport level', async () => {
    // A dropped link while navigator.onLine still reports true (CLT-R-016).
    vi.mocked(flushOutboxPush).mockRejectedValue(new Error('network_offline'));

    await runner.triggerCycle();

    expect(runner.status).toBe('offline');
    expect(executeIncrementalPull).not.toHaveBeenCalled();
  });

  it('shows offline when the pull fails at the transport level', async () => {
    vi.mocked(flushOutboxPush).mockResolvedValue({ success: true, pushedCount: 0 });
    vi.mocked(executeIncrementalPull).mockRejectedValue(new Error('network_offline'));

    await runner.triggerCycle();

    expect(runner.status).toBe('offline');
  });

  it('syncs normally when the push succeeds', async () => {
    vi.mocked(flushOutboxPush).mockResolvedValue({ success: true, pushedCount: 1 });
    vi.mocked(executeIncrementalPull).mockResolvedValue(undefined);

    await runner.triggerCycle();

    expect(runner.status).toBe('synced');
    expect(executeIncrementalPull).toHaveBeenCalledTimes(1);
  });
});
