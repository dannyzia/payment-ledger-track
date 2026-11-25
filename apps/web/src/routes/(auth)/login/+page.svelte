<script lang="ts">
  import { supabase } from '$lib/supabase/client';
  import { session } from '$lib/auth/session.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { messages } from '$lib/i18n/messages';
  import { goto } from '$app/navigation';

  let email = $state('');
  let password = $state('');
  let showPassword = $state(false);
  let loading = $state(false);
  let errorMessage = $state('');

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    errorMessage = '';

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data.session) {
        await session.syncFromSupabaseSession(data.session);
        // A withheld center is signed out during revalidation (Plan 023 step 3);
        // navigating on would open the shell with no session behind it.
        if (session.user) {
          await session.refreshAssurance();
          // Plan 023 step 6: the platform seat proves its factor before the panel opens.
          if (session.user.role === 'super_admin' && session.aal !== 'aal2') {
            goto('/admin/super/security');
          } else {
            goto('/dashboard');
          }
        }
      }
    } catch (err: unknown) {
      errorMessage =
        err instanceof Error
          ? err.message || messages.login.invalidCredentials
          : messages.login.invalidCredentials;
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center p-4 sm:p-6 lg:p-10 app-bg">
  <div class="w-full max-w-5xl flex flex-col lg:flex-row gap-6 lg:gap-8 items-stretch my-auto">
    <!-- Portion 1: Sign In (Mobile: Top, Desktop: Left) -->
    <div class="w-full lg:w-5/12 flex flex-col">
      <div
        class="glass p-6 sm:p-8 rounded-2xl border border-[var(--pearl-border)] shadow-xl flex-1 flex flex-col justify-between"
      >
        <div>
          <!-- Header -->
          <div class="flex items-center gap-3 mb-6">
            <img
              src="/icons/icon-192.png"
              alt={messages.login.iconAlt}
              class="w-11 h-11 rounded-xl shadow-sm border border-[#83CDF4]/40 object-cover"
            />
            <div>
              <h1 class="text-xl font-bold tracking-tight text-[var(--ink)]">
                {messages.app.title}
              </h1>
              <p class="text-xs text-[var(--muted)]">{messages.app.subtitle}</p>
            </div>
          </div>

          <!-- Coupon head: navy band with the SIGN IN tab-cap -->
          <div class="on-navy -mx-6 sm:-mx-8 px-6 sm:px-8 py-3 mb-5">
            <div class="flex items-center gap-3">
              <span class="coupon-tab shrink-0">{messages.login.tab}</span>
              <div class="min-w-0">
                <h2 class="text-base font-semibold text-[var(--ink)]">{messages.login.heading}</h2>
                <p class="text-xs text-[var(--muted)] mt-0.5">{messages.login.subheading}</p>
              </div>
            </div>
          </div>

          {#if errorMessage}
            <div
              role="alert"
              class="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs font-medium"
            >
              {errorMessage}
            </div>
          {/if}

          <form onsubmit={handleLogin} class="flex flex-col gap-4">
            <div>
              <label for="login-email" class="block text-xs font-semibold text-[var(--muted)] mb-1">
                {messages.login.emailLabel}
              </label>
              <input
                id="login-email"
                type="email"
                required
                autocomplete="email"
                bind:value={email}
                class="w-full px-4 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                placeholder={messages.login.emailPlaceholder}
              />
            </div>

            <div>
              <label
                for="login-password"
                class="block text-xs font-semibold text-[var(--muted)] mb-1"
              >
                {messages.login.passwordLabel}
              </label>
              <div class="relative flex items-center">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autocomplete="current-password"
                  bind:value={password}
                  class="w-full pl-4 pr-12 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  class="absolute right-0.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--ink)] focus:outline-none"
                  onclick={() => (showPassword = !showPassword)}
                  aria-label={showPassword
                    ? messages.login.hidePassword
                    : messages.login.showPassword}
                  title={showPassword ? messages.login.hidePassword : messages.login.showPassword}
                >
                  {#if showPassword}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
                      />
                    </svg>
                  {:else}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                  {/if}
                </button>
              </div>
            </div>

            <div class="mt-2">
              <Button type="submit" class="btn-stamp w-full min-h-[44px]" {loading}>
                {messages.login.submit}
              </Button>
            </div>
          </form>

          <!-- Android APK Download & QR Scan Section -->
          <div class="mt-5 pt-4 border-t border-[var(--pearl-border)]">
            <div
              class="p-3.5 rounded-2xl bg-sky-500/10 dark:bg-sky-500/15 border border-sky-500/25 flex flex-col gap-3"
            >
              <!-- Top Row: Icon, App Info & Download Button -->
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2.5 min-w-0">
                  <div
                    class="w-9 h-9 rounded-xl bg-[#83CDF4] text-white flex items-center justify-center shrink-0 shadow-sm"
                  >
                    <svg class="w-5 h-5 fill-current" viewBox="0 0 24 24">
                      <path
                        d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4483.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.4116 13.8533 8.125 12 8.125c-1.8533 0-3.5902.2866-5.1368.8247L4.8409 5.4467a.4161.4161 0 00-.5677-.1521.4157.4157 0 00-.1521.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3432-4.1021-2.6889-7.5743-6.1185-9.4396"
                      />
                    </svg>
                  </div>
                  <div class="min-w-0">
                    <div class="text-xs font-bold text-[var(--ink)] truncate">
                      {messages.login.apkTitle}
                    </div>
                    <div class="text-[11px] text-[var(--muted)] truncate">
                      {messages.login.apkMeta}
                    </div>
                  </div>
                </div>

                <a
                  href="/downloads/kumon-ledger-track.apk"
                  download="kumon-ledger-track.apk"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 font-semibold text-xs transition-opacity shadow-sm shrink-0 min-h-[44px]"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  <span>{messages.login.downloadApk}</span>
                </a>
              </div>

              <!-- Bottom Row: QR Code Scan -->
              <div
                class="flex items-center gap-3 p-2.5 rounded-xl bg-white/70 dark:bg-black/30 border border-[var(--pearl-border)]"
              >
                <div class="p-1 rounded-lg bg-white shrink-0 border border-slate-200/80 shadow-sm">
                  <img
                    src="/images/apk-qr.svg"
                    alt={messages.login.qrAlt}
                    class="w-16 h-16 sm:w-18 sm:h-18"
                    width="72"
                    height="72"
                  />
                </div>
                <div class="text-xs text-[var(--muted)] leading-tight">
                  <div class="font-bold text-[var(--ink)] mb-0.5">{messages.login.qrTitle}</div>
                  <p class="text-[11px] text-[var(--muted)] leading-relaxed">
                    {messages.login.qrBody}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-6 pt-4 border-t border-[var(--pearl-border)] text-center">
          <p class="text-xs text-[var(--muted)]">
            <span class="hidden lg:inline">{messages.login.onboardingHintDesktop} &rarr;</span>
            <span class="lg:hidden">{messages.login.onboardingHintMobile} &darr;</span>
          </p>
        </div>
      </div>
    </div>

    <!-- Portion 2: Sign Up Details & App Write-up (Mobile: Following/Bottom, Desktop: Right) -->
    <div class="w-full lg:w-7/12 flex flex-col">
      <div
        class="glass p-6 sm:p-8 rounded-2xl border border-[var(--pearl-border)] shadow-xl flex-1 flex flex-col justify-between gap-6"
      >
        <!-- Header & App Overview -->
        <div>
          <div class="flex flex-wrap items-center justify-end gap-2 mb-3">
            <span class="text-[10px] carbon-nums text-[var(--muted)]">{messages.login.version}</span
            >
          </div>

          <h2 class="text-xl font-bold tracking-tight text-[var(--ink)] mb-1">
            {messages.login.aboutTitle}
          </h2>
          <div class="text-xs font-semibold text-[var(--accent)] mb-2">
            {messages.login.aboutKicker}
          </div>
          <p class="text-xs sm:text-sm text-[var(--muted)] leading-relaxed">
            {messages.login.description}
          </p>

          <!-- Core Feature Badges -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-4">
            <div
              class="p-2.5 rounded-xl bg-white/40 dark:bg-black/20 border border-[var(--pearl-border)] flex flex-col gap-1"
            >
              <span class="text-base">⚡</span>
              <span class="text-xs font-semibold text-[var(--ink)]">
                {messages.login.features.fastEntryValue}
              </span>
              <span class="text-[10px] text-[var(--muted)]">
                {messages.login.features.fastEntry}
              </span>
            </div>
            <div
              class="p-2.5 rounded-xl bg-white/40 dark:bg-black/20 border border-[var(--pearl-border)] flex flex-col gap-1"
            >
              <span class="text-base">📴</span>
              <span class="text-xs font-semibold text-[var(--ink)]">
                {messages.login.features.offline}
              </span>
              <span class="text-[10px] text-[var(--muted)]">
                {messages.login.features.offlineValue}
              </span>
            </div>
            <div
              class="p-2.5 rounded-xl bg-white/40 dark:bg-black/20 border border-[var(--pearl-border)] flex flex-col gap-1"
            >
              <span class="text-base">🧮</span>
              <span class="text-xs font-semibold text-[var(--ink)]">
                {messages.login.features.splits}
              </span>
              <span class="text-[10px] text-[var(--muted)]">
                {messages.login.features.splitsValue}
              </span>
            </div>
            <div
              class="p-2.5 rounded-xl bg-white/40 dark:bg-black/20 border border-[var(--pearl-border)] flex flex-col gap-1"
            >
              <span class="text-base">⚖️</span>
              <span class="text-xs font-semibold text-[var(--ink)]">
                {messages.login.features.reconciliation}
              </span>
              <span class="text-[10px] text-[var(--muted)]">
                {messages.login.features.reconciliationValue}
              </span>
            </div>
          </div>

          <!-- New Center Sign Up Requirements -->
          <div class="mt-4 pt-3 border-t border-[var(--pearl-border)]">
            <h3 class="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-2">
              {messages.login.registrationTitle}
            </h3>
            <p class="text-xs text-[var(--muted)] mb-2">
              {messages.login.registrationBody}
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-[var(--ink)]">
              <div class="flex items-start gap-1.5">
                <span class="text-[var(--accent)] font-bold">1.</span>
                <span>{messages.login.registrationSteps.centerCode}</span>
              </div>
              <div class="flex items-start gap-1.5">
                <span class="text-[var(--accent)] font-bold">2.</span>
                <span>{messages.login.registrationSteps.address}</span>
              </div>
              <div class="flex items-start gap-1.5">
                <span class="text-[var(--accent)] font-bold">3.</span>
                <span>{messages.login.registrationSteps.owner}</span>
              </div>
              <div class="flex items-start gap-1.5">
                <span class="text-[var(--accent)] font-bold">4.</span>
                <span
                  >{messages.login.registrationSteps.license}
                  <span class="text-[var(--muted)]"
                    >{messages.login.registrationSteps.optional}</span
                  ></span
                >
              </div>
            </div>
          </div>
        </div>

        <!-- Contact Channels & Support -->
        <div
          class="pt-3 border-t border-[var(--pearl-border)] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-black/5 dark:bg-white/5 -mx-6 -mb-6 sm:-mx-8 sm:-mb-8 p-4 sm:p-6 rounded-b-2xl"
        >
          <div class="text-xs text-[var(--muted)]">
            <div class="font-semibold text-[var(--ink)]">{messages.login.supportTitle}</div>
            <div class="text-[11px]">{messages.login.supportMeta}</div>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <a
              href="https://wa.me/8801613249520?text=Hello%2C%20I%20would%20like%20to%20register%20a%20new%20center%20for%20Kumon%20Ledger%20Track."
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs shadow-sm transition-colors min-h-[44px]"
            >
              <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path
                  d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"
                />
              </svg>
              <span>+8801613249520</span>
            </a>

            <a
              href="mailto:admin@klt.digital-papyrus.com?subject=Kumon%20Ledger%20Track%20-%20Center%20Registration%20%2F%20Support"
              class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-medium text-xs shadow-sm transition-colors min-h-[44px]"
            >
              <svg class="w-4 h-4 fill-none stroke-current" stroke-width="2" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <span>admin@klt.digital-papyrus.com</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
