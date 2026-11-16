#!/usr/bin/env tsx
/**
 * Verify an implementation plan against the working tree.
 *
 * A plan is a claim. This script turns the two places a plan makes checkable claims
 * into assertions:
 *
 *   1. its `## N. Files` table — every path it lists must exist, and a path that only
 *      serves steps the plan says are not built is reported and ignored;
 *   2. each step's `- Check:` command and `- Expected output:` — the static ones
 *      (`grep`/`rg` counts) are executed and compared, and every file path a check
 *      names is confirmed to exist.
 *
 * The failure it exists to prevent: a plan marking steps built while the files those
 * steps name are missing from the tree, or a check whose target was renamed and whose
 * expected count no longer describes anything.
 *
 * Steps the plan does not claim as built are skipped, so an honest `Partially
 * Implemented` plan passes; a step that claims to be built but points at a missing
 * file does not.
 *
 * Usage:
 *   pnpm plan:verify docs/plans/023_super_admin_panel.md
 *   pnpm plan:verify <plan> --run-all     # also execute non-static checks (slow)
 *
 * Exit codes: 0 every checked claim holds, 1 at least one failed, 2 the plan could
 * not be parsed well enough to check.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Read-only commands this script is willing to run without `--run-all`. */
const STATIC_PREFIXES = ['grep ', 'rg '];

/** Paths are only ever checked for existence, so no shell expansion is needed. */
const PATH_LIKE = /(?:^|\s)((?:apps|packages|tests|scripts|supabase|docs|\.github)\/[^\s`'")]+)/g;

interface FileRow {
  path: string;
  action: string;
  steps: number[];
}

interface Step {
  number: number;
  title: string;
  check?: string;
  expected?: string;
}

type Outcome = 'pass' | 'fail' | 'skip' | 'info';

interface Finding {
  outcome: Outcome;
  label: string;
  detail: string;
}

function readPlan(file: string): string {
  const resolved = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!existsSync(resolved)) {
    throw new Error(`plan not found: ${file}`);
  }
  return readFileSync(resolved, 'utf8');
}

/** `1–12 and 15` → [1..12, 15]; ignores prose. */
function parseStepList(text: string): number[] {
  const steps = new Set<number>();
  for (const token of text.split(/,|\band\b/)) {
    const range = token.match(/(\d+)\s*[–-]\s*(\d+)/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let n = from; n <= to; n += 1) steps.add(n);
      continue;
    }
    const single = token.match(/\b(\d+)\b/);
    if (single) steps.add(Number(single[1]));
  }
  return [...steps].sort((a, b) => a - b);
}

/**
 * The header's `Current Status:` sentence is the only place a plan says which steps
 * it claims. Segments naming `not built` are subtracted; segments naming `built` or
 * `complete` are the claims. Anything it cannot read leaves the built set undefined,
 * and the caller refuses to guess.
 */
function parseBuiltSteps(plan: string): number[] | null {
  const statusLine = plan
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^- (Current )?Status:/i.test(line));
  if (!statusLine) return null;

  const built = new Set<number>();
  const excluded = new Set<number>();
  let sawClaim = false;

  for (const segment of statusLine.split(';')) {
    const claim = segment.match(/steps?\s+(.+?)\s+(not built|built|complete)/i);
    if (!claim) continue;
    const numbers = parseStepList(claim[1]!);
    if (claim[2]!.toLowerCase() === 'not built') {
      for (const n of numbers) excluded.add(n);
    } else {
      sawClaim = true;
      for (const n of numbers) built.add(n);
    }
    // "Steps 1–12 built; steps 13–14 not built" also appears as one clause with
    // "and" rather than a semicolon, which the loop above already covers.
  }

  if (!sawClaim) return null;
  return [...built].filter((n) => !excluded.has(n)).sort((a, b) => a - b);
}

function parseFilesTable(plan: string): FileRow[] {
  const lines = plan.split('\n');
  const heading = lines.findIndex((line) => /^##\s+\d+\.\s+Files\b/i.test(line));
  if (heading === -1) return [];

  const rows: FileRow[] = [];
  for (let i = heading + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^##\s/.test(line)) break;
    const cell = line.match(/^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|/);
    if (!cell) continue;
    rows.push({
      path: cell[1]!,
      action: cell[2]!.trim(),
      steps: parseStepList(cell[3]!),
    });
  }
  return rows;
}

function parseSteps(plan: string): Step[] {
  const lines = plan.split('\n');
  const heading = lines.findIndex((line) => /^##\s+\d+\.\s+Steps\b/i.test(line));
  if (heading === -1) return [];

  const steps: Step[] = [];
  let current: Step | null = null;

  for (let i = heading + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^##\s/.test(line)) break;

    const header = line.match(/^(\d+)\.\s+(.*)$/);
    if (header) {
      current = { number: Number(header[1]), title: header[2]!.trim() };
      steps.push(current);
      continue;
    }
    if (!current) continue;

    const check = line.match(/^\s*-\s+Check:\s*`([^`]+)`/);
    if (check) {
      current.check = check[1]!.trim();
      continue;
    }
    const expected = line.match(/^\s*-\s+Expected output:\s*(.+)$/);
    if (expected) current.expected = expected[1]!.trim();
  }

  return steps;
}

/** Files a check command names, so a renamed target is a missing file, not a bad count. */
function pathsIn(command: string): string[] {
  const found = new Set<string>();
  for (const match of command.matchAll(PATH_LIKE)) {
    const candidate = match[1]!.replace(/[:]+$/, '');
    if (PATH_LIKE.lastIndex === 0) found.add(candidate);
    found.add(candidate);
  }
  return [...found];
}

function isExecutableStatic(command: string): boolean {
  if (!STATIC_PREFIXES.some((prefix) => command.startsWith(prefix))) return false;
  // A plan check is a single read-only command. Anything that could chain another
  // command, expand a substitution or write is refused rather than guessed at.
  return !/[;&|`$<>]/.test(command);
}

function runStatic(command: string): { ok: boolean; output: string; count?: number } {
  const result = spawnSync('bash', ['-lc', command], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  const first = output.split('\n')[0]?.trim() ?? '';
  const count = /^\d+$/.test(first) ? Number(first) : undefined;
  return { ok: result.status === 0, output, count };
}

function compareCount(expected: string | undefined, actual: number | undefined): Finding | null {
  if (!expected) return null;
  if (actual === undefined) return null;

  const atLeast = expected.match(/`(\d+)`[^`]*\bor more\b/i);
  if (atLeast) {
    const wanted = Number(atLeast[1]);
    return actual >= wanted
      ? null
      : {
          outcome: 'fail',
          label: 'count',
          detail: `expected ${wanted} or more, got ${actual}`,
        };
  }

  const exact = expected.match(/`(\d+)`/);
  if (exact) {
    const wanted = Number(exact[1]);
    return actual === wanted
      ? null
      : { outcome: 'fail', label: 'count', detail: `expected ${wanted}, got ${actual}` };
  }

  return null;
}

function verify(planPath: string, runAll: boolean): Finding[] {
  const plan = readPlan(planPath);
  const findings: Finding[] = [];

  const builtSteps = parseBuiltSteps(plan);
  if (!builtSteps) {
    findings.push({
      outcome: 'fail',
      label: 'status',
      detail:
        "cannot read the plan's `- Current Status:` line to learn which steps it claims; " +
        'write it as "Steps N–M built" and "steps X–Y not built"',
    });
    return findings;
  }
  const built = new Set(builtSteps);
  findings.push({
    outcome: 'info',
    label: 'built steps claimed',
    detail: builtSteps.length > 0 ? builtSteps.join(', ') : '(none)',
  });

  const files = parseFilesTable(plan);
  if (files.length === 0) {
    findings.push({
      outcome: 'fail',
      label: 'files table',
      detail: 'no `## N. Files` table found; nothing can be asserted',
    });
  }

  for (const row of files) {
    const required = row.steps.length === 0 || row.steps.some((step) => built.has(step));
    const present = existsSync(path.join(ROOT, row.path));
    const steps = row.steps.length > 0 ? `step ${row.steps.join(', ')}` : 'unassigned';

    if (!required) {
      findings.push({
        outcome: 'skip',
        label: row.path,
        detail: `${steps}: not claimed as built`,
      });
      continue;
    }
    findings.push(
      present
        ? { outcome: 'pass', label: row.path, detail: `${steps}: present` }
        : { outcome: 'fail', label: row.path, detail: `${steps}: MISSING from the tree` },
    );
  }

  for (const step of parseSteps(plan)) {
    if (!built.has(step.number)) {
      findings.push({
        outcome: 'skip',
        label: `step ${step.number}`,
        detail: `${step.title.slice(0, 60)}: not claimed as built`,
      });
      continue;
    }
    if (!step.check) {
      findings.push({
        outcome: 'fail',
        label: `step ${step.number}`,
        detail: 'claimed as built but has no `- Check:` command to reproduce it',
      });
      continue;
    }

    // A plan's check runs from the workspace whose package it names (`pnpm --filter
    // @clt/web test tests/admin/x.test.ts`), so a relative `tests/...` path is real
    // under `apps/web/` even though it does not exist at the repo root.
    const missing = pathsIn(step.check).filter(
      (file) =>
        !existsSync(path.join(ROOT, file)) && !existsSync(path.join(ROOT, 'apps/web', file)),
    );
    if (missing.length > 0) {
      findings.push({
        outcome: 'fail',
        label: `step ${step.number}`,
        detail: `check names missing path(s): ${missing.join(', ')}`,
      });
      continue;
    }

    if (!isExecutableStatic(step.check)) {
      if (!runAll) {
        findings.push({
          outcome: 'skip',
          label: `step ${step.number}`,
          detail: `non-static check, not run: ${step.check}`,
        });
        continue;
      }
      findings.push({
        outcome: 'skip',
        label: `step ${step.number}`,
        detail: `--run-all is not implemented for: ${step.check}`,
      });
      continue;
    }

    const result = runStatic(step.check);
    const mismatch = compareCount(step.expected, result.count);
    if (!result.ok && mismatch === null) {
      findings.push({
        outcome: 'fail',
        label: `step ${step.number}`,
        detail: `check failed (${result.output.split('\n')[0] || 'no output'}): ${step.check}`,
      });
      continue;
    }
    if (mismatch) {
      findings.push({ outcome: 'fail', label: `step ${step.number}`, detail: mismatch.detail });
      continue;
    }
    findings.push({
      outcome: 'pass',
      label: `step ${step.number}`,
      detail: `${step.check} → ${result.count ?? (result.ok ? 'ok' : 'failed')}`,
    });
  }

  return findings;
}

function main(): void {
  const args = process.argv.slice(2);
  const runAll = args.includes('--run-all');
  const plans = args.filter((arg) => !arg.startsWith('--'));

  if (plans.length === 0) {
    const available = readdirSync(path.join(ROOT, 'docs/plans'))
      .filter((name) => /^\d{3}_.*\.md$/.test(name))
      .sort();
    console.error('usage: pnpm plan:verify <docs/plans/NNN_name.md> [--run-all]');
    console.error(`plans available: ${available.join(', ')}`);
    process.exit(2);
  }

  let failed = 0;
  for (const plan of plans) {
    const findings = verify(plan, runAll);
    console.info(`\n${plan}`);
    for (const finding of findings) {
      const mark =
        finding.outcome === 'pass'
          ? 'ok  '
          : finding.outcome === 'fail'
            ? 'FAIL'
            : finding.outcome === 'skip'
              ? 'skip'
              : 'info';
      const stream = finding.outcome === 'fail' ? console.error : console.info;
      stream(`  ${mark}  ${finding.label} — ${finding.detail}`);
    }
    const planFailed = findings.filter((finding) => finding.outcome === 'fail').length;
    failed += planFailed;
    console.info(
      planFailed === 0
        ? `  ${findings.filter((f) => f.outcome === 'pass').length} claims hold`
        : `  ${planFailed} claim(s) do not hold`,
    );
  }

  process.exit(failed === 0 ? 0 : 1);
}

main();
