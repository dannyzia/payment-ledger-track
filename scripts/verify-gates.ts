import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Plan 020 §6.7 — Implementation Readiness Gate verification (PRD §18).
 * Collects machine-verifiable proof for Gates 1–4 at Milestone M2 and Gate 5
 * at M5, emits docs/orchestration/reports/GATE_EVIDENCE.json, and exits
 * non-zero when any applicable gate fails (Rule 12 ordering guarantee).
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

const milestoneArg = process.argv.find((a) => a.startsWith('--milestone='))?.split('=')[1] ||
                     (process.argv.includes('--milestone') ? process.argv[process.argv.indexOf('--milestone') + 1] : 'M2');

function runCmd(cmd: string, cwd: string = process.cwd()): { success: boolean; output: string } {
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
      env: { ...process.env, NODE_ENV: 'test' },
    });
    return { success: true, output: stdout };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { success: false, output: (e.stdout || '') + (e.stderr || '') + (e.message || '') };
  }
}

async function verifyGates(): Promise<void> {
  console.log(`Starting Implementation Readiness Gate Evaluation for Milestone ${milestoneArg}...`);

  // Gate 1: Database Security Proof (Suite 1 of the 65-test regression suite)
  console.log('Evaluating Gate 1 (Database Proof)...');
  // Root-level vitest CLI filters cannot resolve cross-workspace files in this
  // repo layout; the --filter invocations are the verified equivalents.
  const gate1 = runCmd('pnpm --filter @clt/web test tests/regression/suite.test.ts -t "Suite 1"');

  // Gate 2: Financial Calculation Proof (properties + parity + view parity)
  console.log('Evaluating Gate 2 (Financial Proof)...');
  const gate2A = runCmd('pnpm --filter @clt/calc test');
  const gate2B = runCmd('pnpm --filter @clt/web test tests/calc/parity.test.ts');
  const gate2C = runCmd('pnpm --filter @clt/web test tests/reports/view_parity.test.ts');
  const gate2Success = gate2A.success && gate2B.success && gate2C.success;

  // Gate 3: Sync & Offline Protocol Proof (all 65 regression tests)
  console.log('Evaluating Gate 3 (Sync & Regression Proof)...');
  const gate3 = runCmd('pnpm test:regression');

  // Gate 4: Settlement & Reconciliation Lifecycle Proof (Suites 4 and 5)
  console.log('Evaluating Gate 4 (Lifecycle Proof)...');
  const gate4A = runCmd('pnpm --filter @clt/web test tests/regression/suite.test.ts -t "Suite 4"');
  const gate4B = runCmd('pnpm --filter @clt/web test tests/regression/suite.test.ts -t "Suite 5"');
  const gate4Success = gate4A.success && gate4B.success;

  // Gate 5: Accessibility & Visual Proof — deferred to M5 for M2 evaluation
  console.log('Evaluating Gate 5 (Accessibility & Visual Proof)...');
  let gate5Result: GateResult;
  if (milestoneArg.toUpperCase() === 'M2') {
    gate5Result = {
      satisfied: true,
      status: 'deferred_to_m5',
      note: 'Gate 5 visual and physical device validation deferred to Milestone M5 per PRD §18',
      timestamp: new Date().toISOString(),
      evidence: 'Deferred to Milestone M5',
    };
  } else {
    const gate5 = runCmd('pnpm test:e2e');
    gate5Result = {
      satisfied: gate5.success,
      timestamp: new Date().toISOString(),
      evidence: gate5.output.slice(-2000),
    };
  }

  const allSatisfied = gate1.success && gate2Success && gate3.success && gate4Success && gate5Result.satisfied;

  const report: GateEvidenceReport = {
    milestone: milestoneArg,
    generatedAt: new Date().toISOString(),
    allSatisfied,
    gates: {
      'Gate 1 (Database Proof)': {
        satisfied: gate1.success,
        timestamp: new Date().toISOString(),
        evidence: gate1.output.slice(-2000),
      },
      'Gate 2 (Financial Proof)': {
        satisfied: gate2Success,
        timestamp: new Date().toISOString(),
        evidence: (gate2A.output + gate2B.output + gate2C.output).slice(-2000),
      },
      'Gate 3 (Sync Proof)': {
        satisfied: gate3.success,
        timestamp: new Date().toISOString(),
        evidence: gate3.output.slice(-2000),
      },
      'Gate 4 (Lifecycle Proof)': {
        satisfied: gate4Success,
        timestamp: new Date().toISOString(),
        evidence: (gate4A.output + gate4B.output).slice(-2000),
      },
      'Gate 5 (Accessibility Proof)': gate5Result,
    },
  };

  const reportDir = path.resolve(process.cwd(), 'docs/orchestration/reports');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'GATE_EVIDENCE.json'), JSON.stringify(report, null, 2));

  if (!allSatisfied) {
    console.error(`Gate verification FAILED for ${milestoneArg}.`);
    process.exit(1);
  }

  console.log(`All Implementation Readiness Gates passed for Milestone ${milestoneArg}.`);
}

verifyGates().catch((err) => {
  console.error('Fatal gate verification error:', err);
  process.exit(1);
});
