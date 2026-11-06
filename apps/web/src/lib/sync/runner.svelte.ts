import { flushOutboxPush } from './push';
import { executeIncrementalPull } from './pull';
import { session } from '$lib/auth/session.svelte';

export type SyncState = 'synced' | 'syncing' | 'offline' | 'error' | 'signed_out';

/**
 * Multi-tab leader-elected client sync runner.
 * Manages the periodic sync loop, coordinates multi-tab execution using the Web Locks API,
 * synchronizes state to follower tabs via BroadcastChannel, and provides reactive Svelte 5 $state.
 */
export class SyncRunner {
  private timer: number | null = null;
  private isBusy = false;
  private isRunning = false;
  private channel: BroadcastChannel | null = null;
  private onlineListener: (() => void) | null = null;
  private offlineListener: (() => void) | null = null;
  private stopLockPromise: (() => void) | null = null;

  // Reactive Svelte 5 status rune
  public status = $state<SyncState>('synced');

  start() {
    if (typeof window === 'undefined' || this.isRunning) return;
    this.isRunning = true;

    if (!navigator.onLine) {
      this.status = 'offline';
    }

    // Set up BroadcastChannel to synchronize sync state across all browser tabs
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('clt-sync-state');
      this.channel.onmessage = (event) => {
        if (event.data?.status) {
          this.status = event.data.status;
        }
      };
    }

    this.onlineListener = () => {
      this.triggerCycle();
    };

    this.offlineListener = () => {
      this.updateStatus('offline');
    };

    window.addEventListener('online', this.onlineListener);
    window.addEventListener('offline', this.offlineListener);

    // Leader Election via Web Locks API
    if (navigator.locks) {
      navigator.locks.request('clt-sync-leader', async () => {
        // Tab acquired leader lock: run periodic timer
        this.triggerCycle(); // Immediate first sync cycle on start

        this.timer = window.setInterval(() => {
          this.triggerCycle();
        }, 15000);

        // Keep lock held until stop() or tab unload
        await new Promise<void>((resolve) => {
          this.stopLockPromise = resolve;
          window.addEventListener('beforeunload', () => resolve(), { once: true });
        });
      });
    } else {
      // Fallback if Web Locks API unavailable
      this.triggerCycle();
      this.timer = window.setInterval(() => {
        this.triggerCycle();
      }, 15000);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.stopLockPromise) {
      this.stopLockPromise();
      this.stopLockPromise = null;
    }
    if (this.onlineListener) {
      window.removeEventListener('online', this.onlineListener);
      this.onlineListener = null;
    }
    if (this.offlineListener) {
      window.removeEventListener('offline', this.offlineListener);
      this.offlineListener = null;
    }
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }

  public updateStatus(newStatus: SyncState) {
    this.status = newStatus;
    if (this.channel) {
      this.channel.postMessage({ status: newStatus });
    }
  }

  async triggerCycle(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.onLine) {
      this.updateStatus('offline');
      return;
    }

    if (this.isBusy) return;
    this.isBusy = true;
    this.updateStatus('syncing');

    try {
      // PRD §9.1: Client sync runner MUST flush /sync/push to completion BEFORE calling /sync/pull
      const pushResult = await flushOutboxPush();
      if (!pushResult.success) {
        if (pushResult.reason === 'no_session') {
          // CLT-R-015: the session disappeared mid-run. Verify and go to
          // /login rather than reporting a sync error over a signed-out shell.
          await session.ensureSession();
          this.updateStatus('signed_out');
          return;
        }
        this.updateStatus('error');
        return;
      }

      await executeIncrementalPull();
      this.updateStatus('synced');
    } catch (err) {
      if (err instanceof Error && err.message === 'network_offline') {
        this.updateStatus('offline');
      } else {
        this.updateStatus('error');
      }
    } finally {
      this.isBusy = false;
    }
  }
}

export const syncRunner = new SyncRunner();
