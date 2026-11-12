import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Plan 020 §6.7 — Implementation Readiness Gate verification (PRD §18).
 * Collects machine-verifiable proof for Gates 1–4 at Milestone M2 and Gate 5
 * at M5, emits docs/orchestration/reports/GATE_EVIDENCE.json, and exits
 * non-zero when any applicable gate fails (Rule 12 ordering guarantee).
 *
 * Gate 5 now also runs the automated accessibility suite
 * (apps/web/tests/e2e/accessibility.spec.ts): WCAG AA contrast for the design
 * tokens in both themes, `prefers-reduced-motion` and
 * `prefers-reduced-transparency`. That closes the automatable part of CLT-R-008.
 * Haptics, WebView fallback, focus order on hardware and physical-device
 * rendering are not automatable and stay on
 * GATE5_PHYSICAL_DEVICE_CHECKLIST.md.
 *
 * `--gate5-only` evaluates Gate 5 alone at any milestone, including the
 * accessibility suite. The other gates need the database and the full
 * regression suite, so this flag exists to run and inspect the accessibility
 * evidence on its own. It writes GATE5_EVIDENCE.json rather than overwriting
 * the full GATE_EVIDENCE.json that Gates 1–4 produce.
 *
 * Run it against the throwaway E2E stack so the browser half has its center,
 * owner and staff fixtures: `pnpm test:e2e:isolated --gate5`.
 */

interface GateResult {
  satisfied: boolean;
  timestamp: string;
  evidence: string;
  status?: string;
  note?: string;
}

interface GateEvidenceReport {
  milestone: string;
  generatedAt: string;
  allSatisfied: boolean;
  gates: Record<string, GateResult>;
}

const gate5Only = process.argv.includes('--gate5-only');

const explicitMilestone =
  process.argv.find((a) => a.startsWith('--milestone='))?.split('=')[1] ||
  (process.argv.includes('--milestone')
    ? process.argv[process.argv.indexOf('--milestone') + 1]
    : undefined);

const milestoneArg = explicitMilestone || (gate5Only ? 'M5' : 'M2');

const ACCESSIBILITY_SPEC = 'tests/e2e/accessibility.spec.ts';
const E2E_NON_A11Y_CMD = 'pnpm --filter @clt/web exec playwright test --grep-invert "CLT-R-008"';
const ACCESSIBILITY_CMD = `pnpm --filter @clt/web exec playwright test ${ACCESSIBILITY_SPEC}`;

function tailEvidence(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  const sliced = output.slice(-maxChars);
  const firstNewline = sliced.indexOf('\n');
  return firstNewline === -1 ? sliced : sliced.slice(firstNewline + 1);
}

function runCmd(
  cmd: string,
  cwd: string = process.cwd(),
  timeoutMs: number = 120_000,
): { success: boolean; output: string } {
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: timeoutMs,
      env: { ...process.env, NODE_ENV: 'test' },
    });
    return { success: true, output: stdout };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { success: false, output: (e.stdout || '') + (e.stderr || '') + (e.message || '') };
  }
}

/**
 * Gate 5 — browser E2E plus the automated accessibility suite.
 * `pnpm test:e2e` alone proves only that the flows ran; the accessibility suite
 * is what measures contrast and honours the two preferences (CLT-R-008).
 */
function evaluateGate5(): GateResult {
  const timestamp = new Date().toISOString();

  if (!gate5Only && milestoneArg.toUpperCase() === 'M2') {
    return {
      satisfied: true,
      status: 'deferred_to_m5',
      note: 'Gate 5 visual and physical device validation deferred to Milestone M5 per PRD §18',
      timestamp,
      evidence: 'Deferred to Milestone M5',
    };
  }

  // Both suites start their own dev server and drive a real browser, so the
  // 120s default is too tight once they run back to back.
  const gate5TimeoutMs = 600_000;
  const e2e = runCmd(E2E_NON_A11Y_CMD, process.cwd(), gate5TimeoutMs);
  const a11y = runCmd(ACCESSIBILITY_CMD, process.cwd(), gate5TimeoutMs);
  const satisfied = e2e.success && a11y.success;

  return {
    satisfied,
    status: satisfied ? 'automated_checks_passed' : 'failed',
    timestamp,
    evidence: [
      `[browser e2e (non-a11y)] exit ${e2e.success ? 0 : 1}`,
      tailEvidence(e2e.output, 1200),
      `[accessibility: WCAG AA contrast, prefers-reduced-motion, prefers-reduced-transparency] exit ${a11y.success ? 0 : 1}`,
      tailEvidence(a11y.output, 1200),
    ].join('\n'),
    note: [
      'Covers WCAG AA token contrast in light and dark themes, prefers-reduced-motion and prefers-reduced-transparency.',
      'Haptics, WebView fallback and physical-device rendering remain on the manual Gate 5 checklist (CLT-R-008).',
      satisfied ? '' : 'One of the automated Gate 5 commands failed; see evidence.',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

async function verifyGates(): Promise<void> {
  console.info(
    gate5Only
      ? `Evaluating Gate 5 only (--gate5-only, milestone ${milestoneArg})...`
      : `Starting Implementation Readiness Gate Evaluation for Milestone ${milestoneArg}...`,
  );

  const gates: Record<string, GateResult> = {};

  if (!gate5Only) {
    // Gate 1: Database Security Proof (Suite 1 of the 65-test regression suite)
    console.info('Evaluating Gate 1 (Database Proof)...');
    // Root-level vitest CLI filters cannot resolve cross-workspace files in this
    // repo layout; the --filter invocations are the verified equivalents.
    const gate1 = runCmd('pnpm --filter @clt/web test tests/regression/suite.test.ts -t "Suite 1"');
    gates['Gate 1 (Database Proof)'] = {
      satisfied: gate1.success,
      timestamp: new Date().toISOString(),
      evidence: tailEvidence(gate1.output, 2000),
    };

    // Gate 2: Financial Calculation Proof (properties + parity + view parity)
    console.info('Evaluating Gate 2 (Financial Proof)...');
    const gate2A = runCmd('pnpm --filter @clt/calc test');
    const gate2B = runCmd('pnpm --filter @clt/web test tests/calc/parity.test.ts');
    const gate2C = runCmd('pnpm --filter @clt/web test tests/reports/view_parity.test.ts');
    gates['Gate 2 (Financial Proof)'] = {
      satisfied: gate2A.success && gate2B.success && gate2C.success,
      timestamp: new Date().toISOString(),
      evidence: tailEvidence(gate2A.output + gate2B.output + gate2C.output, 2000),
    };

    // Gate 3: Sync & Offline Protocol Proof (all 65 regression tests)
    console.info('Evaluating Gate 3 (Sync & Regression Proof)...');
    const gate3 = runCmd('pnpm test:regression');
    gates['Gate 3 (Sync Proof)'] = {
      satisfied: gate3.success,
      timestamp: new Date().toISOString(),
      evidence: tailEvidence(gate3.output, 2000),
    };

    // Gate 4: Settlement & Reconciliation Lifecycle Proof (Suites 4 and 5)
    console.info('Evaluating Gate 4 (Lifecycle Proof)...');
    const gate4A = runCmd(
      'pnpm --filter @clt/web test tests/regression/suite.test.ts -t "Suite 4"',
    );
    const gate4B = runCmd(
      'pnpm --filter @clt/web test tests/regression/suite.test.ts -t "Suite 5"',
    );
    gates['Gate 4 (Lifecycle Proof)'] = {
      satisfied: gate4A.success && gate4B.success,
      timestamp: new Date().toISOString(),
      evidence: tailEvidence(gate4A.output + gate4B.output, 2000),
    };
  }

  // Gate 5: Accessibility & Visual Proof — automated portion, deferred to M5
  console.info('Evaluating Gate 5 (Accessibility & Visual Proof)...');
  gates['Gate 5 (Accessibility Proof)'] = evaluateGate5();

  const allSatisfied = Object.values(gates).every((g) => g.satisfied);

  const report: GateEvidenceReport = {
    milestone: milestoneArg,
    generatedAt: new Date().toISOString(),
    allSatisfied,
    gates,
  };

  const reportDir = path.resolve(process.cwd(), 'docs/orchestration/reports');
  fs.mkdirSync(reportDir, { recursive: true });
  // A Gate 5-only run must not overwrite the full Gate 1–4 evidence record.
  const reportName = gate5Only ? 'GATE5_EVIDENCE.json' : 'GATE_EVIDENCE.json';
  fs.writeFileSync(path.join(reportDir, reportName), JSON.stringify(report, null, 2));

  if (!allSatisfied) {
    console.error(`Gate verification FAILED for ${milestoneArg}.`);
    process.exit(1);
  }

  console.info(
    gate5Only
      ? 'Gate 5 automated evaluation passed (accessibility suite + browser e2e).'
      : `All Implementation Readiness Gates passed for Milestone ${milestoneArg}.`,
  );
}

verifyGates().catch((err) => {
  console.error('Fatal gate verification error:', err);
  process.exit(1);
});
