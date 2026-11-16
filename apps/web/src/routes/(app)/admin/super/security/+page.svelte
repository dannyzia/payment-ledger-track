<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { securityReturnTarget } from '$lib/auth/security-return';
  import { supabase } from '$lib/supabase/client';
  import { session } from '$lib/auth/session.svelte';

  /**
   * Plan 023 step 6 — mandatory TOTP for the platform seat.
   *
   * The browser side is convenience, not authority: a missing factor blocks the
   * panel here, and the token's `aal` claim blocks every `/api/v1/admin/super` route
   * server-side (step 7). Recovery codes are minted by the server, shown once, and
   * stored only as hashes.
   */
  type Phase = 'loading' | 'enrol' | 'challenge' | 'codes' | 'done' | 'recover';

  let phase = $state<Phase>('loading');
  let busy = $state(false);
  let errorMessage = $state('');
  let notice = $state('');

  let factorId = $state<string | null>(null);
  let qrCode = $state<string | null>(null);
  let secret = $state<string | null>(null);
  let codeInput = $state('');
  let recoveryInput = $state('');
  let recoveryCodes = $state<string[]>([]);
  let savedConfirmed = $state(false);
  let codesRemaining = $state(0);

  async function accessToken(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function load(): Promise<void> {
    phase = 'loading';
    errorMessage = '';
    const token = await accessToken();
    if (!token) {
      errorMessage = 'No active session. Sign in again.';
      return;
    }

    const res = await fetch('/api/v1/admin/super/security', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      errorMessage =
        res.status === 403
          ? 'This screen belongs to the platform seat only.'
          : 'Could not read your 2FA state.';
      phase = 'loading';
      return;
    }

    const data = await res.json();
    codesRemaining = Number(data.recoveryCodesRemaining ?? 0);
    await session.refreshAssurance();

    // A new session on an account that already holds a factor goes straight to the
    // challenge, which needs the factor's id. Enrolment was the only place setting it,
    // so without this a signed-in seat could see the code box, type a correct code and
    // have nothing happen: verifyCode returned early and never reached aal2.
    if (data.factors === true) {
      const { data: listed } = await supabase.auth.mfa.listFactors();
      factorId = listed?.totp?.find((factor) => factor.status === 'verified')?.id ?? null;
    }

    // The guard sends a seat here when its assurance level is not yet proven, and
    // names the screen it refused. If this session turns out to be aal2 already,
    // there is nothing to do here: return to that screen instead of making the user
    // click through a page that only says the factor is proven. Only same-app
    // platform paths are accepted, so the parameter cannot redirect off-site.
    const target = securityReturnTarget(page.url.searchParams.get('from'));
    if (session.aal === 'aal2' && codesRemaining > 0 && target) {
      await goto(target);
      return;
    }

    await route(data.factors === true);
  }

  async function route(enrolled: boolean): Promise<void> {
    if (!enrolled) {
      phase = 'enrol';
      return;
    }
    if (session.aal === 'aal2') {
      if (codesRemaining > 0) phase = 'done';
      else await generateCodes();
      return;
    }
    phase = 'challenge';
  }

  async function startEnrolment(): Promise<void> {
    busy = true;
    errorMessage = '';
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Super Admin',
      });
      if (error) throw new Error(error.message);
      factorId = data.id;
      qrCode = data.totp.qr_code;
      secret = data.totp.secret;
      phase = 'enrol';
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Enrolment failed.';
    } finally {
      busy = false;
    }
  }

  async function verifyCode(): Promise<void> {
    if (!factorId) {
      errorMessage = 'No verified authenticator was found for this account. Use a recovery code.';
      return;
    }
    busy = true;
    errorMessage = '';
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      });
      if (challengeError) throw new Error(challengeError.message);

      const { error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: codeInput.trim(),
      });
      if (error) throw new Error(error.message);

      codeInput = '';
      await session.refreshAssurance();
      await generateCodes();
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'That code was not accepted.';
    } finally {
      busy = false;
    }
  }

  async function generateCodes(): Promise<void> {
    busy = true;
    errorMessage = '';
    try {
      const token = await accessToken();
      const res = await fetch('/api/v1/admin/super/security', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data.message as string) || 'Could not issue recovery codes.');
      recoveryCodes = (data.codes as string[]) ?? [];
      codesRemaining = recoveryCodes.length;
      savedConfirmed = false;
      phase = 'codes';
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Could not issue recovery codes.';
      phase = 'done';
    } finally {
      busy = false;
    }
  }

  async function useRecoveryCode(): Promise<void> {
    busy = true;
    errorMessage = '';
    notice = '';
    try {
      const token = await accessToken();
      const res = await fetch('/api/v1/admin/super/security', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: recoveryInput }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          res.status === 403
            ? 'That recovery code is not valid or has already been used.'
            : ((data.message as string) ?? 'Recovery failed.'),
        );
      }
      recoveryInput = '';
      codesRemaining = 0;
      notice = 'Your authenticator was cleared. Enrol a new one now.';
      await session.refreshAssurance();
      phase = 'enrol';
      factorId = null;
      qrCode = null;
      secret = null;
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Recovery failed.';
    } finally {
      busy = false;
    }
  }

  function finish(): void {
    // Return to the screen the guard refused, when it named one (same-app platform
    // paths only). Otherwise the seat lands where it always did.
    goto(securityReturnTarget(page.url.searchParams.get('from')) ?? '/dashboard');
  }

  onMount(() => {
    void load();
  });
</script>

<div class="max-w-2xl mx-auto p-6">
  <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Two-factor authentication</h1>
  <p class="text-xs text-[var(--muted)] mt-1 mb-6">
    The platform seat requires an authenticator app. No platform route opens until it is enrolled
    and this session has proven it.
  </p>

  {#if errorMessage}
    <div
      role="alert"
      class="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs font-medium"
    >
      {errorMessage}
    </div>
  {/if}

  {#if notice}
    <div
      role="status"
      class="p-3 mb-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs font-medium"
    >
      {notice}
    </div>
  {/if}

  {#if phase === 'loading'}
    <p class="text-sm text-[var(--muted)]">Checking your factor…</p>
  {/if}

  {#if phase === 'enrol'}
    <div class="glass p-6 rounded-2xl border border-[var(--pearl-border)]">
      <h2 class="text-sm font-semibold text-[var(--ink)] mb-2">
        1. Add the seat to your authenticator
      </h2>

      {#if !qrCode}
        <button
          type="button"
          onclick={startEnrolment}
          disabled={busy}
          class="min-h-[44px] px-4 py-2.5 rounded-xl bg-[var(--ink)] text-[var(--bg)] text-sm font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Start enrolment'}
        </button>
      {:else}
        <div class="flex flex-col items-center gap-4 my-4">
          <!-- qrCode is the SVG Supabase's own MFA enrolment endpoint returns for this
               factor's secret; no user input reaches it, and the manual key below is the
               fallback when it cannot be rendered. -->
          <!-- eslint-disable svelte/no-at-html-tags -->
          <div class="bg-white p-2 rounded-xl">{@html qrCode}</div>
          <!-- eslint-enable svelte/no-at-html-tags -->
          <p class="text-xs text-[var(--muted)]">
            Cannot scan? Enter this key:
            <code class="font-mono text-[var(--ink)] break-all">{secret}</code>
          </p>
        </div>

        <label for="totp-code" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          2. Enter the 6-digit code from the app
        </label>
        <input
          id="totp-code"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          bind:value={codeInput}
          class="w-full px-4 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm tracking-[0.3em] font-mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="000000"
        />
        <button
          type="button"
          onclick={verifyCode}
          disabled={busy || codeInput.trim().length < 6}
          class="mt-3 w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[var(--ink)] text-[var(--bg)] text-sm font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Verifying…' : 'Verify and enable'}
        </button>
      {/if}
    </div>
  {/if}

  {#if phase === 'challenge'}
    <div class="glass p-6 rounded-2xl border border-[var(--pearl-border)]">
      <h2 class="text-sm font-semibold text-[var(--ink)] mb-2">Enter a code from your app</h2>
      <p class="text-xs text-[var(--muted)] mb-4">
        You are signed in with your password, but the seat needs its second factor for this session.
      </p>
      <input
        id="totp-challenge"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="6"
        bind:value={codeInput}
        class="w-full px-4 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm tracking-[0.3em] font-mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        placeholder="000000"
      />
      <button
        type="button"
        onclick={verifyCode}
        disabled={busy || codeInput.trim().length < 6}
        class="mt-3 w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[var(--ink)] text-[var(--bg)] text-sm font-semibold hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Verifying…' : 'Continue'}
      </button>
      <button
        type="button"
        onclick={() => {
          phase = 'recover';
          errorMessage = '';
          notice = '';
        }}
        class="mt-3 w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-[var(--pearl-border)] text-sm font-semibold text-[var(--ink)]"
      >
        I lost my authenticator
      </button>
    </div>
  {/if}

  {#if phase === 'recover'}
    <div class="glass p-6 rounded-2xl border border-[var(--pearl-border)]">
      <h2 class="text-sm font-semibold text-[var(--ink)] mb-2">Use a recovery code</h2>
      <p class="text-xs text-[var(--muted)] mb-4">
        Each code works once. Using one clears your authenticator so you can enrol a new one
        immediately; if you have no codes left, an operator must reset the factor.
      </p>
      <input
        id="recovery-code"
        autocomplete="one-time-code"
        bind:value={recoveryInput}
        class="w-full px-4 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        placeholder="XXXX-XXXX-XXXX"
      />
      <button
        type="button"
        onclick={useRecoveryCode}
        disabled={busy || recoveryInput.trim().length < 4}
        class="mt-3 w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[var(--ink)] text-[var(--bg)] text-sm font-semibold hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Checking…' : 'Use this code'}
      </button>
    </div>
  {/if}

  {#if phase === 'codes'}
    <div class="glass p-6 rounded-2xl border border-[var(--pearl-border)]">
      <h2 class="text-sm font-semibold text-[var(--ink)] mb-2">Save your recovery codes</h2>
      <p class="text-xs text-[var(--muted)] mb-4">
        Shown once. They are stored hashed and cannot be displayed again. Keep them somewhere
        offline.
      </p>
      <ol class="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-sm text-[var(--ink)] mb-4">
        {#each recoveryCodes as code}
          <li class="px-3 py-2 rounded-lg bg-white/60 dark:bg-black/30 tracking-wider">{code}</li>
        {/each}
      </ol>
      <label class="flex items-start gap-2 text-xs text-[var(--muted)] mb-3">
        <input type="checkbox" bind:checked={savedConfirmed} class="mt-0.5" />
        I have saved these codes somewhere safe.
      </label>
      <button
        type="button"
        onclick={finish}
        disabled={!savedConfirmed}
        class="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[var(--ink)] text-[var(--bg)] text-sm font-semibold hover:opacity-90 disabled:opacity-50"
      >
        Continue to the dashboard
      </button>
    </div>
  {/if}

  {#if phase === 'done'}
    <div class="glass p-6 rounded-2xl border border-[var(--pearl-border)]">
      <p class="text-sm text-[var(--ink)] mb-2">
        This session has proven your second factor. {codesRemaining} recovery code(s) remain.
      </p>
      <button
        type="button"
        onclick={finish}
        class="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[var(--ink)] text-[var(--bg)] text-sm font-semibold hover:opacity-90"
      >
        Continue to the dashboard
      </button>
    </div>
  {/if}
</div>
