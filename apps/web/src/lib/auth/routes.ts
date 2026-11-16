// Routes that are reachable without a Supabase session: sign-in, the OAuth
// callback (which is mid-exchange and legitimately has no session yet) and the
// invitation password screen. Everything else lives under the (app) group and
// requires a real session (CLT-R-015).
export function isAuthRoute(pathname: string): boolean {
  return (
    pathname.startsWith('/login') ||
    pathname.startsWith('/callback') ||
    pathname.startsWith('/set-password') ||
    // A withheld center is signed out on purpose, so its screen must stay
    // reachable without a session (Plan 023 step 3).
    pathname.startsWith('/withheld')
  );
}
