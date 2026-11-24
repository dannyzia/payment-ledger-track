<script lang="ts">
  import { onMount } from 'svelte';

  let downloaded = $state(false);

  function startDownload() {
    downloaded = true;
    const a = document.createElement('a');
    a.href = '/downloads/kumon-ledger-track.apk';
    a.download = 'kumon-ledger-track.apk';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  onMount(() => {
    // Automatically start APK download after short delay for optimal mobile browser UX
    const timer = setTimeout(() => {
      startDownload();
    }, 600);
    return () => clearTimeout(timer);
  });
</script>

<svelte:head>
  <title>Download Kumon Ledger Track Android App</title>
  <!-- Non-JS fallback redirect to direct APK -->
  <meta http-equiv="refresh" content="2; url=/downloads/kumon-ledger-track.apk" />
</svelte:head>

<main class="min-h-screen flex items-center justify-center p-4 sm:p-6 lg:p-8 app-bg">
  <div class="w-full max-w-md flex flex-col gap-5 my-auto">
    <!-- Main Card -->
    <div
      class="glass p-6 sm:p-8 rounded-3xl border border-[var(--pearl-border)] shadow-2xl flex flex-col items-center text-center gap-5"
    >
      <!-- App Icon -->
      <div class="relative">
        <img
          src="/icons/icon-192.png"
          alt="Kumon Ledger Track App Icon"
          class="w-20 h-20 rounded-2xl shadow-lg border-2 border-[#83CDF4]/50 object-cover"
        />
        <div
          class="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-[#83CDF4] text-white flex items-center justify-center shadow-md border-2 border-white dark:border-black"
          title="Android APK"
        >
          <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24">
            <path
              d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4483.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.4116 13.8533 8.125 12 8.125c-1.8533 0-3.5902.2866-5.1368.8247L4.8409 5.4467a.4161.4161 0 00-.5677-.1521.4157.4157 0 00-.1521.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3432-4.1021-2.6889-7.5743-6.1185-9.4396"
            />
          </svg>
        </div>
      </div>

      <!-- Coupon head: navy band with the DOWNLOAD tab-cap -->
      <div class="on-navy w-full -mx-6 sm:-mx-8 px-6 sm:px-8 py-3 text-left">
        <div class="flex items-center gap-3">
          <span class="coupon-tab shrink-0">Download</span>
          <div class="min-w-0">
            <h1 class="text-lg sm:text-xl font-bold tracking-tight text-[var(--ink)]">
              Kumon Ledger Track
            </h1>
            <p class="text-xs text-[var(--muted)] mt-0.5">
              Official Android APK · Version 1.0 · 7.4 MB
            </p>
          </div>
        </div>
      </div>

      <!-- Auto-Download Notice -->
      <div
        class="w-full p-3.5 rounded-2xl bg-sky-500/10 dark:bg-sky-500/15 border border-sky-500/25 flex items-center justify-center gap-2.5 text-xs text-[var(--ink)] font-medium"
      >
        <span class="w-2.5 h-2.5 rounded-full bg-[#0284c7] animate-ping shrink-0"></span>
        <span>
          {#if downloaded}
            Your download has started!
          {:else}
            Starting download automatically…
          {/if}
        </span>
      </div>

      <!-- Manual Download Button -->
      <div class="w-full">
        <a
          href="/downloads/kumon-ledger-track.apk"
          download="kumon-ledger-track.apk"
          onclick={startDownload}
          class="btn-stamp w-full min-h-[48px] px-6 py-3 rounded-[var(--radius)] font-semibold text-sm flex items-center justify-center gap-2"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-5 h-5"
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
          <span>Download APK (7.4 MB)</span>
        </a>
        <p class="text-[11px] text-[var(--muted)] mt-1.5">
          If the download didn't trigger, tap the button above.
        </p>
      </div>

      <!-- Installation Guide Steps -->
      <div class="w-full pt-4 border-t border-[var(--pearl-border)] text-left flex flex-col gap-3">
        <div class="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
          How to install on Android
        </div>

        <div class="space-y-2.5 text-xs text-[var(--ink)]">
          <div class="flex items-start gap-2.5">
            <span
              class="w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5"
            >
              1
            </span>
            <div>
              <strong>Tap "Download anyway"</strong>
              <p class="text-[11px] text-[var(--muted)]">
                Android prompts this standard warning for all direct APK downloads outside Google Play.
              </p>
            </div>
          </div>

          <div class="flex items-start gap-2.5">
            <span
              class="w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5"
            >
              2
            </span>
            <div>
              <strong>Open downloaded file</strong>
              <p class="text-[11px] text-[var(--muted)]">
                Tap the download notification or open <code class="font-mono text-[10px]">kumon-ledger-track.apk</code> from your Downloads folder.
              </p>
            </div>
          </div>

          <div class="flex items-start gap-2.5">
            <span
              class="w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5"
            >
              3
            </span>
            <div>
              <strong>Tap "Install"</strong>
              <p class="text-[11px] text-[var(--muted)]">
                If prompted, toggle "Allow from this source" in settings, then complete installation.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Navigation & Support -->
      <div
        class="w-full pt-4 border-t border-[var(--pearl-border)] flex items-center justify-between text-xs"
      >
        <a
          href="/login"
          class="text-[var(--accent)] hover:underline font-semibold flex items-center gap-1"
        >
          <span>&larr;</span>
          <span>Back to Sign In</span>
        </a>

        <a
          href="https://wa.me/8801613249520?text=Hello%2C%20I%20need%20help%20installing%20the%20Kumon%20Ledger%20Track%20APK."
          target="_blank"
          rel="noopener noreferrer"
          class="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
        >
          WhatsApp Help
        </a>
      </div>
    </div>
  </div>
</main>
