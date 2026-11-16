/**
 * Plan 023 step 6 — where the seat goes after proving its factor.
 *
 * The guard sends a seat whose assurance level is unproven (or unreadable) to
 * `/admin/super/security?from=<refused path>`. That parameter arrives from a URL, so it is
 * attacker-controllable: treating it as a redirect target without checking it turns the
 * security screen into an open redirect. Only a same-app, absolute path under `/admin/`
 * is accepted; anything else falls back to the caller's own default.
 *
 * Rejected on purpose:
 *  - `//host` (protocol-relative) and `https://host` (absolute) — off-site;
 *  - a path with a `..` segment — the browser would resolve it out of `/admin/`;
 *  - raw whitespace or a backslash — browsers and servers disagree about normalising
 *    these, which is how `/\evil.com` style bypasses happen.
 *
 * A query string is allowed and preserved: `/admin/super/ledger?centerId=…` is a real
 * return path, and dropping its query would land the seat on an unfiltered screen.
 */
export function securityReturnTarget(from: string | null | undefined): string | null {
  if (!from) return null;
  const underAdmin = from === '/admin' || from.startsWith('/admin/');
  if (!underAdmin || from.startsWith('//')) return null;
  if (/[\\\s]/.test(from)) return null;
  if (from.split(/[?#]/, 1)[0].split('/').includes('..')) return null;
  return from;
}
