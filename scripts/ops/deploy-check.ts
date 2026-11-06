import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Handle CLI help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: tsx scripts/ops/deploy-check.ts [options]

Options:
  --env=<staging|production>      Target deployment environment (default: production)
  --milestone=<name>              Target readiness gate milestone (default: production)

Pre-deployment readiness verification:
1. Validates all Implementation Readiness Gates for target milestone.
2. Verifies owner written release authorization (ZIA-APPROVED) for target env in LEDGER.md.
3. For production: verifies open business policies Q1-Q4 have Status: CONFIRMED in DECISIONS.md.
`);
  process.exit(0);
}

export function parseCliArgs(args: string[] = process.argv.slice(2)): {
  targetEnv: string;
  milestone: string;
} {
  let targetEnv = 'production';
  let milestone = 'production';

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--env=')) targetEnv = args[i].split('=')[1];
    else if (args[i] === '--env' && i + 1 < args.length) targetEnv = args[++i];
    else if (args[i].startsWith('--milestone=')) milestone = args[i].split('=')[1];
    else if (args[i] === '--milestone' && i + 1 < args.length) milestone = args[++i];
  }
  return { targetEnv, milestone };
}

export function verifyApprovalString(content: string, targetEnv: string): boolean {
  // Use properly escaped RegExp constructor
  const approvalRegex = new RegExp(
    '^ZIA-APPROVED:\\s+CLT-REL-\\d+\\s+' + targetEnv + '\\s+\\d{4}-\\d{2}-\\d{2}',
    'm',
  );
  return approvalRegex.test(content);
}

export function verifyDecisionsConfirmed(content: string): { valid: boolean; missing: string[] } {
  const requiredPolicies = [
    { name: 'Q1 (VAT Rule)', pattern: 'Q1.*VAT' },
    { name: 'Q2 (Net Definition)', pattern: 'Q2.*Net' },
    { name: 'Q3 (Commission Structure)', pattern: 'Q3.*Commission' },
    { name: 'Q4 (Method Charges Borne)', pattern: 'Q4.*Charges' },
  ];

  const missing: string[] = [];
  for (const policy of requiredPolicies) {
    const sectionRegex = new RegExp('## [^\\n]*' + policy.pattern + '[\\s\\S]*?(?=## |$)', 'i');
    const match = content.match(sectionRegex);
    if (!match) {
      missing.push(`${policy.name} (section not found)`);
      continue;
    }
    const section = match[0];
    if (/PENDING/i.test(section) || !/Status:\s*CONFIRMED/i.test(section)) {
      missing.push(`${policy.name} (not confirmed)`);
    }
  }

  return { valid: missing.length === 0, missing };
}

/**
 * Deviation from the plan text: `--env` / `--milestone` flow into a shell
 * command, so they are validated against the documented vocabulary before use
 * (a hostile value must never reach execSync).
 */
const SAFE_ENV = /^(staging|production)$/;
const SAFE_MILESTONE = /^[A-Za-z0-9_-]{1,32}$/;

export async function verifyDeploymentReadiness(cliArgs?: string[]): Promise<void> {
  const { targetEnv, milestone } = parseCliArgs(cliArgs);

  if (!SAFE_ENV.test(targetEnv)) {
    console.error(`FAILED: --env must be 'staging' or 'production', got '${targetEnv}'.`);
    process.exit(1);
  }
  if (!SAFE_MILESTONE.test(milestone)) {
    console.error(`FAILED: --milestone contains unsupported characters: '${milestone}'.`);
    process.exit(1);
  }

  console.log(`Executing Pre-Deployment Operational Verification for Environment: ${targetEnv}...`);

  // 1. Verify Implementation Readiness Gates
  console.log(`Checking Implementation Readiness Gates for milestone: ${milestone}...`);
  try {
    execSync(`pnpm test:gates --milestone ${milestone}`, { stdio: 'inherit' });
  } catch {
    console.error(`FAILED: Implementation Readiness Gates not satisfied for ${milestone}.`);
    process.exit(1);
  }

  // 2. Verify Zia written approval (AGENTS.md Rule 19)
  console.log(`Checking Owner release approval string for environment: ${targetEnv}...`);
  const ledgerPath = path.resolve(process.cwd(), 'docs/orchestration/LEDGER.md');
  let approvalFound = false;
  if (fs.existsSync(ledgerPath)) {
    const content = fs.readFileSync(ledgerPath, 'utf-8');
    approvalFound = verifyApprovalString(content, targetEnv);
  }

  if (!approvalFound) {
    console.error(`FAILED: Missing mandatory written approval from Zia in docs/orchestration/LEDGER.md.`);
    console.error(`Format required: ZIA-APPROVED: <release id> ${targetEnv} <date>`);
    process.exit(1);
  }

  // 3. Verify Open Policy Confirmation Q1-Q4 (AGENTS.md Rule 20)
  if (targetEnv === 'production') {
    console.log('Checking business policy confirmation Q1-Q4 in DECISIONS.md...');
    const decisionsPath = path.resolve(process.cwd(), 'DECISIONS.md');
    if (!fs.existsSync(decisionsPath)) {
      console.error('FAILED: root DECISIONS.md does not exist.');
      process.exit(1);
    }
    const decisionsContent = fs.readFileSync(decisionsPath, 'utf-8');
    const { valid, missing } = verifyDecisionsConfirmed(decisionsContent);

    if (!valid) {
      console.error(`FAILED: Policy decisions missing or pending: ${missing.join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`All pre-deployment checks PASSED for ${targetEnv}. Release authorized.`);
}

if (process.argv[1] && process.argv[1].endsWith('deploy-check.ts')) {
  verifyDeploymentReadiness().catch((err) => {
    console.error('Deployment check failed:', err);
    process.exit(1);
  });
}
