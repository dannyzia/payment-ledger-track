import { describe, it, expect } from 'vitest';
import {
  parseCliArgs,
  verifyApprovalString,
  verifyDecisionsConfirmed,
} from '../../scripts/ops/deploy-check';

describe('deploy-check CLI Argument Parsing & Regex Validation', () => {
  it('defaults to production environment and milestone', () => {
    const parsed = parseCliArgs([]);
    expect(parsed.targetEnv).toBe('production');
    expect(parsed.milestone).toBe('production');
  });

  it('correctly parses --env=staging and --milestone=m2', () => {
    const parsed = parseCliArgs(['--env=staging', '--milestone=m2']);
    expect(parsed.targetEnv).toBe('staging');
    expect(parsed.milestone).toBe('m2');
  });

  it('matches valid ZIA-APPROVED string format with trailing date', () => {
    const validContent = `
# Ledger
ZIA-APPROVED: CLT-REL-001 production 2026-11-02
`;
    expect(verifyApprovalString(validContent, 'production')).toBe(true);
    expect(verifyApprovalString(validContent, 'staging')).toBe(false);
  });

  it('validates Q1-Q4 policies with Status: CONFIRMED', () => {
    const validDecisions = `
## CLT-POLICY-Q1: VAT Treatment Rule
Status: CONFIRMED

## CLT-POLICY-Q2: Net / Final Calculation Definition
Status: CONFIRMED

## CLT-POLICY-Q3: Commission Deduction Structure
Status: CONFIRMED

## CLT-POLICY-Q4: Method Charges Borne Allocation
Status: CONFIRMED
`;
    const res = verifyDecisionsConfirmed(validDecisions);
    expect(res.valid).toBe(true);
  });

  it('rejects decisions still marked PENDING', () => {
    const pendingDecisions = `
## CLT-POLICY-Q1: VAT Treatment Rule
Status: PENDING
`;
    const res = verifyDecisionsConfirmed(pendingDecisions);
    expect(res.valid).toBe(false);
  });
});
