import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { assessDeviceCheck, deviceCheckEnv, summarizeGateReport } from './gate-device-check';

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
 * At M5 the report also records `pnpm test:e2e:device`, which signs the connected
 * handset in as each fixture and checks the role gates on the hardware (GS-4:
 * `pnpm test:e2e` never touches a device). That entry distinguishes a check that
 * ran and failed from one that could not start — a missing handset or missing
 * fixture credentials is recorded as `not_run_*` and does not fail the gate
 * command, but it is never written as a pass, and the run prints a warning that
 * the report holds no device result.
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

const DEVICE_CHECK_CMD = 'pnpm test:e2e:device';
// Three staged device checks, each with its own preflight.
const DEVICE_CHECK_TIMEOUT_MS = 900_000;

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
  env: NodeJS.ProcessEnv = process.env,
): { success: boolean; output: string } {
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: timeoutMs,
      env: { ...env, NODE_ENV: 'test' },
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

/**
 * Gate 5 — the physical-device half. Recorded in its own entry so the report can
 * never imply that a green browser run proves the handset (GS-4).
 */
function evaluateDeviceCheck(): GateResult {
  const timestamp = new Date().toISOString();
  console.info(`Evaluating Gate 5 physical device check (${DEVICE_CHECK_CMD})...`);
  // Stripped of the browser suites' stack overrides: the handset talks to its own
  // backend, so inheriting the isolated stack's DATABASE_URL fails every fixture.
  const result = runCmd(
    DEVICE_CHECK_CMD,
    process.cwd(),
    DEVICE_CHECK_TIMEOUT_MS,
    deviceCheckEnv(process.env),
  );
  const assessment = assessDeviceCheck({ success: result.success, output: result.output });

  return {
    satisfied: assessment.satisfied,
    status: assessment.status,
    timestamp,
    evidence: [
      `[${DEVICE_CHECK_CMD}] exit ${result.success ? 0 : 1}`,
      tailEvidence(result.output, 2000),
    ].join('\n'),
    note: assessment.note,
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

  // The device half only exists outside M2; at M2 Gate 5 is deferred wholesale.
  if (gate5Only || milestoneArg.toUpperCase() !== 'M2') {
    gates['Gate 5 (Physical Device)'] = evaluateDeviceCheck();
  }

  // Report truth (Rule 16): allSatisfied is true ONLY when every gate in the
  // report actually passed. A missing handset/fixture keeps allSatisfied=false
  // while allowing headless CI / non-device runs to exit 0 via
  // blockingChecksPassed and printing explicit warnings below.
  const { allSatisfied, blockingChecksPassed } = summarizeGateReport(gates);

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

  const deviceGate = gates['Gate 5 (Physical Device)'];
  if (deviceGate && !deviceGate.satisfied) {
    console.warn(
      [
        '',
        `⚠ Gate 5 physical device check did NOT pass (status: ${deviceGate.status}).`,
        `  ${deviceGate.note}`,
        `  ${path.join(reportDir, reportName)} therefore records allSatisfied: false with no passing device result.`,
        '  Gate 5 sign-off needs the pasted pnpm test:e2e:device output (checklist item H36).',
      ].join('\n'),
    );
  }

  if (!blockingChecksPassed) {
    console.error(`Gate verification FAILED for ${milestoneArg}.`);
    process.exit(1);
  }

  if (deviceGate && !deviceGate.satisfied) {
    // Never let an unrun device check sit under a blanket "passed" line: that is
    // precisely the GS-4 misreading this entry exists to prevent.
    console.info(
      gate5Only
        ? 'Gate 5 machine-checkable subset passed (accessibility suite + browser e2e), but the physical device check was not run — Gate 5 is not signed off.'
        : `All machine-checkable gates passed for Milestone ${milestoneArg}, but the Gate 5 physical device check was not run — the milestone is not device-verified.`,
    );
  } else {
    console.info(
      gate5Only
        ? 'Gate 5 automated evaluation passed (accessibility suite + browser e2e + physical device check).'
        : `All Implementation Readiness Gates passed for Milestone ${milestoneArg}, including the physical device check.`,
    );
  }
}

verifyGates().catch((err) => {
  console.error('Fatal gate verification error:', err);
  process.exit(1);
});
