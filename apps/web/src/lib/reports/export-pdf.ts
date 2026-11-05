/**
 * Minimal structural contract for the Capacitor global (no `any` casts, CLT-D-015 pattern).
 */
interface CapacitorWindow {
  Capacitor?: { isNativePlatform?: () => boolean } | undefined;
}

/**
 * Triggers browser print dialog for statement printing or saving as PDF.
 * Styled via clean print CSS rules (@media print) defined in reports/+page.svelte.
 * On mobile/Capacitor environments, this acts as the entrypoint for native print plugin (Plan 019).
 */
export function triggerPrintStatement(): void {
  if (typeof window !== 'undefined') {
    if ((window as unknown as CapacitorWindow).Capacitor?.isNativePlatform?.()) {
      console.info('[Print PDF] Delegating to Capacitor Print plugin in Plan 019');
    }
    window.print();
  }
}
