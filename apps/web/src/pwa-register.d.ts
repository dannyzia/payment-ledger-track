// Ambient module declarations for the vite-plugin-pwa virtual modules used by
// this app. Kept in a bare script file (no imports/exports): TypeScript only
// treats `declare module` as an ambient declaration in files without top-level
// export statements (CLT-D-021).
//
// vite-plugin-pwa/client is not resolvable from apps/web under pnpm (transitive
// dep of @vite-pwa/sveltekit), so the needed surface is declared here with the
// same shape as vite-plugin-pwa 0.21's client.d.ts.

declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onRegisteredSW?: (
      swUrl: string,
      registration: ServiceWorkerRegistration | undefined
    ) => unknown;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => unknown;
    onRegisterError?: (error: unknown) => void;
  }

  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
