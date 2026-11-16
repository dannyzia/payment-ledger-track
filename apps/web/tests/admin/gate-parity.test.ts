import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UserRole } from '@clt/shared';
import {
  ALL_CAPABILITIES,
  canManageUser,
  hasCapability,
  hasCenterCapability,
  type Capability,
} from '$lib/capabilities';

/**
 * Parity between what a screen shows and what the server route behind it allows.
 *
 * The UI gate and the route guard are written in different languages — a capability on
 * one side, an inline `caller.role !== ...` on the other — so they drift silently: the
 * screen offers a button the route refuses (a dead control), or hides one it accepts
 * (staff cannot do their job). Neither shows up in a typecheck.
 *
 * Screens are discovered by scanning source, not listed by hand, so a new screen cannot
 * escape this test: every capability-gated `.svelte` file under `routes/(app)` and
 * `lib/ui` must appear in `DECLARED` below, and an undeclared gate fails the suite with
 * the file and capability to add. A gate call whose capability is not a string literal
 * also fails, rather than being skipped.
 *
 * Route guards are read from source too, because the center routes do not use
 * `requireCapability`: they compare `caller.role` inline. An unrecognised guard shape
 * fails the test instead of being ignored.
 */

const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC_ROOT = path.join(APP_ROOT, 'src');

const ROLES: UserRole[] = ['staff', 'admin', 'owner', 'super_admin'];

type Helper = 'hasCenterCapability' | 'hasCapability' | 'canManageUser';

interface RouteCoverage {
  kind: 'route';
  apiPath: string;
  expected: UserRole[];
  /** True when screen and route should admit exactly the same roles. */
  strict: boolean;
  note?: string;
  /**
   * Roles the screen admits and the route refuses, named one by one with the reason.
   * A known gap is pinned, not forgiven: the suite fails if it disappears or grows.
   */
  knownGaps?: Array<{ role: UserRole; reason: string }>;
}

interface SeatRouteCoverage {
  kind: 'seat-route';
  apiPath: string;
  expected: UserRole[];
}

interface OfflineCoverage {
  kind: 'offline';
  expected: UserRole[];
  reason: string;
}

interface ShellCoverage {
  kind: 'shell';
  expected: UserRole[];
  reason: string;
}

type Coverage = RouteCoverage | SeatRouteCoverage | OfflineCoverage | ShellCoverage;

interface Declared {
  /** File relative to `apps/web/src`. */
  file: string;
  /** Capability id, or the helper name for `canManageUser`. */
  capability: string;
  coverage: Coverage;
}

const DECLARED: Declared[] = [
  // ---- Center screens behind their own route -------------------------------------
  {
    file: 'routes/(app)/months/close/+page.svelte',
    capability: 'month.close',
    coverage: {
      kind: 'route',
      apiPath: '/api/v1/months/close',
      expected: ['owner'],
      strict: true,
    },
  },
  {
    file: 'routes/(app)/months/close/+page.svelte',
    capability: 'month.reopen',
    coverage: {
      kind: 'route',
      apiPath: '/api/v1/months/reopen',
      expected: ['owner'],
      strict: true,
    },
  },
  {
    file: 'lib/ui/ClosedMonthRecoveryModal.svelte',
    capability: 'month.reopen',
    coverage: {
      kind: 'route',
      apiPath: '/api/v1/months/reopen',
      expected: ['owner'],
      strict: true,
    },
  },
  {
    file: 'routes/(app)/settlements/[id]/+page.svelte',
    capability: 'settlement.approve_overpayment',
    coverage: {
      kind: 'route',
      apiPath: '/api/v1/settlements/overpayment-approval',
      expected: ['owner'],
      strict: true,
    },
  },
  {
    file: 'routes/(app)/admin/users/+page.svelte',
    capability: 'ownership.transfer',
    coverage: {
      kind: 'route',
      apiPath: '/api/v1/admin/transfer-ownership',
      expected: ['owner'],
      strict: true,
    },
  },
  {
    file: 'routes/(app)/admin/users/+page.svelte',
    capability: 'user.invite_admin',
    coverage: {
      kind: 'route',
      apiPath: '/api/v1/admin/users',
      expected: ['owner'],
      strict: false,
      note: 'route admits admin; per-target restriction lives in the handler',
    },
  },
  {
    file: 'routes/(app)/admin/users/+page.svelte',
    capability: 'user.read',
    coverage: {
      kind: 'route',
      apiPath: '/api/v1/admin/users',
      expected: ['admin', 'owner'],
      strict: true,
    },
  },
  {
    file: 'routes/(app)/admin/users/+page.svelte',
    capability: 'canManageUser',
    coverage: {
      kind: 'route',
      apiPath: '/api/v1/admin/users',
      expected: ['admin', 'owner'],
      strict: true,
    },
  },
  {
    file: 'routes/(app)/reconcile/+page.svelte',
    capability: 'reconcile.read',
    coverage: {
      kind: 'route',
      apiPath: '/api/v1/reconcile/statements',
      expected: ['admin', 'owner'],
      strict: true,
    },
  },
  {
    file: 'routes/(app)/reconcile/manual/+page.svelte',
    capability: 'reconcile.read',
    coverage: {
      kind: 'route',
      apiPath: '/api/v1/reconcile/statements/reconcile',
      expected: ['admin', 'owner'],
      strict: true,
    },
  },

  // ---- Center screens with no route: Dexie reads, data via sync/pull under RLS ----
  {
    file: 'routes/(app)/reports/+page.svelte',
    capability: 'report.read',
    coverage: {
      kind: 'offline',
      expected: ['admin', 'owner'],
      reason: 'reads Dexie; server data arrives through /api/v1/sync/pull under RLS',
    },
  },
  {
    file: 'routes/(app)/settlements/+page.svelte',
    capability: 'settlement.read',
    coverage: {
      kind: 'offline',
      expected: ['admin', 'owner'],
      reason: 'reads Dexie; payments go through /api/v1/settlements/payments',
    },
  },
  {
    file: 'routes/(app)/settlements/[id]/+page.svelte',
    capability: 'settlement.read',
    coverage: {
      kind: 'offline',
      expected: ['admin', 'owner'],
      reason: 'reads Dexie; receipts go through the signed-url/upload routes',
    },
  },
  {
    file: 'lib/ui/EntryDetailDrawer.svelte',
    capability: 'entry.void',
    coverage: {
      kind: 'offline',
      expected: ['admin', 'owner'],
      reason: 'void is a sync op; the RPC refuses it server-side',
    },
  },

  // ---- Seat screens over super-admin routes (capability must match) ---------------
  {
    file: 'routes/(app)/admin/super/centers/+page.svelte',
    capability: 'center.read_all',
    coverage: {
      kind: 'seat-route',
      apiPath: '/api/v1/admin/super/centers',
      expected: ['super_admin'],
    },
  },
  {
    file: 'routes/(app)/admin/super/search/+page.svelte',
    capability: 'ledger.read_all',
    coverage: {
      kind: 'seat-route',
      apiPath: '/api/v1/admin/super/search',
      expected: ['super_admin'],
    },
  },
  {
    file: 'routes/(app)/admin/super/ledger/+page.svelte',
    capability: 'ledger.read_all',
    coverage: {
      kind: 'seat-route',
      apiPath: '/api/v1/admin/super/ledger',
      expected: ['super_admin'],
    },
  },
  {
    file: 'routes/(app)/admin/super/+page.svelte',
    capability: 'center.read_all',
    coverage: {
      kind: 'seat-route',
      apiPath: '/api/v1/admin/super/dashboard',
      expected: ['super_admin'],
    },
  },
  {
    file: 'routes/(app)/admin/super/users/+page.svelte',
    capability: 'user.read_all',
    coverage: {
      kind: 'seat-route',
      apiPath: '/api/v1/admin/super/users',
      expected: ['super_admin'],
    },
  },
  {
    file: 'routes/(app)/admin/super/devices/+page.svelte',
    capability: 'device.read_all',
    coverage: {
      kind: 'seat-route',
      apiPath: '/api/v1/admin/super/devices',
      expected: ['super_admin'],
    },
  },

  // ---- Shell and navigation gates (no route of their own) -------------------------
  {
    file: 'routes/(app)/dashboard/+page.svelte',
    capability: 'month.close',
    coverage: {
      kind: 'shell',
      expected: ['owner'],
      reason: 'selects the owner dashboard variant',
    },
  },
  {
    file: 'routes/(app)/dashboard/+page.svelte',
    capability: 'report.read',
    coverage: {
      kind: 'shell',
      expected: ['admin', 'owner'],
      reason: 'selects the admin dashboard variant (staff fall through to the staff one)',
    },
  },
  {
    file: 'routes/(app)/+layout.svelte',
    capability: 'center.read_all',
    coverage: {
      kind: 'shell',
      expected: ['super_admin'],
      reason: 'shell badge/context switch for the platform seat',
    },
  },
  {
    file: 'lib/ui/Sidebar.svelte',
    capability: 'center.read_all',
    coverage: {
      kind: 'shell',
      expected: ['super_admin'],
      reason: 'platform nav block',
    },
  },
  {
    file: 'lib/ui/Sidebar.svelte',
    capability: 'ledger.read_all',
    coverage: {
      kind: 'shell',
      expected: ['super_admin'],
      reason: 'platform nav block',
    },
  },
  {
    file: 'lib/ui/Sidebar.svelte',
    capability: 'audit.read_all',
    coverage: {
      kind: 'shell',
      expected: ['super_admin'],
      reason: 'platform nav block',
    },
  },
  {
    file: 'lib/ui/FloatingMenu.svelte',
    capability: 'report.read',
    coverage: {
      kind: 'shell',
      expected: ['admin', 'owner'],
      reason: 'nav link to a screen gated by the same capability',
    },
  },
  {
    file: 'lib/ui/FloatingMenu.svelte',
    capability: 'center.read_all',
    coverage: {
      kind: 'shell',
      expected: ['super_admin'],
      reason: 'platform nav block',
    },
  },
  {
    file: 'lib/ui/FloatingMenu.svelte',
    capability: 'ledger.read_all',
    coverage: {
      kind: 'shell',
      expected: ['super_admin'],
      reason: 'platform nav block',
    },
  },
  {
    file: 'lib/ui/FloatingMenu.svelte',
    capability: 'audit.read_all',
    coverage: {
      kind: 'shell',
      expected: ['super_admin'],
      reason: 'platform nav block',
    },
  },

  // The Sidebar and the command palette render one list (`lib/ui/nav.ts`), so these
  // declarations are the single place that ties each destination to its capability. The
  // palette used to keep a role array per command and the sidebar a role block around five
  // links; either could go stale without a test noticing.
  {
    file: 'lib/ui/nav.ts',
    capability: 'entry.create',
    coverage: {
      kind: 'shell',
      expected: ['staff', 'admin', 'owner'],
      reason: '/entries/new, the screen staff use all day',
    },
  },
  {
    file: 'lib/ui/nav.ts',
    capability: 'entry.read_own',
    coverage: {
      kind: 'shell',
      expected: ['staff', 'admin', 'owner'],
      reason: 'dashboard and ledger; every center-scoped role reads its own work',
    },
  },
  {
    file: 'lib/ui/nav.ts',
    capability: 'report.read',
    coverage: {
      kind: 'shell',
      expected: ['admin', 'owner'],
      reason: 'reports, matching the reports screen gate',
    },
  },
  {
    file: 'lib/ui/nav.ts',
    capability: 'settlement.read',
    coverage: {
      kind: 'shell',
      expected: ['admin', 'owner'],
      reason: 'settlements, matching the settlements screen gate',
    },
  },
  {
    file: 'lib/ui/nav.ts',
    capability: 'reconcile.read',
    coverage: {
      kind: 'shell',
      expected: ['admin', 'owner'],
      reason: 'reconciliation, matching the reconcile screen gate',
    },
  },
  {
    file: 'lib/ui/nav.ts',
    capability: 'settings.manage',
    coverage: {
      kind: 'shell',
      expected: ['admin', 'owner'],
      reason: 'admin and admin settings, matching the settings screen gate',
    },
  },
];

// ---------------------------------------------------------------------------------
// Source discovery
// ---------------------------------------------------------------------------------

/**
 * Files that can hold a gate: Svelte screens and their components, plus the `.ts` modules
 * beside them in `lib/ui` — `nav.ts` is where the shared navigation names its capabilities,
 * so a scan that stopped at `.svelte` would stop seeing them.
 */
function listSource(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSource(full);
    if (entry.name.endsWith('.svelte')) return [full];
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) return [full];
    return [];
  });
}

const SCAN_ROOTS = [path.join(SRC_ROOT, 'routes', '(app)'), path.join(SRC_ROOT, 'lib', 'ui')];

interface Discovered {
  file: string;
  helper: Helper;
  capability: string;
}

/**
 * A caller-role gate written without a capability helper. These can refuse or admit a
 * role while the parity table knows nothing about it, so each shape a gate can take is
 * matched, not just the literal comparison:
 *
 *  - `session.user?.role === 'owner'` and its reverse;
 *  - a comparison against a **constant** (`callerRole === OWNER_ROLE`, `role !== undefined`);
 *  - **array membership** (`ROLES.includes(callerRole)`, `['owner'].includes(session.user?.role)`);
 *  - a **callback test** (`.some`, `.filter`, `.every`) whose body decides on the caller's
 *    role, or filters a list of roles by a bare `role`;
 *  - a **`switch` on the caller's role**, where each `case` is a branch on the role;
 *  - a **local role helper**, `(caller: UserRole) => caller === 'owner'`, whose comparison
 *    is against a parameter rather than the caller expression;
 *  - a **role-keyed table**, `{ owner: …, admin: … }` read as `VIEWS[role]`, which branches
 *    in data instead of control flow.
 *
 * Target-object comparisons (`u.role === 'owner'` while rendering a roster row) are not
 * caller gates: the expression has to read the session's role or one of the names the app
 * uses for the caller's role. A bare `role` is therefore not matched, because in this
 * codebase it is as often a row's role as the caller's.
 */
const CALLER_ROLE_EXPRESSION = String.raw`(?:session\.user\??\.role|callerRole|userRole)`;

interface RawRolePattern {
  kind: string;
  pattern: RegExp;
}

const RAW_ROLE_PATTERNS: RawRolePattern[] = [
  {
    kind: 'quoted comparison',
    pattern: new RegExp(String.raw`${CALLER_ROLE_EXPRESSION}\s*(?:===|!==|==|!=)\s*'[a-z_]+'`, 'g'),
  },
  {
    kind: 'reversed quoted comparison',
    pattern: new RegExp(String.raw`'[a-z_]+'\s*(?:===|!==|==|!=)\s*${CALLER_ROLE_EXPRESSION}`, 'g'),
  },
  {
    kind: 'constant comparison',
    pattern: new RegExp(
      // Anything that is not a quoted literal is treated as a constant, including
      // `undefined` and a dotted name. Names are matched here on purpose: a role-
      // named constant is exactly how the string comparison gets hidden.
      String.raw`${CALLER_ROLE_EXPRESSION}\s*(?:===|!==|==|!=)\s*(?!['"])[A-Za-z_$][\w$.]*`,
      'g',
    ),
  },
  {
    kind: 'array membership',
    pattern: new RegExp(
      String.raw`(?:[A-Za-z_$][\w$.]*|\[[^\]\n]*\])\s*\.includes\(\s*${CALLER_ROLE_EXPRESSION}\s*\)`,
      'g',
    ),
  },
];

interface RawRoleFinding {
  kind: string;
  expression: string;
}

/**
 * A caller-role **value** as it appears inside an expression, which is a wider set than the
 * left-hand-side comparison patterns above: it also accepts a bare `role` that is not a
 * property access.
 *
 * The bare form is what an alias of the caller's role usually looks like (`const role =
 * session.user?.role`), and it is exactly how a role branch hides from a comparison scan —
 * `cmd.roles.includes(role)` reads as a list filter, not a gate. `u.role` is excluded by the
 * lookbehind, so the common target-object comparison stays out.
 */
const CALLER_ROLE_VALUE = new RegExp(String.raw`(?:${CALLER_ROLE_EXPRESSION}\b|(?<![\w$.])role\b)`);

/**
 * The caller's role in a **decision** position: compared against something, tested by a
 * role list, or switched on. Merely handing the role to a function is not a decision —
 * `cmds.filter((cmd) => cmd.canUse(role))` delegates to a capability predicate that the
 * capability scan already checks, and flagging it would push screens back towards inline
 * role logic.
 */
const ROLE_DECISION = new RegExp(
  String.raw`(?:${CALLER_ROLE_VALUE.source}\s*(?:===|!==|==|!=)|(?:===|!==|==|!=)\s*(?:${CALLER_ROLE_VALUE.source})|\b\w*[Rr]oles\s*\.\s*includes\(\s*(?:${CALLER_ROLE_VALUE.source}))`,
);

/** Collapse a snippet enough to compare and read; callbacks can be long. */
function normaliseExpression(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
}

/**
 * The index just past the `)` that closes the call whose `(` ends at `openIndex`.
 * String and template literals are skipped so a stray bracket inside a message does not
 * end the window early.
 */
function endOfCall(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];

    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return source.length;
}

/**
 * The index just past the `}` that closes the block opening at `openIndex`, skipping string
 * and template literals so a brace inside a message does not close the block early.
 */
function endOfBlock(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];

    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return source.length;
}

/** The body of a function whose parameter list closes just before `from`. */
function bodyAfterParams(source: string, from: number): string {
  const rest = source.slice(from);
  const arrowIndex = rest.search(/=>/);
  const braceIndex = rest.search(/\{/);
  const blockArrow =
    braceIndex !== -1 &&
    arrowIndex !== -1 &&
    braceIndex > arrowIndex &&
    rest.slice(arrowIndex + 2, braceIndex).trim() === '';

  if (braceIndex !== -1 && (arrowIndex === -1 || braceIndex < arrowIndex || blockArrow)) {
    const open = from + braceIndex;
    return source.slice(open, endOfBlock(source, open));
  }

  if (arrowIndex !== -1) {
    const start = from + arrowIndex + 2;
    const end = source.indexOf(';', start);
    return source.slice(start, end === -1 ? Math.min(start + 400, source.length) : end);
  }

  return '';
}

/** A predicate over a `UserRole`-typed parameter: `(caller: UserRole) => caller === 'owner'`. */
function decidesOnParam(param: string, body: string): boolean {
  const pattern = new RegExp(
    String.raw`(?:${param}\s*(?:===|!==|==|!=)\s*'[a-z_]+'|'[a-z_]+'\s*(?:===|!==|==|!=)\s*${param}\b|\.\s*includes\s*\(\s*${param}\s*\)|switch\s*\(\s*${param}\s*\))`,
  );
  return pattern.test(body);
}

/**
 * Role branches that a scan of the caller's own expression cannot see, because the role is
 * handed to something else first:
 *
 *  - **a local helper** — `const isOwner = (caller: UserRole) => caller === 'owner'` and
 *    `function isOwner(caller: UserRole) { return caller === 'owner' }`. The comparison is
 *    against the parameter, not the caller expression, so nothing else in the scan fires;
 *    the screen then branches on `isOwner(role)`.
 *  - **a role-keyed table** — `const VIEWS: Record<UserRole, …> = { owner: …, admin: … }`
 *    read as `VIEWS[role]`. One branch per key, in data rather than control flow.
 *
 * Neither is flagged for existing at all: a helper is only a gate when its body decides on
 * the role, and a table is only a gate when it is indexed by the caller's role. A table read
 * as `VIEWS[row.role]` (a roster badge) stays out.
 */
/**
 * Every declaration in `source` that decides on a `UserRole`-typed parameter. Shared by the
 * local scan and by the import tracer, which runs the same shape test on the module a screen
 * imports from.
 */
function roleHelpers(source: string): Array<{ name: string; param: string; index: number }> {
  const helpers: Array<{ name: string; param: string; index: number }> = [];
  const declarations: Array<{ name: string; paramsStart: number }> = [];

  for (const match of source.matchAll(
    /(?:^|\n)[ \t]*(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
  )) {
    declarations.push({ name: match[1], paramsStart: match.index + match[0].length - 1 });
  }
  for (const match of source.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g,
  )) {
    declarations.push({ name: match[1], paramsStart: match.index + match[0].length - 1 });
  }

  for (const { name, paramsStart } of declarations) {
    const paramsEnd = endOfCall(source, paramsStart);
    const params = source.slice(paramsStart + 1, paramsEnd);
    const typed = [...params.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*UserRole\b/g)].map(
      (match) => match[1],
    );
    if (typed.length === 0) continue;

    const body = bodyAfterParams(source, paramsEnd + 1);
    const decided = typed.find((param) => decidesOnParam(param, body));
    if (!decided) continue;
    helpers.push({ name, param: decided, index: paramsStart });
  }

  return helpers;
}

function scanIndirectRoleGates(source: string, covered: Array<[number, number]>): RawRoleFinding[] {
  const findings: RawRoleFinding[] = [];
  const handled = (index: number) => covered.some(([from, to]) => index >= from && index <= to);

  for (const helper of roleHelpers(source)) {
    if (handled(helper.index)) continue;
    findings.push({
      kind: 'role helper',
      expression: normaliseExpression(`${helper.name}(${helper.param}: UserRole)`),
    });
  }

  const roleTables: string[] = [];
  for (const match of source.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*Record\s*<\s*UserRole[^>]*>)?\s*=\s*\{/g,
  )) {
    const open = match.index + match[0].length - 1;
    const body = source.slice(open, endOfBlock(source, open));
    const keys = new Set(
      [...body.matchAll(/(?:[{,]\s*|^\s*)'?(owner|admin|staff|super_admin)'?\s*:/g)].map(
        (key) => key[1],
      ),
    );
    if (keys.size < 2) continue;
    roleTables.push(match[1]);
  }

  for (const name of roleTables) {
    const lookup = new RegExp(
      String.raw`\b${name}\s*\[\s*(?:${CALLER_ROLE_VALUE.source})\s*\]`,
      'g',
    );
    for (const match of source.matchAll(lookup)) {
      if (handled(match.index)) continue;
      findings.push({ kind: 'role table lookup', expression: normaliseExpression(match[0]) });
    }
  }

  return findings;
}

/**
 * Resolve an import the way the app's bundler does, for the two specifier shapes a screen
 * uses: `$lib/...` (the SvelteKit alias for `src/lib`) and a relative path. A `.js`
 * specifier that actually names a TypeScript file, and a directory index, both resolve.
 */
function resolveModuleFile(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith('$lib/')
    ? path.join(SRC_ROOT, 'lib', specifier.slice('$lib/'.length))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(fromFile), specifier)
      : null;
  if (!base) return null;

  for (const candidate of [base, `${base}.ts`, `${base}.js`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const moduleSourceCache = new Map<string, string>();

/**
 * The capability registry is where roles are *meant* to be interpreted: `isCenterScoped`
 * compares a role, and `canManageUser` decides on two. A screen calling these is using the
 * sanctioned source, so they are never reported as raw role gates.
 */
const CAPABILITY_REGISTRY = path.join(SRC_ROOT, 'lib', 'capabilities.ts');

/** Read a module once; the tracer may ask about the same file from several hops. */
function moduleSource(file: string): string {
  let source = moduleSourceCache.get(file);
  if (source === undefined) {
    source = fs.readFileSync(file, 'utf8');
    moduleSourceCache.set(file, source);
  }
  return source;
}

interface ExportedHelper {
  /** The module that actually declares the decision, after any barrels. */
  file: string;
  name: string;
  param: string;
}

/**
 * Follow an exported name to the module that declares the role-deciding helper, through
 * `export { x } from './y'`, `export { x as y } from './y'`, nested barrels and
 * `export * from './y'`. Without this a screen importing from a barrel looks clean: the
 * barrel declares nothing, and the comparison sits two files further away.
 *
 * The capability registry ends the walk — re-exporting `hasCapability` is not a raw gate —
 * and a visited set stops a circular barrel from looping.
 */
function resolveExportedHelper(
  file: string,
  exportName: string,
  seen: Set<string> = new Set(),
): ExportedHelper | null {
  const key = `${file}#${exportName}`;
  if (seen.has(key) || seen.size > 32) return null;
  seen.add(key);
  if (file === CAPABILITY_REGISTRY) return null;

  const source = moduleSource(file);
  const declared = roleHelpers(source).find((helper) => helper.name === exportName);
  if (declared) return { file, name: declared.name, param: declared.param };

  for (const match of source.matchAll(/\bexport\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    for (const part of match[1].split(',')) {
      const [inner, alias] = part.trim().split(/\s+as\s+/);
      if (!inner) continue;
      if ((alias ?? inner).trim() !== exportName) continue;
      const target = resolveModuleFile(match[2], file);
      const resolved = target ? resolveExportedHelper(target, inner.trim(), seen) : null;
      if (resolved) return resolved;
    }
  }

  for (const match of source.matchAll(/\bexport\s*\*\s*from\s*'([^']+)'/g)) {
    const target = resolveModuleFile(match[1], file);
    const resolved = target ? resolveExportedHelper(target, exportName, seen) : null;
    if (resolved) return resolved;
  }

  return null;
}

/**
 * A screen's `isOwner(role)` where `isOwner` is imported: the branch lives in another
 * module, so the local scan cannot see it. Each binding is resolved to the module that
 * declares the helper — through barrels if need be — and a call that passes the caller's
 * role into it is reported with the definition site.
 *
 * Three binding shapes are traced: a named import, a named import under an alias, and a
 * namespace (`import * as auth; auth.isOwner(role)`). Only a call that hands the caller's
 * role over counts: importing a helper is not a gate, and neither is calling one with a
 * roster row's role. Default exports are not traced.
 */
function scanImportedRoleHelpers(source: string, file: string): RawRoleFinding[] {
  const findings: RawRoleFinding[] = [];
  const named: Array<{ local: string; imported: string; specifier: string }> = [];
  const namespaces: Array<{ local: string; specifier: string }> = [];

  for (const match of source.matchAll(
    /(?:^|\n)\s*import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g,
  )) {
    for (const part of match[1].split(',')) {
      const [imported, alias] = part.trim().split(/\s+as\s+/);
      if (!imported || !/^[A-Za-z_$][\w$]*$/.test(imported)) continue;
      named.push({ imported, local: (alias ?? imported).trim(), specifier: match[2] });
    }
  }

  for (const match of source.matchAll(
    /(?:^|\n)\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+'([^']+)'/g,
  )) {
    namespaces.push({ local: match[1], specifier: match[2] });
  }

  const report = (called: string, args: string, resolved: ExportedHelper) => {
    findings.push({
      kind: 'imported role helper',
      expression: normaliseExpression(
        `${called}(${args}) → ${path.relative(SRC_ROOT, resolved.file)}:${resolved.name}(${resolved.param})`,
      ),
    });
  };

  for (const { local, imported, specifier } of named) {
    const target = resolveModuleFile(specifier, file);
    if (!target) continue;
    const resolved = resolveExportedHelper(target, imported);
    if (!resolved) continue;

    const call = new RegExp(String.raw`\b${local}\s*\(([^)]*)\)`, 'g');
    for (const match of source.matchAll(call)) {
      const args = match[1].trim();
      if (!CALLER_ROLE_VALUE.test(args)) continue;
      report(local, args, resolved);
    }
  }

  for (const { local, specifier } of namespaces) {
    const target = resolveModuleFile(specifier, file);
    if (!target) continue;

    const call = new RegExp(String.raw`\b${local}\s*\.\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)`, 'g');
    for (const match of source.matchAll(call)) {
      const resolved = resolveExportedHelper(target, match[1]);
      if (!resolved) continue;
      const args = match[2].trim();
      if (!CALLER_ROLE_VALUE.test(args)) continue;
      report(`${local}.${match[1]}`, args, resolved);
    }
  }

  return findings;
}

/**
 * Callback and `switch` branches, which a left-hand-side comparison pattern cannot see:
 *
 *  - `['owner'].some((r) => r === callerRole)` — admitted set built by a predicate;
 *  - `roles.filter((r) => r !== role)` — the caller's role narrowed by a filter;
 *  - `cmd.roles.includes(role)` — a list of roles tested against the caller's role;
 *  - `switch (callerRole) { case 'owner': … }` — one branch per role.
 *
 * The whole call window is examined rather than a fixed substring, so a callback with
 * nested parentheses is read correctly, and a list holding arbitrary objects is not a false
 * positive: the window has to mention the caller's role, not merely the word "roles".
 */
function scanRoleBranches(source: string): RawRoleFinding[] {
  const findings: RawRoleFinding[] = [];
  /** Character ranges already explained by a callback finding. */
  const covered: Array<[number, number]> = [];

  for (const match of source.matchAll(/\.\s*(some|filter|every|find|findLast)\s*\(/g)) {
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = endOfCall(source, openIndex);
    const window = source.slice(openIndex + 1, closeIndex);
    if (!ROLE_DECISION.test(window)) continue;
    findings.push({
      kind: 'role predicate',
      expression: normaliseExpression(`${match[1]}(${window})`),
    });
    covered.push([match.index, closeIndex]);
  }

  // A list of roles tested directly, outside a callback: `cmd.roles.includes(role)`. A
  // `.filter(...)` that contains one is the same branch, so it is reported once, as the
  // predicate that holds it.
  for (const match of source.matchAll(/\b\w*[Rr]oles\s*\.\s*includes\(/g)) {
    const openIndex = match.index + match[0].length - 1;
    const window = source.slice(openIndex + 1, endOfCall(source, openIndex));
    if (!CALLER_ROLE_VALUE.test(window)) continue;
    if (covered.some(([from, to]) => match.index >= from && match.index <= to)) continue;
    findings.push({
      kind: 'role list membership',
      expression: normaliseExpression(`${match[0]}${window})`),
    });
  }

  for (const match of source.matchAll(/\bswitch\s*\(/g)) {
    const openIndex = match.index + match[0].length - 1;
    const subject = source.slice(openIndex + 1, endOfCall(source, openIndex));
    if (!CALLER_ROLE_VALUE.test(subject)) continue;
    findings.push({
      kind: 'switch on the caller role',
      expression: normaliseExpression(`switch (${subject})`),
    });
  }

  return [...findings, ...scanIndirectRoleGates(source, covered)];
}

function scanRawRoleGates(source: string, file?: string): RawRoleFinding[] {
  const findings: RawRoleFinding[] = [];
  const seen = new Set<string>();

  for (const { kind, pattern } of RAW_ROLE_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const expression = match[0].replace(/\s+/g, ' ').trim();
      const seenKey = `${kind}:${expression}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      findings.push({ kind, expression });
    }
  }

  const branches = [
    ...scanRoleBranches(source),
    ...(file ? scanImportedRoleHelpers(source, file) : []),
  ];

  for (const finding of branches) {
    const seenKey = `${finding.kind}:${finding.expression}`;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);
    findings.push(finding);
  }

  return findings;
}

function discoverGates(): Discovered[] {
  const found: Discovered[] = [];
  const unparsed: string[] = [];

  for (const root of SCAN_ROOTS) {
    for (const absolute of listSource(root)) {
      const source = fs.readFileSync(absolute, 'utf8');
      const file = path.relative(SRC_ROOT, absolute);
      const calls = [
        ...source.matchAll(/\b(hasCenterCapability|hasCapability|canManageUser)\s*\(/g),
      ];
      if (calls.length === 0) continue;

      for (const call of calls) {
        const helper = call[1] as Helper;
        const start = call.index + call[0].length;
        // Arguments contain no nested call, so the first ')' closes the gate call.
        const args = source.slice(start, source.indexOf(')', start));

        if (helper === 'canManageUser') {
          found.push({ file, helper, capability: 'canManageUser' });
          continue;
        }

        const literal = args.match(/,\s*'([a-z_.]+)'\s*$/);
        if (!literal) {
          unparsed.push(`${file}: ${helper}(${args.trim()})`);
          continue;
        }
        found.push({ file, helper, capability: literal[1] });
      }
    }
  }

  if (unparsed.length > 0) {
    throw new Error(
      `gate calls with a non-literal capability cannot be verified; use a literal:\n  ${unparsed.join('\n  ')}`,
    );
  }

  return found;
}

const key = (file: string, capability: string) => `${file}::${capability}`;

// ---------------------------------------------------------------------------------
// Role sets
// ---------------------------------------------------------------------------------

function rolesFor(helper: Helper, capability: string): UserRole[] {
  if (helper === 'canManageUser') {
    return ROLES.filter((role) =>
      ROLES.some((target) => role !== target && canManageUser(role, target)),
    );
  }
  if (helper === 'hasCenterCapability') {
    const cap = capability as Capability;
    return ROLES.filter((role) => hasCenterCapability(role, cap));
  }
  const cap = capability as Capability;
  return ROLES.filter((role) => hasCapability(role, cap));
}

// ---------------------------------------------------------------------------------
// Route guards
// ---------------------------------------------------------------------------------

function readRoute(apiPath: string): string {
  const file = path.join(SRC_ROOT, 'routes', apiPath.replace(/^\//, ''), '+server.ts');
  if (!fs.existsSync(file)) {
    throw new Error(`no route file for ${apiPath} (looked for ${file})`);
  }
  return fs.readFileSync(file, 'utf8');
}

/**
 * The roles a route admits, from its inline guard.
 *   caller.role !== 'owner'                              → owner
 *   caller.role !== 'admin' && caller.role !== 'owner'   → admin, owner
 *   requireRole(caller, ['owner', 'admin'])              → owner, admin
 */
function routeRoles(apiPath: string): UserRole[] {
  const source = readRoute(apiPath);
  const allowed = new Set<UserRole>();

  for (const match of source.matchAll(
    /caller\.role\s*!==\s*'([a-z_]+)'(?:\s*&&\s*caller\.role\s*!==\s*'([a-z_]+)')?/g,
  )) {
    allowed.add(match[1] as UserRole);
    if (match[2]) allowed.add(match[2] as UserRole);
  }

  for (const match of source.matchAll(/requireRole\(caller,\s*\[([^\]]*)\]/g)) {
    for (const role of match[1].matchAll(/'([a-z_]+)'/g)) allowed.add(role[1] as UserRole);
  }

  if (allowed.size === 0) {
    throw new Error(
      `${apiPath} has no recognisable role guard in source; extend the parser rather than skipping it`,
    );
  }
  return ROLES.filter((role) => allowed.has(role));
}

/** The capabilities a route asks for, in source order. */
function routeCapabilities(apiPath: string): string[] {
  const source = readRoute(apiPath);
  return [...source.matchAll(/requireCapability\(caller,\s*'([a-z_.]+)'/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------

interface RawRoleException {
  file: string;
  kind: string;
  expression: string;
  reason: string;
}

/**
 * Caller-role branches allowed to remain, each with the reason it is not a gate that a
 * capability should own. Screens choose behaviour from capabilities, and a view that is
 * genuinely role-shaped (the dashboard variant) names the capability that separates the
 * roles instead. Empty on purpose: add here only with a reason that survives review.
 */
const RAW_ROLE_EXCEPTIONS: RawRoleException[] = [];

function discoverRawRoleGates(): Array<{ file: string; kind: string; expression: string }> {
  const found: Array<{ file: string; kind: string; expression: string }> = [];
  for (const root of SCAN_ROOTS) {
    for (const absolute of listSource(root)) {
      const file = path.relative(SRC_ROOT, absolute);
      for (const finding of scanRawRoleGates(fs.readFileSync(absolute, 'utf8'), absolute)) {
        found.push({ file, ...finding });
      }
    }
  }
  return found;
}

const discovered = discoverGates();
const declaredByKey = new Map(DECLARED.map((entry) => [key(entry.file, entry.capability), entry]));
const discoveredByKey = new Map(
  discovered.map((entry) => [key(entry.file, entry.capability), entry]),
);

describe('center screen gates match the server routes behind them (Plan 023)', () => {
  it('declares every capability gate found in a screen or shell component', () => {
    const undeclared = discovered.filter(
      (entry) => !declaredByKey.has(key(entry.file, entry.capability)),
    );
    expect(
      undeclared.map((entry) => `${entry.file} → ${entry.capability}`),
      'add these to DECLARED with the route (or offline/shell reason) they belong to',
    ).toEqual([]);
  });

  it('keeps no stale declaration whose gate was removed', () => {
    const stale = DECLARED.filter(
      (entry) => !discoveredByKey.has(key(entry.file, entry.capability)),
    );
    expect(
      stale.map((entry) => `${entry.file} → ${entry.capability}`),
      'the source no longer gates on this; remove the declaration',
    ).toEqual([]);
  });

  it('detects caller-role comparisons (detector self-check)', () => {
    // Without this the rule below could pass because every pattern stopped matching.
    expect(
      scanRawRoleGates(
        "{#if session.user?.role === 'owner'}x{/if}{#if callerRole !== 'staff'}y{/if}",
      ),
    ).toEqual([
      { kind: 'quoted comparison', expression: "session.user?.role === 'owner'" },
      { kind: 'quoted comparison', expression: "callerRole !== 'staff'" },
    ]);
    expect(scanRawRoleGates("{#if u.role === 'owner'}row{/if}")).toEqual([]);
  });

  it('detects the constant and array forms of a role gate (detector self-check)', () => {
    expect(scanRawRoleGates('{#if callerRole === OWNER_ROLE}x{/if}')).toEqual([
      { kind: 'constant comparison', expression: 'callerRole === OWNER_ROLE' },
    ]);
    expect(scanRawRoleGates("{#if 'super_admin' === userRole}x{/if}")).toEqual([
      { kind: 'reversed quoted comparison', expression: "'super_admin' === userRole" },
    ]);
    expect(scanRawRoleGates('{#if ROLES.includes(callerRole)}x{/if}')).toEqual([
      { kind: 'array membership', expression: 'ROLES.includes(callerRole)' },
    ]);
    expect(scanRawRoleGates("{#if ['owner', 'admin'].includes(session.user?.role)}x{/if}")).toEqual(
      [
        {
          kind: 'array membership',
          expression: "['owner', 'admin'].includes(session.user?.role)",
        },
      ],
    );
    expect(scanRawRoleGates('{#if callerRole === undefined}x{/if}')).toEqual([
      { kind: 'constant comparison', expression: 'callerRole === undefined' },
    ]);

    // A row's role, a capability call and a plain assignment are not caller gates.
    expect(
      scanRawRoleGates(
        "{#if u.role === 'owner'}row{/if}{#if hasCapability(callerRole, 'user.read')}x{/if}",
      ),
    ).toEqual([]);
  });

  it('detects role branches written as a callback (detector self-check)', () => {
    expect(
      scanRawRoleGates("{#if ['owner', 'admin'].some((r) => r === callerRole)}x{/if}"),
    ).toEqual([
      {
        kind: 'role predicate',
        expression: 'some((r) => r === callerRole)',
      },
    ]);

    expect(scanRawRoleGates('const allowed = roles.filter((r) => r !== role);')).toEqual([
      { kind: 'role predicate', expression: 'filter((r) => r !== role)' },
    ]);

    // The alias form: the caller's role is tested against a command's own role list.
    expect(scanRawRoleGates('cmds.filter((cmd) => cmd.roles.includes(role)).map(go)')).toEqual([
      { kind: 'role predicate', expression: 'filter((cmd) => cmd.roles.includes(role))' },
    ]);

    // Handing the role to a capability predicate is not a role decision: the palette does
    // exactly this after its conversion, and the capability scan covers the predicate.
    expect(
      scanRawRoleGates('cmds.filter((cmd) => cmd.canUse(role)).filter((cmd) => cmd.active)'),
    ).toEqual([]);
    expect(scanRawRoleGates("cmds.filter((cmd) => hasCapability(role, 'report.read'))")).toEqual(
      [],
    );
    // A bare `.roles.includes(role)`, not inside a callback: one finding, list membership.
    expect(scanRawRoleGates('{@const allowed = cmd.roles.includes(role)}')).toEqual([
      { kind: 'role list membership', expression: 'roles.includes(role)' },
    ]);

    // Nested parentheses inside the callback must not end the window early.
    expect(
      scanRawRoleGates('roles.filter((r) => (r.length > 2 ? r !== callerRole : false))'),
    ).toEqual([
      {
        kind: 'role predicate',
        expression: 'filter((r) => (r.length > 2 ? r !== callerRole : false))',
      },
    ]);
  });

  it('detects a switch on the caller role (detector self-check)', () => {
    expect(scanRawRoleGates("switch (callerRole) { case 'owner': break; }")).toEqual([
      { kind: 'switch on the caller role', expression: 'switch (callerRole)' },
    ]);
    expect(scanRawRoleGates("switch (role) { case 'staff': break; }")).toEqual([
      { kind: 'switch on the caller role', expression: 'switch (role)' },
    ]);
  });

  it('does not mistake rows, capabilities or other switches for a caller-role branch', () => {
    // A roster row's role, a capability call, and a switch on something else are not gates.
    expect(
      scanRawRoleGates(
        "users.filter((u) => u.role === 'admin' && u.active)" +
          "{@const can = hasCapability(callerRole, 'user.manage')}" +
          "switch (kind) { case 'rate': break; }" +
          'rows.some((row) => row.role !== role)' +
          'cmd.roles.includes(u.role)',
      ),
    ).toEqual([
      // Only the last two decide on the caller's role; `u.role` inside a callback body is
      // a target object, but a bare `role` beside a row comparison is the caller.
      { kind: 'role predicate', expression: 'some((row) => row.role !== role)' },
    ]);
  });

  it('detects a role helper and a role table read by the caller role (detector self-check)', () => {
    // The comparison is against the parameter, so no other pattern in the scan can see it;
    // the screen then branches on `isOwner(role)`.
    expect(
      scanRawRoleGates(
        "const isOwner = (caller: UserRole) => caller === 'owner';\n{#if isOwner(role)}x{/if}",
      ),
    ).toEqual([{ kind: 'role helper', expression: 'isOwner(caller: UserRole)' }]);
    expect(
      scanRawRoleGates(
        "function isWide(caller: UserRole) {\n  return caller !== 'staff';\n}\n{#if isWide(role)}y{/if}",
      ),
    ).toEqual([{ kind: 'role helper', expression: 'isWide(caller: UserRole)' }]);
    expect(
      scanRawRoleGates(
        "const canVoid = (caller: UserRole) => ['owner', 'admin'].includes(caller);",
      ),
    ).toEqual([{ kind: 'role helper', expression: 'canVoid(caller: UserRole)' }]);

    // One branch per key, in data instead of control flow.
    expect(
      scanRawRoleGates(
        "const VIEWS: Record<UserRole, string> = { owner: 'a', admin: 'b', staff: 'c' };\nconst view = VIEWS[role];",
      ),
    ).toEqual([{ kind: 'role table lookup', expression: 'VIEWS[role]' }]);
    expect(
      scanRawRoleGates(
        "const VIEWS = { owner: 'a', admin: 'b' };\nconst view = VIEWS[session.user?.role];",
      ),
    ).toEqual([{ kind: 'role table lookup', expression: 'VIEWS[session.user?.role]' }]);
  });

  it('traces a role helper imported from another module (detector self-check)', () => {
    // Real files in a temporary directory: resolution is path-relative, so the fixture
    // exercises the same code path the app's `$lib` imports take.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clt-role-import-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'helpers.ts'),
        "import type { UserRole } from '@clt/shared';\nexport const isOwner = (caller: UserRole) => caller === 'owner';\n",
      );
      const screen = path.join(dir, 'Screen.svelte');
      const source = "import { isOwner } from './helpers';\n{#if isOwner(role)}x{/if}";
      fs.writeFileSync(screen, source);

      expect(scanRawRoleGates(source, screen)).toEqual([
        {
          kind: 'imported role helper',
          expression: `isOwner(role) → ${path.relative(SRC_ROOT, path.join(dir, 'helpers.ts'))}:isOwner(caller)`,
        },
      ]);

      // An aliased import is traced under its local name.
      const aliased =
        "import { isOwner as canSeeAll } from './helpers';\n{#if canSeeAll(role)}x{/if}";
      expect(scanRawRoleGates(aliased, screen)).toEqual([
        {
          kind: 'imported role helper',
          expression: `canSeeAll(role) → ${path.relative(SRC_ROOT, path.join(dir, 'helpers.ts'))}:isOwner(caller)`,
        },
      ]);

      // A barrel re-export keeps the branch out of the module the screen imports.
      fs.writeFileSync(path.join(dir, 'barrel.ts'), "export { isOwner } from './helpers';\n");
      expect(
        scanRawRoleGates("import { isOwner } from './barrel';\n{isOwner(role)}", screen),
      ).toEqual([
        {
          kind: 'imported role helper',
          expression: `isOwner(role) → ${path.relative(SRC_ROOT, path.join(dir, 'helpers.ts'))}:isOwner(caller)`,
        },
      ]);

      // `export *`, a nested barrel, and a re-export under a different name.
      fs.writeFileSync(path.join(dir, 'star.ts'), "export * from './helpers';\n");
      fs.writeFileSync(path.join(dir, 'nested.ts'), "export * from './barrel';\n");
      fs.writeFileSync(
        path.join(dir, 'renamed.ts'),
        "export { isOwner as canSeeAll } from './helpers';\n",
      );
      for (const source of [
        "import { isOwner } from './star';\n{isOwner(role)}",
        "import { isOwner } from './nested';\n{isOwner(role)}",
      ]) {
        expect(scanRawRoleGates(source, screen)).toEqual([
          {
            kind: 'imported role helper',
            expression: `isOwner(role) → ${path.relative(SRC_ROOT, path.join(dir, 'helpers.ts'))}:isOwner(caller)`,
          },
        ]);
      }
      expect(
        scanRawRoleGates("import { canSeeAll } from './renamed';\n{canSeeAll(role)}", screen),
      ).toEqual([
        {
          kind: 'imported role helper',
          expression: `canSeeAll(role) → ${path.relative(SRC_ROOT, path.join(dir, 'helpers.ts'))}:isOwner(caller)`,
        },
      ]);

      // A namespace import is traced through the barrel too.
      fs.writeFileSync(path.join(dir, 'index.ts'), "export * from './helpers';\n");
      expect(
        scanRawRoleGates("import * as auth from './index';\n{auth.isOwner(role)}", screen),
      ).toEqual([
        {
          kind: 'imported role helper',
          expression: `auth.isOwner(role) → ${path.relative(SRC_ROOT, path.join(dir, 'helpers.ts'))}:isOwner(caller)`,
        },
      ]);
      expect(
        scanRawRoleGates("import * as auth from './index';\n{auth.isOwner(row.role)}", screen),
      ).toEqual([]);
      // A member the barrel does not export is not a helper and cannot be a finding.
      expect(
        scanRawRoleGates("import * as auth from './index';\n{auth.label(role)}", screen),
      ).toEqual([]);

      // A helper that only formats the role is not traced, and a roster row's role is not
      // the caller's role.
      fs.writeFileSync(
        path.join(dir, 'format.ts'),
        'export const label = (caller: UserRole) => caller.toUpperCase();\n',
      );
      expect(scanRawRoleGates("import { label } from './format';\n{label(role)}", screen)).toEqual(
        [],
      );
      expect(
        scanRawRoleGates("import { isOwner } from './helpers';\n{isOwner(row.role)}", screen),
      ).toEqual([]);
      // An import that does not resolve is not silently assumed to be a gate.
      expect(scanRawRoleGates(source, path.join(dir, 'missing', 'Screen.svelte'))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not mistake a role formatter or a roster lookup for a role branch', () => {
    // A helper that only formats the role decides nothing.
    expect(scanRawRoleGates('const label = (caller: UserRole) => caller.toUpperCase();')).toEqual(
      [],
    );
    // A role-keyed table read with a row's role is a badge, not a gate.
    expect(
      scanRawRoleGates("const VIEWS = { owner: 'a', admin: 'b' };\nconst view = VIEWS[row.role];"),
    ).toEqual([]);
    // A table with no role keys is not a role table, whatever it is indexed by.
    expect(
      scanRawRoleGates("const COLOURS = { primary: 'a', accent: 'b' };\nconst c = COLOURS[role];"),
    ).toEqual([]);
  });

  it('gates on capabilities, not on caller-role strings, in every screen', () => {
    const findings = discoverRawRoleGates();
    const excused = findings.filter((finding) =>
      RAW_ROLE_EXCEPTIONS.some(
        (exception) =>
          exception.file === finding.file &&
          exception.kind === finding.kind &&
          exception.expression === finding.expression,
      ),
    );
    const unexplained = findings.filter((finding) => !excused.includes(finding));

    expect(
      unexplained.map((finding) => `${finding.file}: ${finding.kind}: ${finding.expression}`),
      'use hasCapability/hasCenterCapability (or isCenterScoped) instead of gating on the caller role',
    ).toEqual([]);
  });

  it('keeps no stale raw-role exception', () => {
    const findings = discoverRawRoleGates();
    const stale = RAW_ROLE_EXCEPTIONS.filter(
      (exception) =>
        !findings.some(
          (finding) =>
            finding.file === exception.file &&
            finding.kind === exception.kind &&
            finding.expression === exception.expression,
        ),
    );
    expect(
      stale.map((exception) => `${exception.file}: ${exception.kind}: ${exception.expression}`),
    ).toEqual([]);
  });

  it('keeps every discovered capability in the registry', () => {
    const unknown = discovered
      .filter((entry) => entry.helper !== 'canManageUser')
      .filter((entry) => !ALL_CAPABILITIES.includes(entry.capability as Capability));
    expect(unknown.map((entry) => `${entry.file} → ${entry.capability}`)).toEqual([]);
  });

  for (const entry of DECLARED) {
    it(`${entry.file} + ${entry.capability} (${entry.coverage.kind})`, () => {
      const gate = discoveredByKey.get(key(entry.file, entry.capability));
      expect(gate, `${entry.file} does not gate on ${entry.capability}`).toBeDefined();

      const gated = rolesFor(gate!.helper, entry.capability);
      const { coverage } = entry;

      expect(
        gated,
        `${entry.file} [${entry.capability}] admits ${gated.join(', ') || 'nobody'}, declared ${coverage.expected.join(', ')}`,
      ).toEqual(coverage.expected);

      if (coverage.kind === 'route') {
        const served = routeRoles(coverage.apiPath);
        const gaps = coverage.knownGaps?.map((gap) => gap.role) ?? [];
        const shouldBeServed = gated.filter((role) => !gaps.includes(role));

        // A named gap must still be real, or the declaration is lying about the route.
        for (const gap of coverage.knownGaps ?? []) {
          expect(
            served,
            `${coverage.apiPath} now admits ${gap.role}; drop the known-gap entry`,
          ).not.toContain(gap.role);
        }

        // The direction that breaks users: a screen admitting a role the route refuses.
        for (const role of shouldBeServed) {
          expect(
            served,
            `${entry.file} admits ${role} but ${coverage.apiPath} allows only ${served.join(', ')}`,
          ).toContain(role);
        }
        if (coverage.strict) {
          expect(
            served,
            `${coverage.apiPath} allows ${served.join(', ')} but the screen admits ${shouldBeServed.join(', ')}`,
          ).toEqual(shouldBeServed);
        }
        console.info(
          `${entry.file} [${entry.capability}] → ${gated.join(',') || 'none'} | ${coverage.apiPath} → ${served.join(',')}${coverage.note ? ` (${coverage.note})` : ''}`,
        );
        return;
      }

      if (coverage.kind === 'seat-route') {
        expect(routeRoles(coverage.apiPath)).toEqual(['super_admin']);
        expect(routeCapabilities(coverage.apiPath)).toContain(entry.capability);
        console.info(
          `${entry.file} [${entry.capability}] → ${gated.join(',')} | ${coverage.apiPath} requires the same capability`,
        );
        return;
      }

      console.info(
        `${entry.file} [${entry.capability}] → ${gated.join(',') || 'none'} (${coverage.kind}: ${coverage.reason})`,
      );
    });
  }
});
