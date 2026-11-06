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

describe('Sync runner session handling (CLT-R-015)', () => {
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

  it('syncs normally when the push succeeds', async () => {
    vi.mocked(flushOutboxPush).mockResolvedValue({ success: true, pushedCount: 1 });
    vi.mocked(executeIncrementalPull).mockResolvedValue(undefined);

    await runner.triggerCycle();

    expect(runner.status).toBe('synced');
    expect(executeIncrementalPull).toHaveBeenCalledTimes(1);
  });
});
