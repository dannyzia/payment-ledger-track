/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ensureSession = vi.fn(async () => false);

vi.mock('$lib/auth/session.svelte', () => ({ session: { ensureSession } }));
vi.mock('./push', () => ({ flushOutboxPush: vi.fn() }));
vi.mock('./pull', () => ({ executeIncrementalPull: vi.fn() }));

const { flushOutboxPush } = await import('./push');
const { executeIncrementalPull } = await import('./pull');
const { SyncRunner } = await import('./runner.svelte');

describe('Sync runner status handling (CLT-R-015, CLT-R-016)', () => {
  let runner: InstanceType<typeof SyncRunner>;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new SyncRunner();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('treats a missing session as signed out, never as a sync error', async () => {
    vi.mocked(flushOutboxPush).mockResolvedValue({
      success: false,
      pushedCount: 0,
      reason: 'no_session',
    });

    await runner.triggerCycle();

    expect(ensureSession).toHaveBeenCalledTimes(1);
    expect(runner.status).toBe('signed_out');
    // PRD §9.1: pull only runs after a successful push.
    expect(executeIncrementalPull).not.toHaveBeenCalled();
  });

  it('still reports an ordinary push failure as an error', async () => {
    vi.mocked(flushOutboxPush).mockResolvedValue({ success: false, pushedCount: 0 });

    await runner.triggerCycle();

    expect(runner.status).toBe('error');
    expect(ensureSession).not.toHaveBeenCalled();
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
