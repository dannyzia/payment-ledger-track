# PRD: Payment Ledger App (working name `ledger`)

- Version: 1.12 (reviewed specification — production implementation-ready; resolved settlement payment row-lock ordering, live statement expected recalculation, devices sync race condition & honest-client heuristic, devices table RLS & admin route, unmatch statement line active flag, bootstrap payment method txn_ref consistency, test suite numbering, and audit matrix coverage)
- Date: 2026-10-29
- Owner: Zia (Bangladesh)
- Audience: AI coding agents and AI reviewers. Humans may read it, but it is written to be executed.
- Status of the spec: calculation rules are CONFIGURABLE because the business has not confirmed them. Section 4 lists every open item and the default that agents must implement. Section 18 establishes the mandatory Implementation Readiness Gate before production deployment.

---

## 0. Rules for implementing agents

1. Never hardcode a rate, a VAT rule, or a commission rule. All come from `rate_profiles` (admin-editable). The numbers in section 6.6 are TEST FIXTURES only. Entries must use the published rate profile effective on their `entry_date`.
2. Money is an integer in poisha (1 BDT = 100 poisha). No floats anywhere in money paths (client, server, SQL, tests).
3. One calculation module (`packages/calc`) is imported by the UI, the offline layer, the server, and the tests. Do not reimplement it.
4. Entries are immutable snapshots. Changing a rate never changes an existing entry. Legitimate offline entries created under a profile published for `entry_date` are preserved with `stale_rates = true` if a newer profile was published while offline.
5. If a requirement is listed as OPEN in section 4, implement the stated default behind a setting, and do not invent other behavior. If something is not specified anywhere, choose the simplest option and record it in `DECISIONS.md`.
6. Every state change on entries, rates, users, settlements, reconciliation, and month close writes an `audit_log` row.
7. The app must be usable with no network (section 9). Never block a Save on connectivity.
8. Build order is section 17. Do not start a milestone before the previous one passes its Definition of Done and Section 18 readiness conditions.
9. All financial writes are table-revoked and execute strictly through `SECURITY DEFINER` RPCs under `service_role`. All 18 tables have Row Level Security enabled.

---

## 1. Summary

A modern offline-capable web app (later a Capacitor mobile app) that replaces a handwritten payment ledger. Staff record each payment a customer made as ONE gross amount. The app splits it into VAT, commission, and a payment-method charge (bKash, Visa, Mastercard, others) using admin-set percentages. It stores the result, produces monthly reports that double as the statement the business pays from (VAT, bKash charges, card charges), tracks those monthly payments, and reconciles them against real statements.

The app does NOT collect money directly from customers. Staff enter payments that were already received.

## 2. Goals and non-goals

Goals:

1. Entry in under 20 seconds on a phone.
2. Automatic, admin-configurable deductions with a live breakdown while typing.
3. Accurate monthly totals: commission, VAT, bKash charge, Visa charge, Mastercard charge.
4. Settlement tracking with fixed monthly due dates, plus reconciliation against statements (supporting both totals-only manual statements and line-item file statements).
5. Offline-first with automatic sync.
6. Role-based access (Owner, Admin, Staff) and a dashboard per role.
7. Distinctive, modern, non-dated look (section 14) with verified WCAG AA (>= 4.5:1) light and dark mode contrast.
8. SvelteKit now, Capacitor packaging later with no rewrite.

Non-goals (v1):

- Online payment collection or gateways.
- Full accounting (invoices, double-entry, tax filing).
- Customer portal.
- Automatic bank or bKash API feeds (reconciliation uses entered totals or uploaded statement files).

## 3. Roles and permissions

Exactly one active Owner account (enforced by a unique partial index `one_owner` for maximum 1, plus a DB trigger `trg_prevent_zero_owners` and initial migration check to guarantee at least 1; ownership transfers are performed atomically via `transfer_ownership()` RPC). Roles are enforced server-side (RLS plus server checks). Hiding UI is not enforcement.

| Capability | Staff | Admin | Owner |
|---|---|---|---|
| Create entries | yes | yes | yes |
| View entries | own only | all | all |
| Edit or void an entry | request void only | yes | yes |
| Dashboard | personal | operations | financial |
| Monthly reports and export | no | yes | yes |
| Record settlement payments | no | yes | yes |
| Run and mark reconciliation | no | yes | yes |
| Close or reopen a month | no | no | yes |
| Change rates and rules (no approval needed) | no | yes | yes |
| Manage payment methods and payables | no | yes | yes |
| Manage Staff users | no | yes | yes |
| Manage Admins | no | no | yes |
| Transfer ownership | no | no | yes |
| View audit log | no | yes | yes |

Auth: Supabase Auth, email plus password. A device must log in online once. After that the app opens and works offline from the cached session and local data. Refresh tokens renew on reconnect.

## 4. Open items (blocking or configurable)

Format: item, status, default agents implement until answered.

| # | Item | Status | Default to implement |
|---|---|---|---|
| Q1 | VAT rule. Ledger values are not a flat rate: 3300 to 300, 5909 to 509, 8384 to 584. | OPEN | `vat_mode = manual`: staff type a VAT amount per entry (as in historical paper ledger). Also support `percent_of_gross` and `percent_inclusive` as forward-looking admin options. |
| Q2 | Meaning of the ledger "Final" column and who receives it. | OPEN | Field `net_after_deductions`, shown with an admin-editable label. |
| Q3 | Commission ("BKL 42%" in the ledger): flat for everyone or varies by product or partner. | OPEN | One commission rate per rate profile. Per-entry commission override with reason. |
| Q4 | Who bears method charges. | OPEN | `charges_borne_by = business` (charge is deducted in `net_after_deductions`, as in the ledger). When `charges_borne_by = customer`, method charge is not deducted from net and does not form a business settlement liability with the provider. |
| Q5 | Visa and Mastercard rates equal or different. | OPEN | Separate `method_rates` row per method. |
| Q6 | Other methods (cash, bank transfer, Nagad, Rocket, cheque). | OPEN | Seed: Cash, Bank transfer, bKash, Visa, Mastercard. Cash and Bank transfer charge 0. Admin can add more. |
| Q7 | Recalculate old entries under new rates. | DECIDED default | Not supported in v1. Entries retain immutable snapshots. |
| Q8 | What Staff may edit or void. | OPEN | Staff see own entries only and can request a void with a mandatory reason. Admin or Owner approves. |
| Q9 | Customer name required. | OPEN | Required, free text. |
| Q10 | Users and devices at start. | OPEN | Design for up to 20 users. |
| Q11 | Import of paper ledger history. | OPEN | Out of v1. Keep CSV import hook in the roadmap. |
| Q12 | Number format and language. | OPEN | English UI, BDT, South Asian digit grouping (1,23,456.00), Latin digits. i18n-ready (all strings via a message catalog; Bangla later). |
| Q13 | Receipts for customers. | OPEN | Out of v1. |
| Q14 | Statement file formats (bKash merchant statement, card settlement report, VAT challan). | OPEN | Dual reconciliation modes: totals-only mode (`source = 'manual_total'`) ships first; line-item adapter mode (`source = 'file'`) follows once samples are provided. |
| Q15 | Transaction ID mandatory? | DECIDED | Method-specific: mandatory for methods with `requires_txn_ref = true` (seed: bKash, Visa, Mastercard); optional for unreferenced methods (Cash, walk-in). |

Decided by the owner:

- Admin changes rates alone. No Owner approval.
- Single Owner account.
- Each payable (VAT, bKash, Visa, Mastercard) has a fixed monthly due date set in the admin panel.
- Reconciliation is in v1 and covers the bKash merchant statement, the card settlement report, and the VAT challan.
- Staff enter a transaction (tracing) ID with each payment where applicable (mandatory whenever `payment_methods.requires_txn_ref = true`, optional for cash/unreferenced methods).
- Sub field in the ledger represents a countable integer quantity of sessions or service units (values 1 and 2 in the paper ledger, which explicitly sum to 16 in the paper totals). Stored as `sub_qty int not null default 1 check (sub_qty >= 0)`, with an optional `sub_description text` for qualitative notes. Reports include `sum(sub_qty)` in monthly totals.
- All percentages come from the admin panel. Nothing is assumed from the paper ledger.
- **Production Release Precondition (Review finding)**: Prior to production deployment (Milestone M5), the business owner must confirm the default values or specify actual business values for Q1 (VAT rule), Q2 (Net/Final definition), Q3 (Commission structure), and Q4 (Who bears payment method charges). The software remains fully configurable via `rate_profiles`, but production sign-off requires business owner confirmation recorded in `DECISIONS.md`.

## 5. Core concepts

- Entry: one payment received from one customer. Immutable after save except void and supersede.
- Payment method: admin-defined, each with a charge rate per rate profile.
- Rate profile: versioned set of rules effective from a date. New edit creates a new version. Old versions are never changed or deleted.
- Snapshot: the exact rules used, stored inside each entry.
- Payable: an amount the business pays monthly. Seed: VAT, bKash charges, Visa charges, Mastercard charges. Each has `due_day`.
- Settlement: one payable for one month, with expected amount, paid amount, status.
- Statement: an external document (bKash, card, VAT challan) for one payable and one month, used for reconciliation.
- Month close: Owner action that locks a month.

## 6. Calculation engine (`packages/calc`)

### 6.1 Types and wire format

```ts
// Internal representation: native bigint in poisha (1 BDT = 100 poisha).
// Wire format: All Poisha and 64-bit sequence values MUST be serialized as decimal strings in JSON
// (e.g., "590900", "1042") to prevent IEEE-754 precision loss and JSON.stringify BigInt crashes.
type Poisha = bigint;

interface RateSnapshot {
  rateProfileId: string;
  version: number;
  engineVersion: number;            // H2: integer calculation engine version (current: 1)
  vat: { mode: 'manual' | 'percent_of_gross' | 'percent_inclusive'; bp: number };
  commission: { bp: number; base: 'gross' | 'gross_minus_vat' };
  chargeBp: number;                 // basis points for the chosen payment method
  chargesBorneBy: 'business' | 'customer';
  rounding: 'half_up';
}

interface CalcInput {
  grossPoisha: Poisha;
  snapshot: RateSnapshot;
  // Mutually exclusive VAT inputs per mode (F20):
  // When snapshot.vat.mode === 'manual': vatInputPoisha is REQUIRED; vatOverridePoisha is FORBIDDEN.
  // When snapshot.vat.mode in ('percent_of_gross','percent_inclusive'): vatInputPoisha is FORBIDDEN;
  // vatOverridePoisha is OPTIONAL (requires vatOverrideReason).
  vatInputPoisha?: Poisha;
  vatOverridePoisha?: Poisha;
  commissionOverridePoisha?: Poisha; // optional in all modes (requires commissionOverrideReason)
}

interface CalcResult {
  grossPoisha: Poisha;
  vatPoisha: Poisha;
  commissionPoisha: Poisha;
  chargePoisha: Poisha;              // Total calculated provider charge
  businessChargePoisha: Poisha;      // chargesBorneBy === 'business' ? charge : 0 (business liability)
  customerChargePoisha: Poisha;      // chargesBorneBy === 'customer' ? charge : 0 (informational)
  netAfterDeductionsPoisha: Poisha;  // gross - vat - commission - businessCharge
}
```

Rates are integers in basis points (1 bp = 0.01 percent). Examples: 1.15 percent = 115, 1.5 percent = 150, 42 percent = 4200, 10 percent = 1000.

### 6.2 Rounding

`mulBp(amount, bp) = floor((amount * bp + 5000n) / 10000n)` (round half up on non-negative integers).

### 6.3 Formulas and Input Validation

#### Input Validation Rules (F20)
Before executing calculations, `packages/calc` enforces strict mode-input mutual exclusivity and arithmetic sanity bounds:
- **`mode === 'manual'`**:
  - `vatInputPoisha` must be provided, `>= 0n`, and `<= grossPoisha` (VAT cannot exceed gross amount). If `vatInputPoisha > grossPoisha`, throw `InvalidCalcInputError('VAT input cannot exceed gross amount')`.
  - `vatOverridePoisha` must be undefined/null. If provided, throw `InvalidCalcInputError('VAT override is forbidden in manual VAT mode')`.
- **`mode === 'percent_of_gross'` or `'percent_inclusive'`**:
  - `vatInputPoisha` must be undefined/null. If provided, throw `InvalidCalcInputError('Manual VAT input is forbidden in percentage VAT modes')`.
  - `vatOverridePoisha` is optional. If provided, it must be `>= 0n` and `<= grossPoisha`.
- **Commission overrides**:
  - `commissionOverridePoisha` is optional in all modes. If provided, it must be `>= 0n` and `<= grossPoisha`.

#### Calculation Logic
```
vat =
  vatInputPoisha                                      if mode = manual (required regular input)
  else vatOverridePoisha                              if provided in percent modes (exceptional override)
  else mulBp(gross, vat.bp)                           if mode = percent_of_gross
  else gross - roundHalfUp(gross * 10000n, 10000n + vat.bp) if mode = percent_inclusive

  roundHalfUp(numerator, divisor) = floor((numerator + floor(divisor / 2n)) / divisor)
  -- percent_inclusive extracts: base = roundHalfUp(gross × 10000, 10000 + bp), vat = gross − base

commissionBase = gross                    if commission.base = gross
               = gross - vat              if commission.base = gross_minus_vat
commission     = commissionOverridePoisha ?? mulBp(commissionBase, commission.bp)

charge         = mulBp(gross, chargeBp)
businessCharge = (chargesBorneBy = business ? charge : 0n)
customerCharge = (chargesBorneBy = customer ? charge : 0n)

net            = gross - vat - commission - businessCharge
```

Guards and Precedence Rules:
- **Guard Precedence**: When checking constraints, the **Authoritative Per-Entry Deduction Guard** (`vat + commission + businessCharge <= gross`) is evaluated FIRST. If total deductions exceed gross, `packages/calc` immediately throws `DeductionsExceedGrossError` with an exact numeric breakdown (preventing intermediate negative balances or silent clamping).
- **Universal Non-Negativity**: After total deduction verification, each individual component is asserted `>= 0n`.
- **Charge Partitioning Identity**: `businessCharge + customerCharge === charge`.
- **Balancing Identity**: `vat + commission + businessCharge + net === gross`.

### 6.4 Rules

- Each component is rounded individually, then net is computed from rounded components, so printed numbers always add up.
- Pure functions, no I/O, no Date, no randomness.
- Same package runs in browser (UI / Dexie), Node (server sync handler), and tests.

### 6.5 Server authorization and snapshot verification

The server NEVER trusts client-supplied snapshots or authorization claims:
1. **Identity & Role Enforcement**: Derives user ID and role strictly from the verified Supabase Auth JWT (`auth.uid()`). Any client-supplied `created_by` or role field in the operation payload is ignored.
2. **Account Status Check**: Checks that the user account is active in `profiles` (`active = true`). If deactivated, rejects with `403 user_deactivated`.
3. **Effective Date Rate Verification & Stale Rate Reconciliation (Finding A3, Rule #4, H3)**:
   - Checks whether the submitted profile was published and effective for `entry_date`:
     `SELECT * FROM rate_profiles WHERE id = $submitted_profile_id AND status = 'published' AND effective_from <= $entry_date;`
     If no row is returned, the profile was never valid for that date (e.g., forward-dated profile or unpublished draft) $\to$ hard-rejects with `403 rate_profile_date_mismatch`.
   - **Client Rate Watermark Check (Honest-Client Anti-Cherry-Picking Heuristic, H3)**:
     Queries the expected profile against the client's cached rate profile watermark (`maxKnownRateVersion` recorded in `OutboxOp` at entry creation, defaulting to submitted snapshot version if omitted):
     `SELECT id FROM rate_profiles WHERE status = 'published' AND effective_from <= $entry_date AND version <= $op_max_known_rate_version ORDER BY effective_from DESC, version DESC LIMIT 1;`
     If `submitted.id != expected.id`: The client already possessed a newer applicable profile in its local cache and cherry-picked an older one $\to$ hard-rejects with `403 rate_profile_date_mismatch` (passes Test #41).
     *Defense-in-Depth Device Grounding (H3)*: The server cross-references `op_max_known_rate_version` against `devices.last_rate_version` for registered devices; if an entry claims a watermark strictly lower than a rate version already delivered to that device during `/sync/pull` AND `op.clientCreatedAt > devices.last_seen_at` (i.e., the entry claims to have been created *after* the device already pulled the newer rate version), the op is rejected as tampered. Legitimate offline entries created before the device pulled the newer rate version (`op.clientCreatedAt <= devices.last_seen_at`) are accepted.
   - **Authoritative Server Watermark Check (Offline Stale Rate Preservation, Rule #4)**:
     Queries the latest published profile in the database effective for `entry_date`:
     `SELECT id FROM rate_profiles WHERE status = 'published' AND effective_from <= $entry_date ORDER BY effective_from DESC, version DESC LIMIT 1;`
     - If `submitted.id == latest.id`: Entry was recorded with the current rate profile $\to$ sets `entries.stale_rates = false`.
     - If `submitted.id != latest.id`: A newer profile was published on the server while the client was offline. The server honors Rule #4 (entries are immutable snapshots), preserves the client snapshot and calculated components, inserts the entry with `entries.stale_rates = true`, and raises an alert on the Admin/Owner dashboard (passes Test #46 and Test #9). Stale-rate entries exceeding ৳50,000 gross require administrative review flag confirmation.
   - **Snapshot Integrity Check**: Confirms that the profile exists, that `method_id` is covered in `method_rates`, and that stored values (`version`, `engineVersion`, `vat`, `commission`, `charge_bp`, `charges_borne_by`) match the submitted snapshot identically. If snapshot values do not match, rejects with `403 invalid_snapshot_rules`.
4. **Engine Version Skew Check (H2)**:
   - The snapshot contains `engineVersion: 1` (integer). If the server engine version is incompatible with the client snapshot engine version, the server rejects with `426 upgrade_required` and logs `sync.upgrade_required`.
5. **Independent Recomputation**:
   - Server extracts the explicit inputs: `gross_poisha`, verified snapshot, `vat_input_poisha`, `vat_override_poisha`, and `commission_override_poisha`.
   - Recomputes `packages/calc`.
   - If any calculated component (`vat_poisha`, `commission_poisha`, `charge_poisha`, `business_charge_poisha`, `customer_charge_poisha`, `net_poisha`) differs from the client-submitted values, rejects with `422 calc_mismatch` and writes an audit log alert.

### 6.6 Test fixtures from the paper ledger

> **Note on Historical Paper Ledger VAT**: The historical paper ledger entries below reflect hand-calculated VAT amounts (`vat_mode = 'manual'`). The effective VAT percentages in the paper ledger (3300→300 = 9.09%, 5909→509 = 8.61%, 8384→584 = 6.97%) cannot be reproduced by any single flat percentage rate. `vat_mode = 'manual'` is the only mode validated against historical ledger records. Percentage modes (`percent_of_gross`, `percent_inclusive`) are forward-looking policy options for digital operation.

Fixture profile: `vat.mode = manual`, `commission = { bp: 4200, base: 'gross_minus_vat' }`, `chargesBorneBy = business`, charge bp: bKash 115, Visa 150, Mastercard 150, Cash 0. Visa and Mastercard are treated as one "card" rate of 150 only because the ledger does not distinguish them.

All values below are in **integer poisha** (Rule #2). Human-readable BDT (1 BDT = 100 poisha) is shown for reference.

| # | Customer (as read) | Sub (qty) | Method | Gross (poisha) | VAT (poisha) | Commission (poisha) | Charge (poisha) | Net (poisha) | Net Display (BDT) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Ayash | 2 | bKash | 590900 | 50900 | 226800 | 6795 | 306405 | ৳3,064.05 |
| 2 | Abida | 1 | Cash | 330000 | 30000 | 126000 | 0 | 174000 | ৳1,740.00 |
| 3 | Ahiyan | 2 | Cash | 590900 | 50900 | 226800 | 0 | 313200 | ৳3,132.00 |
| 4 | Suhaima (H) | 2 | Card | 838400 | 58400 | 327600 | 12576 | 439824 | ৳4,398.24 |
| 5 | Tahra | 2 | Card | 590900 | 50900 | 226800 | 8864 | 304336 | ৳3,043.36 |
| 6 | Aaan | 2 | Card | 590900 | 50900 | 226800 | 8864 | 304336 | ৳3,043.36 |
| 7 | Azlan | 1 | Card | 330000 | 30000 | 126000 | 4950 | 169050 | ৳1,690.50 |
| 8 | Mandisha | 1 | Cash | 330000 | 30000 | 126000 | 0 | 174000 | ৳1,740.00 |
| 9 | Autnika | 1 | Cash | 330000 | 30000 | 126000 | 0 | 174000 | ৳1,740.00 |
| 10 | Tridha | 2 | Card | 590900 | 50900 | 226800 | 8864 | 304336 | ৳3,043.36 |

Customer spellings are from handwriting and may be slightly off. Use them only as fixture labels.

Totals that MUST match in tests (asserted in integer poisha):
- Total Sub quantity: 16
- Total Gross: 5,112,900 poisha (৳51,129.00)
- Total VAT: 432,900 poisha (৳4,329.00)
- Total Commission: 1,965,600 poisha (৳19,656.00)
- Total bKash charge: 6,795 poisha (৳67.95)
- Total Card charge: 44,118 poisha (৳441.18)
- Total Net after deductions: 2,663,487 poisha (৳26,634.87)

Rounding trap that MUST pass:
- Card charge (row 5): 590,900 poisha × 1.5% (150 bp) = `floor((590900 * 150 + 5000) / 10000)` = 8,864 poisha (৳88.64).
- bKash charge (row 1): 590,900 poisha × 1.15% (115 bp) = `floor((590900 * 115 + 5000) / 10000)` = 6,795 poisha (৳67.95).

### 6.7 Forward-Looking Automated Test Fixtures

#### 6.7.1 `percent_inclusive` VAT Test Fixtures
These exercise the `percent_inclusive` extraction formula. Commission and charge rates match 6.6. Assertions in tests must use integer poisha.

| # | Gross (poisha) | Gross Display (BDT) | VAT bp | Expected Base (poisha) | Expected VAT (poisha) | VAT Display (BDT) | Verification |
|---|---|---|---|---|---|---|---|
| P1 | 590900 | ৳5,909.00 | 1000 (10%) | 537182 | 53718 | ৳537.18 | roundHalfUp(590900 * 10000, 11000) = 537182 poisha |
| P2 | 330000 | ৳3,300.00 | 500 (5%) | 314286 | 15714 | ৳157.14 | roundHalfUp(330000 * 10000, 10500) = 314286 poisha |
| P3 | 1000000 | ৳10,000.00 | 1500 (15%) | 869565 | 130435 | ৳1,304.35 | roundHalfUp(1000000 * 10000, 11500) = 869565 poisha |

#### 6.7.2 `percent_of_gross` VAT Test Fixture (Fixture P4)
Exercises the add-on VAT formula: `vat = mulBp(gross, vat_bp)`.
- **Inputs**: Gross = 500,000 poisha (৳5,000.00), `vat_mode = 'percent_of_gross'`, `vat_bp = 750` (7.5%), `commission = { bp: 4200, base: 'gross_minus_vat' }`, `chargesBorneBy = 'business'`, method: bKash (`charge_bp = 115`, 1.15%).
- **Expected Outputs**:
  - `vat_poisha = mulBp(500000, 750) = 37,500 poisha` (৳375.00).
  - `commissionBase = 500000 - 37500 = 462,500 poisha`.
  - `commission_poisha = mulBp(462500, 4200) = 194,250 poisha` (৳1,942.50).
  - `charge_poisha = mulBp(500000, 115) = 5,750 poisha` (৳57.50).
  - `business_charge_poisha = 5,750 poisha`, `customer_charge_poisha = 0 poisha`.
  - `net_poisha = 500000 - 37500 - 194250 - 5750 = 262,500 poisha` (৳2,625.00).
  - **Identity Verification**: $37500 + 194250 + 5750 + 262500 = 500000$ (Passes conservation).

#### 6.7.3 Customer-Borne Charge Test Fixture (Fixture P5)
Exercises the customer-paid fee partitioning model: `chargesBorneBy = 'customer'`.
- **Inputs**: Gross = 590,900 poisha (৳5,909.00), `vat_mode = 'manual'`, `vatInputPoisha = 50900` (৳509.00), `commission = { bp: 4200, base: 'gross_minus_vat' }`, method: bKash (`charge_bp = 115`, 1.15%), `chargesBorneBy = 'customer'`.
- **Expected Outputs**:
  - `vat_poisha = 50,900 poisha` (৳509.00).
  - `commission_poisha = mulBp(590900 - 50900, 4200) = 226,800 poisha` (৳2,268.00).
  - `charge_poisha = mulBp(590900, 115) = 6,795 poisha` (৳67.95).
  - `business_charge_poisha = 0 poisha` (No business settlement liability).
  - `customer_charge_poisha = 6,795 poisha` (Paid by customer at gateway/counter).
  - `net_poisha = 590900 - 50900 - 226800 - 0 = 313,200 poisha` (৳3,132.00).
  - **Identity Verification**: $50900 + 226800 + 0 + 313200 = 590900$ (Net is NOT reduced by customer-borne charge; business payable liability for bKash = 0).

#### 6.7.4 Explicit Input Overrides Test Fixture (Fixture P6)
Exercises manual overrides under percentage profiles with mandatory audit reasons.
- **Inputs**: Gross = 1,000,000 poisha (৳10,000.00), profile: `percent_inclusive`, `vat_bp = 1500` (15%), `commission = { bp: 4000, base: 'gross' }`, method: Card (`charge_bp = 150`, 1.5%), `chargesBorneBy = 'business'`.
  - Client supplies `vat_override_poisha = 100000` (৳1,000.00) with `vat_override_reason = "Special statutory exemption agreement"`.
  - Client supplies `commission_override_poisha = 300000` (৳3,000.00) with `commission_override_reason = "Volume bonus waiver"`.
- **Expected Outputs**:
  - `vat_poisha = 100,000 poisha` (৳1,000.00) (Override replaces computed 130,435 poisha).
  - `commission_poisha = 300,000 poisha` (৳3,000.00) (Override replaces computed 400,000 poisha).
  - `charge_poisha = mulBp(1000000, 150) = 15,000 poisha` (৳150.00).
  - `business_charge_poisha = 15,000 poisha`.
  - `net_poisha = 1000000 - 100000 - 300000 - 15000 = 585,000 poisha` (৳5,850.00).
  - **Identity Verification**: $100000 + 300000 + 15000 + 585000 = 1000000$ (Passes conservation).

### 6.8 Financial Invariants

The following invariants are mathematically binding across the shared calculation engine, client forms, database schema constraints, and server sync verification:

1. **Integer Money Model**: All monetary variables are strictly integer `Poisha` (1 BDT = 100 poisha). No floating-point arithmetic is permitted in storage, computation, or serialization.
2. **Individual Component Rounding**: Each deduction component (`vat`, `commission`, `charge`) is computed and rounded independently using `mulBp` or `roundHalfUp`.
3. **Charge Partitioning Identity**:
   `business_charge_poisha + customer_charge_poisha === charge_poisha`
   - When `chargesBorneBy = 'business'`: `business_charge_poisha = charge_poisha` and `customer_charge_poisha = 0`.
   - When `chargesBorneBy = 'customer'`: `business_charge_poisha = 0` and `customer_charge_poisha = charge_poisha`.
4. **Conservation of Gross (Balancing Identity)**:
   `gross_poisha === vat_poisha + commission_poisha + business_charge_poisha + net_poisha`
   Customer-borne charges do not reduce the business net income.
5. **Universal Non-Negativity**: Every component (`gross`, `vat`, `commission`, `charge`, `business_charge`, `customer_charge`, `net`) must be non-negative (>= 0).
6. **Explicit Input & Override Auditing**:
   - In `vat_mode = 'manual'`, `vat_input_poisha` is a standard required input.
   - In percentage modes, any custom VAT is an exceptional override recorded in `vat_override_poisha` and strictly requires a non-empty `vat_override_reason`.
   - Any commission override recorded in `commission_override_poisha` strictly requires a non-empty `commission_override_reason`.
7. **Payable Liability Invariant (Finding A2)**: Business settlement liabilities and statement reconciliation sum only `business_charge_poisha` and `vat_poisha`. Customer-borne charges are collected directly by the payment provider from the customer (or collected at POS without merchant fee liability) and NEVER form part of business settlement liabilities (`expected_poisha = 0` for customer-borne methods).
8. **Active Entry Reporting Scope**: All financial summaries, monthly reports, and settlement generation calculate from entries where `status = 'active'`. Voided and superseded entries are excluded from active sums.

## 7. Data model (Postgres on Supabase)

All money columns are `bigint` poisha. `entry_date` is a `date` (business date in Asia/Dhaka). Month grouping uses `date_trunc('month', entry_date)`.

```sql
create type user_role as enum ('owner','admin','staff');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null,
  role user_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()     -- set by trigger on update
);
-- Dual Owner Invariant (F11, F15):
-- Max 1 owner: enforced via partial unique index.
create unique index one_owner on profiles ((role)) where role = 'owner';
-- Min 1 owner: enforced via deferrable constraint trigger evaluated at transaction commit.
-- Prevents zero active owners while permitting atomic ownership handoff in a single transaction.
-- Initial owner is provisioned via migration bootstrap.

create table devices (                              -- H3, M4: device registry, remote killswitch, and rate watermark tracking
  id text primary key,                              -- client-generated device UUID / hardware identifier
  user_id uuid not null references profiles on delete cascade,
  device_name text,                                 -- e.g., "Zia's Samsung A54"
  last_seen_at timestamptz not null default now(),
  last_rate_version int not null default 0,         -- tracks highest rate profile version pulled by this device
  revoked boolean not null default false,           -- remote killswitch (lost/stolen device session revocation)
  created_at timestamptz not null default now()
);
create index idx_devices_user on devices (user_id);

create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                        -- immutable machine code (e.g., 'bkash', 'visa')
  name text not null,                               -- display name (can be updated safely)
  requires_txn_ref boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()     -- set by trigger on update
);
-- F43: Trigger trg_payment_methods_immutable_code blocks any UPDATE modifying code.
-- F53: Trigger trg_payment_methods_active_rate_check blocks activating a method (active = true)
-- unless the currently effective published rate_profile covers this method in method_rates.
-- (To introduce or activate a new payment method, an admin must publish a new rate profile covering it).

create table rate_profiles (                        -- Draft -> Published lifecycle (F18)
  id uuid primary key default gen_random_uuid(),
  version int,                                      -- assigned upon publish via pg_advisory_xact_lock
  status text not null default 'draft' check (status in ('draft','published')),
  effective_from date not null,
  vat_mode text not null default 'manual'
  check (vat_mode in ('manual','percent_of_gross','percent_inclusive')),
  vat_bp int not null default 0 check (vat_bp between 0 and 10000),
  commission_bp int not null default 0 check (commission_bp between 0 and 10000),
  commission_base text not null default 'gross'
  check (commission_base in ('gross','gross_minus_vat')),
  charges_borne_by text not null default 'business'
  check (charges_borne_by in ('business','customer')),
  note text,                                        -- optional explanatory note on rate profile
  created_by uuid references profiles,
  created_at timestamptz not null default now(),
  published_at timestamptz                          -- immutable timestamp once published
);
-- Unique version across published profiles:
create unique index uq_rate_profile_version on rate_profiles (version) where status = 'published';
-- Active profile query: SELECT * FROM rate_profiles WHERE status = 'published' AND effective_from <= $entry_date ORDER BY effective_from DESC, version DESC LIMIT 1;
-- Immutability enforcement (F18, F41):
-- Triggers strictly block UPDATE and DELETE on rate_profiles once status = 'published'.
-- Triggers strictly block INSERT, UPDATE, and DELETE on method_rates once parent profile status = 'published'.
-- F41, F57: publish_rate_profile() enforces effective_from >= (now() at time zone 'Asia/Dhaka')::date (backdating prohibited; calculated in Asia/Dhaka calendar date).

create table method_rates (
  rate_profile_id uuid references rate_profiles on delete cascade,
  method_id uuid references payment_methods on delete restrict,
  charge_bp int not null check (charge_bp between 0 and 10000),
  primary key (rate_profile_id, method_id)
);

create type entry_status as enum ('active','voided','superseded');

create sequence entry_seq;
create sequence entry_number_seq;                   -- F44: monotonic global sequence (never resets monthly)
create table entries (
  id uuid primary key,                               -- client generated UUID (idempotent sync)
  server_seq bigint not null,                        -- F54: sole authoritative allocator is BEFORE INSERT OR UPDATE trigger under sequence lock
  entry_number bigint unique default nextval('entry_number_seq'), -- human-readable ID; UI: E-YYYYMM-XXXXXX (e.g. E-202610-000042)
  entry_date date not null,
  customer_name text not null,
  sub_qty int not null default 1 check (sub_qty >= 0), -- countable quantity (m3: sub_qty >= 0 allows 0 for fee-only/retainer deposits with no physical service units)
  sub_description text,                              -- optional qualitative description
  txn_ref text,
  method_id uuid not null references payment_methods,
  gross_poisha bigint not null check (gross_poisha > 0),
  rate_profile_id uuid not null references rate_profiles,
  snapshot jsonb not null,                           -- RateSnapshot used (must reference published profile)

  -- Calculation Inputs (explicitly stored for server recomputation, F2, F20)
  vat_input_poisha bigint check (vat_input_poisha is null or vat_input_poisha >= 0),
  vat_override_poisha bigint check (vat_override_poisha is null or vat_override_poisha >= 0),
  vat_override_reason text,
  commission_override_poisha bigint check (commission_override_poisha is null or commission_override_poisha >= 0),
  commission_override_reason text,

  -- Calculation Outputs (recalculated & verified by server)
  vat_poisha bigint not null check (vat_poisha >= 0),
  commission_poisha bigint not null check (commission_poisha >= 0),
  charge_poisha bigint not null check (charge_poisha >= 0),
  business_charge_poisha bigint not null check (business_charge_poisha >= 0),
  customer_charge_poisha bigint not null check (customer_charge_poisha >= 0),
  net_poisha bigint not null check (net_poisha >= 0),

  notes text,
  status entry_status not null default 'active',
  stale_rates boolean not null default false,        -- made offline with an older rate version
  dup_txn_flag boolean not null default false,       -- same txn_ref + method seen before (soft flag, never blocks sync)
  created_by uuid not null references profiles,
  device_id text,
  client_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),     -- set by trigger on update
  supersedes_id uuid references entries,
  superseded_at timestamptz,
  original_entry_date date,                          -- M5: preserves original intended date when reassigned from closed month
  void_requested_by uuid references profiles,
  void_requested_at timestamptz,
  void_request_reason text,                          -- mandatory when void is requested (F25)
  voided_by uuid references profiles,
  voided_at timestamptz,
  void_reason text,                                  -- mandatory when void is approved/executed (F25)

  -- Database Financial & Audit Invariant Constraints
  constraint chk_charge_partition check (business_charge_poisha + customer_charge_poisha = charge_poisha),
  constraint chk_gross_conservation check (vat_poisha + commission_poisha + business_charge_poisha + net_poisha = gross_poisha),
  constraint chk_vat_input_mode_exclusivity check (  -- F20, B1: NULL-safe mutually exclusive input modes
    (snapshot ? 'vat') and (snapshot->'vat' ? 'mode') and
    (
      (coalesce(snapshot->'vat'->>'mode', '') = 'manual' and vat_input_poisha is not null and vat_override_poisha is null and vat_input_poisha <= gross_poisha)
      or
      (coalesce(snapshot->'vat'->>'mode', '') in ('percent_of_gross','percent_inclusive') and vat_input_poisha is null)
    )
  ),
  constraint chk_vat_override_bound check (vat_override_poisha is null or vat_override_poisha <= gross_poisha), -- m4
  constraint chk_comm_override_bound check (commission_override_poisha is null or commission_override_poisha <= gross_poisha), -- m4
  constraint chk_vat_override_reason check (vat_override_poisha is null or (vat_override_reason is not null and length(trim(vat_override_reason)) > 0)),
  constraint chk_comm_override_reason check (commission_override_poisha is null or (commission_override_reason is not null and length(trim(commission_override_reason)) > 0)),
  constraint chk_void_request_reason check (void_requested_by is null or (void_request_reason is not null and length(trim(void_request_reason)) > 0)),
  constraint chk_void_fields check (status != 'voided' or (voided_by is not null and voided_at is not null and void_reason is not null and length(trim(void_reason)) > 0)),
  constraint chk_superseded_fields check (status != 'superseded' or superseded_at is not null)
);
create index on entries (entry_date);
create index on entries (method_id);
create index on entries (server_seq);
create index on entries (txn_ref);
create index on entries (entry_number);
create index on entries (created_by, entry_date);   -- M3: speeds up staff-scoped RLS and personal metric queries
create index on entries (status) where status = 'active';
create unique index uq_active_superseding_entry on entries (supersedes_id) where status = 'active';
-- Immutability trigger (F19): blocks DELETE unconditionally; blocks UPDATE on financial, snapshot,
-- and identity fields. Only authorized status transitions (void, supersede, void_request) permitted.
```

```sql
create table payables (                 -- seed: VAT, bKash charges, Visa charges, Mastercard charges
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  kind text not null check (kind in ('vat','method_charge')),
  method_id uuid references payment_methods,        -- mandatory for kind = method_charge, null for vat (Finding 4)
  due_day int not null check (due_day between 1 and 28), -- due day of the FOLLOWING month
  remind_days_before int not null default 3,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),     -- set by trigger on update
  constraint chk_payable_method_consistency check (
    (kind = 'vat' and method_id is null)
    or
    (kind = 'method_charge' and method_id is not null)
  )
);
-- Finding 4: Unique active payables prevent duplicate liability representations:
create unique index uq_active_vat_payable on payables (kind) where kind = 'vat' and active = true;
create unique index uq_active_method_payable on payables (method_id) where kind = 'method_charge' and active = true;
-- Deactivated payables (active = false) retain historical integrity; new months cover only active payables.

create table entry_reconciliation_exceptions ( -- F65, F66, F67: scoped exception evidence per entry, payable, and month
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete restrict,
  payable_id uuid not null references payables(id) on delete restrict,
  month date not null check (month = date_trunc('month', month)::date),
  status text not null check (status in ('approved', 'rejected')),
  reason text not null check (length(trim(reason)) > 0),
  reviewed_by uuid not null references profiles(id),
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, payable_id, month)
);
create index on entry_reconciliation_exceptions (payable_id, month);
create index on entry_reconciliation_exceptions (entry_id);

create table settlements (              -- one row per payable per month
  id uuid primary key default gen_random_uuid(),
  payable_id uuid not null references payables on delete restrict,
  month date not null check (month = date_trunc('month', month)::date), -- enforced first day of month (Finding 7)
  expected_poisha bigint not null check (expected_poisha >= 0),         -- dynamically updated from active entries until month close; frozen once month is closed
  paid_poisha bigint not null default 0 check (paid_poisha >= 0),       -- denormalized sum: (regular payments - reversals); updated by trigger
  variance_poisha bigint generated always as (paid_poisha - expected_poisha) stored,
  status text not null default 'due' check (status in ('not_applicable','due','partly_paid','paid','overpaid')), -- F38, F50
  note text,

  -- Overpayment Review Evidence (Finding 5, F68)
  overpayment_review_status text not null default 'none'
    check (overpayment_review_status in ('none','pending_approval','approved')),
  overpayment_approved_amount_poisha bigint check (overpayment_approved_amount_poisha is null or overpayment_approved_amount_poisha > 0),  -- F68: exact surplus amount in poisha approved by Owner
  overpayment_reason text,
  overpayment_approved_by uuid references profiles,
  overpayment_approved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),     -- set by trigger on update
  unique (payable_id, month),
  constraint chk_overpayment_approval check (
    (overpayment_review_status = 'none' and overpayment_reason is null and overpayment_approved_by is null and overpayment_approved_at is null and overpayment_approved_amount_poisha is null)
    or
    (overpayment_review_status = 'pending_approval' and overpayment_reason is not null and length(trim(overpayment_reason)) > 0 and overpayment_approved_amount_poisha is not null and overpayment_approved_amount_poisha > 0)
    or
    (overpayment_review_status = 'approved' and overpayment_reason is not null and length(trim(overpayment_reason)) > 0 and overpayment_approved_by is not null and overpayment_approved_at is not null and overpayment_approved_amount_poisha is not null and overpayment_approved_amount_poisha > 0)
  )
);
-- Authoritative Settlement Status Function (F50):
-- Used consistently across DB triggers, report views, the UI, and month-close validation:
create or replace function calc_settlement_status(p_expected bigint, p_paid bigint)
returns text language sql immutable as $$
  select case
    when p_expected = 0 and p_paid = 0 then 'not_applicable'
    when p_expected > 0 and p_paid = 0 then 'due'
    when p_paid > 0 and p_paid < p_expected then 'partly_paid'
    when p_expected > 0 and p_paid = p_expected then 'paid'
    when p_paid > p_expected then 'overpaid'
    else 'due'
  end;
$$;
-- F38 & F50 Non-Overlapping Status Rules:
-- 1. expected_poisha = 0 and paid_poisha = 0 => 'not_applicable' (zero liability; satisfies month close)
-- 2. expected_poisha > 0 and paid_poisha = 0 => 'due'
-- 3. paid_poisha > 0 and paid_poisha < expected_poisha => 'partly_paid'
-- 4. expected_poisha > 0 and paid_poisha = expected_poisha => 'paid' (exact match; satisfies month close)
-- 5. paid_poisha > expected_poisha => 'overpaid' (surplus; displays badge; requires approved review note for month close)

create table settlement_payments (      -- supports multiple partial payments & audited reversals (F17, F19, F36)
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references settlements on delete restrict,
  amount_poisha bigint not null check (amount_poisha > 0),
  paid_on date not null,
  reference text,
  receipt_storage_path text,            -- Supabase Storage object path (not inline data)
  note text,
  is_reversal boolean not null default false,
  reverses_payment_id uuid references settlement_payments(id) on delete restrict,
  recorded_by uuid references profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_reversal_reference check (
    (is_reversal = false and reverses_payment_id is null)
    or
    (is_reversal = true and reverses_payment_id is not null)
  )
);
create index on settlement_payments (settlement_id);
-- Trigger on settlement_payments (F17, F36, F50, Finding 6, F68):
-- 1. Serializes concurrent payment operations by row-locking parent settlement:
--    SELECT id INTO v_settlement_id FROM settlements WHERE id = NEW.settlement_id FOR UPDATE;
-- 2. If is_reversal = true:
--    Acquires row-level lock on target payment: SELECT amount_poisha, settlement_id INTO target_amount, target_settlement_id
--    FROM settlement_payments WHERE id = NEW.reverses_payment_id FOR UPDATE;
--    Asserts target has is_reversal = false, matches settlement_id, and
--    coalesce(sum(amount_poisha) from settlement_payments where reverses_payment_id = target_id and is_reversal = true, 0)
--    + NEW.amount_poisha <= target_amount.
-- 3. Recalculates and updates parent settlement:
--    UPDATE settlements SET paid_poisha = (
--      SELECT coalesce(sum(amount_poisha * (case when is_reversal then -1 else 1 end)), 0)
--      FROM settlement_payments WHERE settlement_id = NEW.settlement_id
--    ), updated_at = now() WHERE id = NEW.settlement_id;
--    (Note: This UPDATE on settlements fires trg_settlements_recalc_status_and_overpayment, which automatically
--    recalculates status via calc_settlement_status() and handles overpayment invalidation in a single authoritative place).
-- 4. Trigger blocks direct UPDATE and DELETE unconditionally.

create table statements (               -- F21, F37, F55: supports single payable and combined card reconciliation
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'single_payable' check (kind in ('single_payable','combined_card')),
  month date not null check (month = date_trunc('month', month)::date), -- enforced first day of month (Finding 7)
  source text not null check (source in ('manual_total','file')),
  file_storage_path text,              -- Supabase Storage object path (not inline data)
  statement_total_poisha bigint not null check (statement_total_poisha >= 0), -- Total fee debited on merchant statement or VAT deposited on challan
  expected_poisha bigint not null check (expected_poisha >= 0),               -- business-borne charge sum or VAT sum from active entries
  variance_poisha bigint generated always as (statement_total_poisha - expected_poisha) stored, -- B4: Authoritative stored generated column
  status text not null default 'open' check (status in ('open','reconciled','superseded')),
  superseded_by uuid references statements on delete restrict,
  note text,
  created_by uuid references profiles,
  reconciled_by uuid references profiles,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),     -- set by trigger on update
  unique (id, month)                                 -- F55: composite target for foreign key
);

create table statement_payables (       -- F37, F55: normalized statement-payable coverage with composite FK
  statement_id uuid not null,
  payable_id uuid not null references payables on delete restrict,
  month date not null check (month = date_trunc('month', month)::date),
  status text not null default 'open' check (status in ('open','reconciled','superseded')),
  primary key (statement_id, payable_id),
  foreign key (statement_id, month) references statements (id, month) on delete restrict  -- F55: month agreement guaranteed
);
-- F37: Uniqueness index prevents overlapping active statements for the same payable/month:
create unique index uq_active_statement_coverage on statement_payables (payable_id, month) where status != 'superseded';
-- F47: Parent-child state invariant and invalidation trigger:
-- statements.status = 'reconciled' <=> all child statement_payables.status = 'reconciled'.
-- When live recalculation detects modified entries in an open month, it invalidates statements back to 'open'
-- AND sets all child statement_payables.status = 'open' in the same transaction. Month-close verification checks both.

create table statement_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references statements on delete restrict,
  line_date date,
  reference text,
  gross_poisha bigint,
  fee_poisha bigint,
  matched_entry_id uuid references entries on delete restrict,
  is_active_match boolean not null default true, -- F22: set to false when parent statement is superseded
  match_status text not null default 'unmatched'
    check (match_status in ('matched','unmatched','accepted')),
  review_note text,                     -- mandatory when match_status = 'accepted'
  reviewed_by uuid references profiles,
  reviewed_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),     -- set by trigger on update
  constraint chk_statement_line_acceptance check ( -- F69: strict reviewer evidence enforcement
    (match_status = 'accepted' and reviewed_by is not null and reviewed_at is not null and review_note is not null and length(trim(review_note)) > 0)
    or
    (match_status = 'matched' and matched_entry_id is not null)
    or
    (match_status = 'unmatched' and matched_entry_id is null)
  )
);
create unique index uq_active_statement_line_entry on statement_lines (statement_id, matched_entry_id)
  where matched_entry_id is not null and is_active_match = true;

create table month_closes (
  month date primary key check (month = date_trunc('month', month)::date), -- enforced first day of month (Finding 7)
  status text not null default 'closed' check (status in ('closed', 'open')),
  closed_by uuid references profiles,
  closed_at timestamptz,
  reopened_by uuid references profiles,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- F70 First-Time Month Close Semantics:
-- By default, any calendar month lacking a record in month_closes is implicitly in the 'open' state.
-- A month record is created only when close_month() is first invoked for that month.
-- Sync push checks 'EXISTS (SELECT 1 FROM month_closes WHERE month = v_month AND status = 'closed')';
-- if no row exists, the month is open and mutations are accepted.

create table month_close_events (       -- append-only history of all close/reopen lifecycle events
  id uuid primary key default gen_random_uuid(),
  month date not null check (month = date_trunc('month', month)::date),
  action text not null check (action in ('close', 'reopen')),
  actor uuid not null references profiles,
  reason text,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid references profiles,
  action text not null,
  target_table text,
  target_id text,
  before jsonb,
  after jsonb
);

create table sync_ops (                 -- idempotency table for sync push operations (retained 90 days, F35)
  op_id uuid primary key,
  actor_id uuid not null references profiles,        -- F35: authenticated caller ID for ownership validation
  device_id text not null,
  op_type text not null,
  entry_id uuid,                                     -- original client entry UUID
  payload jsonb not null,                            -- full operation payload preserved for server retry and admin review queue
  payload_hash text not null,                        -- SHA-256 of canonical operation ({type, payload, supersedesRejectedOpId, clientCreatedAt})
  client_created_at timestamptz not null,            -- F39: client timestamp for offline duration audit
  supersedes_rejected_op_id uuid references sync_ops(op_id) on delete set null, -- M2: safe 90-day retention pruning
  result text not null check (result in ('ok','duplicate','rejected')),
  resolution_status text not null default 'pending' check (resolution_status in ('pending', 'resolved', 'discarded')),
  reason text,
  created_at timestamptz not null default now()
);
create index on sync_ops (actor_id, created_at);
create index on sync_ops (device_id, created_at);
create unique index uq_sync_ops_superseded on sync_ops (supersedes_rejected_op_id) where result = 'ok';

create table app_settings (            -- single row
  id boolean primary key default true check (id),
  timezone text not null default 'Asia/Dhaka',
  currency text not null default 'BDT',
  locale text not null default 'en-BD',
  net_label text not null default 'Net after deductions',
  reconcile_tolerance_poisha bigint not null default 100,  -- 1 BDT (100 poisha); avoids false alarms from rounding
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()     -- set by trigger on update
);
```

### 7.1 Database Security, Table Revocations & Single Trust Model (Findings A4, A5)

1. **Table-Level Direct Write Revocation on All 18 Tables (Finding A4, H3, M4)**:
   To guarantee that no user (including Admin and Owner) can bypass financial constraints, overpayment gates, or draft-publish lifecycle checks via direct PostgREST table access, direct `INSERT`, `UPDATE`, and `DELETE` privileges are explicitly revoked across all 18 public tables from `anon` and `authenticated`:
   ```sql
   REVOKE INSERT, UPDATE, DELETE ON
     entries,
     rate_profiles,
     method_rates,
     settlements,
     settlement_payments,
     statements,
     statement_payables,
     statement_lines,
     month_closes,
     month_close_events,
     entry_reconciliation_exceptions,
     audit_log,
     sync_ops,
     profiles,
     payment_methods,
     payables,
     devices,
     app_settings
   FROM anon, authenticated;

   -- Row Level Security explicitly enabled on all tables
   ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
   ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
   ALTER TABLE rate_profiles ENABLE ROW LEVEL SECURITY;
   ALTER TABLE method_rates ENABLE ROW LEVEL SECURITY;
   ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
   ALTER TABLE payables ENABLE ROW LEVEL SECURITY;
   ALTER TABLE entry_reconciliation_exceptions ENABLE ROW LEVEL SECURITY;
   ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
   ALTER TABLE settlement_payments ENABLE ROW LEVEL SECURITY;
   ALTER TABLE statements ENABLE ROW LEVEL SECURITY;
   ALTER TABLE statement_payables ENABLE ROW LEVEL SECURITY;
   ALTER TABLE statement_lines ENABLE ROW LEVEL SECURITY;
   ALTER TABLE month_closes ENABLE ROW LEVEL SECURITY;
   ALTER TABLE month_close_events ENABLE ROW LEVEL SECURITY;
   ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
   ALTER TABLE sync_ops ENABLE ROW LEVEL SECURITY;
   ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
   ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
   ```
   All table mutations execute exclusively through privileged `SECURITY DEFINER` RPCs running with `search_path = public, pg_temp` invoked by the server under `service_role`.

2. **Single Trust & Identity Architecture (Finding A5)**:
   - **Access Channel**: Clients interact strictly with SvelteKit server endpoints (`/api/v1/*`) or authenticated Supabase client calls.
   - **Identity Derivation**: The server verifies the Supabase Auth session JWT, extracts `auth.uid()`, queries `profiles` where `id = auth.uid()`, and asserts `active = true`. Caller identity and role parameters passed to RPCs (`p_caller_id`, `p_caller_role`) are strictly verified against the authenticated JWT session claims rather than untrusted client parameters.
   - **Table RLS**: Read-level access (`SELECT`) is permitted via RLS for authenticated users:
     - `entries`: Staff `select` where `created_by = auth.uid()`; Admin and Owner `select` all.
     - `profiles`: Staff `select` where `id = auth.uid()`; Admin and Owner `select` all.
     - `devices`: Staff `select` where `user_id = auth.uid()`; Admin and Owner `select` all (M4). (Mutations execute strictly through `upsert_device_sync_state` during `/sync/pull` or `admin_manage_device` for Admin/Owner killswitch).
     - `rate_profiles`, `method_rates`, `payment_methods`, `payables`, `app_settings`: all authenticated users `select`.
     - `entry_reconciliation_exceptions`: Admin and Owner `select`.
     - `settlements`, `settlement_payments`, `statements`, `statement_payables`, `statement_lines`, `month_closes`, `month_close_events`, `audit_log`: Admin and Owner `select`.
     - `sync_ops`: server-internal only (no client select).

3. **Routine Privilege & Access Control DDL (Finding 1)**:
   ```sql
   REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;
   GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM PUBLIC, anon, authenticated;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON ROUTINES TO service_role;
   ```

### 7.2 Deterministic Lock Hierarchy & Sequence Lock Throughput Budget (Findings A8, B10)

To eliminate deadlocks and lock hash collisions, all operations use PostgreSQL two-integer advisory locks `pg_advisory_xact_lock(classid integer, objid integer)` with dedicated namespaces:
- `classid = 1001`: Month Locks. `objid = (extract(year from m)::int * 12 + extract(month from m)::int)` (exact numeric month identifier; 0 collisions).
- `classid = 1002`: Sequence Allocation Lock. `objid = 1`.
- `classid = 1003`: Rate Profile Version Lock. `objid = 1`.

#### Sequence Lock Throughput Budget (Finding A8)
The global transaction sequence advisory lock `pg_advisory_xact_lock(1002, 1)` serializes monotonic sequence allocation to guarantee that pull cursors never skip uncommitted or late-committing rows.
- **Benchmarked Execution Duration**: Holding this advisory lock during sequence assignment (`nextval('entry_seq')`) and row insertion/update completes in ~0.5–1.0 ms in PostgreSQL on standard SSD instances.
- **Batch Impact**: A maximum sync batch of 50 operations holds the sequence lock for < 20 ms.
- **Throughput Capacity**: At $\ge 1,000$ operations/second ($\ge 60,000$ operations/minute), this architecture exceeds the expected boutique ledger peak load (< 500 entries/day, maximum burst 50 ops/second across 5 staff devices) by more than 20x.
- **Future Partitioning Hook**: If high multi-tenant scale is ever required, the sequence lock can be partitioned by calendar month `(1002, extract(year from m)::int * 12 + extract(month from m)::int)` without breaking cursor guarantees within a month.

#### Global Lock Acquisition Sequence (Strictly Enforced Across ALL Paths)
1. **Ascending Month Advisory Locks**:
   Every financial procedure (`record_settlement_payment`, `approve_settlement_overpayment`, `accept_statement_line`, `review_entry_reconciliation_exception`, `rpc_push_sync_op`, `rpc_supersede_entry`, `reconcile_statement`, `close_month`, `reopen_month`) MUST acquire month advisory locks as Step 1.
   For any batch or operation affecting months $M_1, M_2, \dots, M_k$, gather all unique months, sort in **ascending numeric order** ($M_1 < M_2 < \dots$), and acquire:
   `perform pg_advisory_xact_lock(1001, extract(year from m)::int * 12 + extract(month from m)::int);`
2. **Sequence Allocation Lock**:
   `perform pg_advisory_xact_lock(1002, 1);`
   **CRITICAL (Finding 2)**: Every operation that writes or updates an entry (`create_entry`, `request_void`, `void_entry`, `supersede_entry`) MUST acquire this sequence lock **before** acquiring any entry row locks (`SELECT ... FOR UPDATE`) or executing table writes. No transaction ever holds an entry row lock while waiting for the sequence lock.
3. **Cross-Table Row Locks in Trigger-Aligned Order (Finding B10, Item 2.1)**:
   When acquiring row-level locks across multiple tables, lock in strict trigger-aligned top-down order, and in ascending primary key order within each table:
   $$\text{payables (FOR KEY SHARE)} \longrightarrow \text{entries} \longrightarrow \text{settlements} \longrightarrow \text{statements} \longrightarrow \text{statement\_payables} \longrightarrow \text{statement\_lines} \longrightarrow \text{entry\_reconciliation\_exceptions}$$
   Because all operations touching a month serialize on `pg_advisory_xact_lock(1001, month)` as Step 1, cross-table trigger interactions within that month cannot deadlock.

### 7.3 Core Database Functions & Atomic Procedures

All procedures are defined with `SECURITY DEFINER` and strict `SET search_path = public, pg_temp`.

- `rpc_push_sync_op(p_device_id text, p_caller_id uuid, p_caller_role user_role, p_ops jsonb)` (F26, F32, F34, F46, F48, Finding 2, Finding A3, Items 1.1, 1.2, 2.4, Item 3, Item 5):
  Executes in a single database transaction under `service_role`.
  1. Multi-month lock acquisition: extracts all distinct months from `p_ops`, normalizes to first-of-month (`date_trunc('month', m)::date`), sorts ascending, and acquires all month advisory locks (`classid = 1001`).
  2. Acquires sequence advisory lock (`classid = 1002, objid = 1`).
  3. Per-Operation Subtransaction Fault Isolation (F48): iterates over operations inside PL/pgSQL `BEGIN ... EXCEPTION WHEN OTHERS THEN ... END` subtransactions.
     - Superseded Op Ownership & State Check (Item 5):
       If `op.supersedesRejectedOpId` is non-null: asserts that the referenced row in `sync_ops` exists with `result = 'rejected'`, `resolution_status = 'pending'`, and `(actor_id = p_caller_id OR p_caller_role IN ('admin', 'owner'))`. If not satisfied, raises standardized error `invalid_superseded_op`.
     - `create_entry`:
       - Device Check & Remote Killswitch (H3, M4):
         If `p_device_id` is provided, asserts `NOT EXISTS (SELECT 1 FROM devices WHERE id = p_device_id AND revoked = true)`; if revoked, raises standardized error `device_revoked`.
       - Normalizes `v_txn_ref := nullif(upper(trim(op.payload->>'txnRef')), '')`.
       - Method Check: Verifies `method_id` exists and is active in `payment_methods`. If `payment_methods.requires_txn_ref = true` AND `v_txn_ref IS NULL`, raises standardized error `missing_txn_ref`.
       - Soft Duplicate Check: Sets `v_dup_txn_flag := EXISTS (SELECT 1 FROM entries WHERE method_id = (op.payload->>'methodId')::uuid AND txn_ref = v_txn_ref AND status = 'active')`.
       - Rate Profile Verification & Anti-Cherry-Picking (Finding A3, Rule #4, Item 1.1, Item 3, H3):
         Checks that submitted `rate_profile_id` was published and effective on `entry_date` (`effective_from <= entry_date`). If not found, raises `rate_profile_date_mismatch`.
         Evaluates client rate watermark: let `v_expected_profile` be the highest-version profile with `status = 'published' AND effective_from <= entry_date AND version <= coalesce((op->>'maxKnownRateVersion')::int, (op.payload->'snapshot'->>'version')::int)`. If `submitted_profile_id != v_expected_profile.id`, raises `rate_profile_date_mismatch` (anti-cherry-picking, Test #41).
         Device Rate Watermark Grounding (H3): If `p_device_id` is provided, queries `devices WHERE id = p_device_id`. If `coalesce((op->>'maxKnownRateVersion')::int, (op.payload->'snapshot'->>'version')::int) < devices.last_rate_version` AND `(op->>'clientCreatedAt')::timestamptz > devices.last_seen_at`, raises `rate_profile_date_mismatch` (anti-cherry-picking post-pull). Offline entries created before pulling newer profile are accepted.
         Evaluates server latest profile: let `v_latest_profile` be the highest-version profile with `status = 'published' AND effective_from <= entry_date`. If `submitted_profile_id != v_latest_profile.id`, sets `v_stale_rates := true` (legitimate offline save, Rule #4, Test #46, Test #9); otherwise `v_stale_rates := false`.
       - Recomputes `packages/calc` with explicit inputs (F2, F20). Asserts per-entry deduction guard.
       - Inserts into `entries` with `created_by = p_caller_id`, `txn_ref = v_txn_ref`, `dup_txn_flag = v_dup_txn_flag`, `stale_rates = v_stale_rates`. (Trigger `trg_entries_server_seq` assigns `server_seq`, F54).
     - `request_void`: Allowed for Staff on own entries (`created_by = p_caller_id`) or Admin/Owner on any entry. Requires non-empty `void_request_reason` (F25). Asserts `entries.status = 'active'` (rejects non-active with `cannot_void_non_active`). Updates `void_requested_by = p_caller_id`, `void_requested_at = now()`, `void_request_reason`. (Trigger allocates new `server_seq`, F54).
     - `void_entry`: Admin or Owner only. Requires non-empty `void_reason` (F25). Asserts `entries.status = 'active'`. Row locks entry. Sets `status = 'voided'`, `voided_at = now()`, `voided_by = p_caller_id`, `void_reason`. (Trigger allocates new `server_seq`, F54).
     - `supersede_entry`: Admin or Owner only. Calls `rpc_supersede_entry()`. Row locks original entry. **Asserts `original.status = 'active'`** (Finding 3; rejects with `cannot_supersede_non_active` if voided or already superseded). Cross-month check: verifies neither original nor new month is closed. Marks original `status = 'superseded'`. Inserts new entry with published profile valid for new entry's business date. (Trigger assigns new sequence to both rows, F54).
     - `discard_rejected_entry`: Queries `sync_ops WHERE op_id = op.payload.rejectedOpId`. Asserts `sync_ops.actor_id = p_caller_id` OR `p_caller_role in ('admin', 'owner')`. Asserts prior op `result = 'rejected'`. Updates prior op `resolution_status = 'discarded'`. Records discard op in `sync_ops` with `result = 'ok'`, logs audit event `entry.discard_rejected`, and returns `{ status: 'ok' }`.
     - Subtransaction rollback: invalid operations roll back only that operation's changes, record `{ status: 'rejected', reason: v_standardized_reason }` in `sync_ops` (preserving full `payload` and setting `resolution_status = 'pending'`, Item 1.2) and `audit_log`, and output rejection without aborting the batch (F48).
     - Success resolution: If `op.supersedesRejectedOpId` is present, updates `sync_ops SET resolution_status = 'resolved' WHERE op_id = op.supersedesRejectedOpId`.
- `rpc_supersede_entry(p_original_id uuid, p_new_entry jsonb, p_actor_id uuid)` (Finding 2, Finding 3, Item 3.4):
  Admin or Owner only.
  1. Queries original entry date and new entry date; normalizes both months `v_orig_month` and `v_new_month`.
  2. Asserts neither month is closed (Item 3.4):
     `IF EXISTS (SELECT 1 FROM month_closes WHERE month IN (v_orig_month, v_new_month) AND status = 'closed') THEN RAISE EXCEPTION 'month_closed'; END IF;`
  3. Acquires month locks in ascending order (`classid = 1001`).
  4. Acquires sequence lock (`classid = 1002, objid = 1`).
  5. Acquires row lock: `SELECT * FROM entries WHERE id = p_original_id FOR UPDATE;`
  6. Asserts `original.status = 'active'` (Finding 3). Rejects with `cannot_supersede_non_active` if voided or already superseded.
  7. Sets original `status = 'superseded', superseded_at = now()`.
  8. Inserts replacement entry with published rate profile valid for replacement date; trigger assigns sequence.
- `review_entry_reconciliation_exception(p_entry_id uuid, p_payable_id uuid, p_action text, p_reason text, p_actor_id uuid)` (Finding 5, F65, F66, F67, Item 2.1, Item 3, H5):
  Admin or Owner only. Asserts `p_action in ('approved', 'rejected')` and `length(trim(p_reason)) > 0`.
  Normalizes target month: `v_month := date_trunc('month', (select entry_date from entries where id = p_entry_id))::date;`
  Adheres strictly to the global lock order (F66, Item 2.1):
  1. Acquires month lock: `perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);`
  2. Asserts month is open (Item 3): `IF EXISTS (SELECT 1 FROM month_closes WHERE month = v_month AND status = 'closed') THEN RAISE EXCEPTION '422 month_closed'; END IF;`
  3. Acquires sequence lock: `perform pg_advisory_xact_lock(1002, 1);`
  4. Acquires payable lock using `KEY SHARE` (Item 2.1): `SELECT * FROM payables WHERE id = p_payable_id FOR KEY SHARE;`
  5. Acquires entry row lock: `SELECT * FROM entries WHERE id = p_entry_id FOR UPDATE;`
  Asserts `entries.status = 'active'`. Asserts payable applicability: `(payables.kind = 'vat') OR (payables.kind = 'method_charge' and payables.method_id = entries.method_id)`.
  Inserts or updates `entry_reconciliation_exceptions` (F67):
  `insert into entry_reconciliation_exceptions (entry_id, payable_id, month, status, reason, reviewed_by, reviewed_at) values (p_entry_id, p_payable_id, v_month, p_action, p_reason, p_actor_id, now()) on conflict (entry_id, payable_id, month) do update set status = excluded.status, reason = excluded.reason, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, updated_at = now();`
  Reconciliation Invalidation Cascade (H5): If `p_action = 'rejected'` (or if an existing approved exception is altered), automatically invalidates any currently reconciled statements covering `p_payable_id` in `v_month`:
  `UPDATE statements s SET status = 'open', updated_at = now() FROM statement_payables sp WHERE sp.statement_id = s.id AND sp.payable_id = p_payable_id AND s.month = v_month AND s.status = 'reconciled';`
  `UPDATE statement_payables SET status = 'open' WHERE payable_id = p_payable_id AND month = v_month AND status = 'reconciled';`
  Appends `entry.reconciliation_exception` to `audit_log`.
- `approve_settlement_overpayment(p_settlement_id uuid, p_reason text, p_actor_id uuid)` (Finding 5, F65, F68, Item 2.1, Item 3):
  Owner only (F65). Asserts `length(trim(p_reason)) > 0`.
  Queries settlement month: `SELECT month INTO v_month FROM settlements WHERE id = p_settlement_id;`
  Acquires month lock (Item 2.1): `perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);`
  Asserts month is open (Item 3): `IF EXISTS (SELECT 1 FROM month_closes WHERE month = v_month AND status = 'closed') THEN RAISE EXCEPTION '422 month_closed'; END IF;`
  Acquires row lock: `SELECT * FROM settlements WHERE id = p_settlement_id FOR UPDATE;`
  Asserts `status = 'overpaid'` (`paid_poisha > expected_poisha`). Computes `v_current_surplus := paid_poisha - expected_poisha;`
  Sets `overpayment_review_status = 'approved'`, `overpayment_approved_amount_poisha = v_current_surplus`, `overpayment_reason = p_reason`, `overpayment_approved_by = p_actor_id`, `overpayment_approved_at = now()`.
  Appends `settlement.overpayment_approved` to `audit_log`.
- `accept_statement_line(p_line_id uuid, p_review_note text, p_actor_id uuid)` (F69, Item 2.1, Item 3):
  Admin or Owner only. Asserts `length(trim(p_review_note)) > 0`.
  Queries statement month: `SELECT s.month INTO v_month FROM statements s JOIN statement_lines sl ON sl.statement_id = s.id WHERE sl.id = p_line_id;`
  Acquires month lock (Item 2.1): `perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);`
  Asserts month is open (Item 3): `IF EXISTS (SELECT 1 FROM month_closes WHERE month = v_month AND status = 'closed') THEN RAISE EXCEPTION '422 month_closed'; END IF;`
  Acquires line row lock: `SELECT * FROM statement_lines WHERE id = p_line_id FOR UPDATE;`
  Asserts `match_status = 'unmatched'` and `matched_entry_id is null`.
  Sets `match_status = 'accepted'`, `review_note = p_review_note`, `reviewed_by = p_actor_id`, `reviewed_at = now()`, `updated_at = now()`.
  Appends `statement_line.accept` to `audit_log`.
- `close_month(p_month date, p_actor_id uuid)` (F32, F42, F47, Finding 5, Finding 7, F68, F70, Item 3.5):
  Owner only.
  1. Normalizes `v_month := date_trunc('month', p_month)::date;`
  2. Acquires month lock: `perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);`
  3. Settlement Generation Guarantee (Item 3.5):
     `PERFORM generate_monthly_settlements(v_month);` (ensures settlement rows exist for all active/accrued payables before verification).
  4. Idempotency: If `EXISTS (SELECT 1 FROM month_closes WHERE month = v_month AND status = 'closed')`, returns success immediately (F70).
  5. Asserts all payables for `v_month` satisfy reconciliation invariant: both parent `statements.status = 'reconciled'` AND child `statement_payables.status = 'reconciled'`, or are zero-liability (`settlements.status = 'not_applicable'`).
  6. If any settlement for `v_month` has `status = 'overpaid'`, asserts `overpayment_review_status = 'approved'` AND `overpayment_approved_amount_poisha = (paid_poisha - expected_poisha)` (F68). If the surplus amount changed or is unapproved, raises `422 unapproved_overpaid_settlement`.
  7. Idempotent Upsert (F70):
     `insert into month_closes (month, status, closed_by, closed_at, created_at, updated_at) values (v_month, 'closed', p_actor_id, now(), now(), now()) on conflict (month) do update set status = 'closed', closed_by = p_actor_id, closed_at = now(), reopen_reason = null, updated_at = now();`
  8. Inserts `month_close_events` action `'close'`, appends `month.close` to `audit_log`, freezes settlement liabilities.
- `reopen_month(p_month date, p_reason text, p_actor_id uuid)` (F23, F32, F42, F47, Finding 7, F70):
  Owner only. Asserts `length(trim(p_reason)) > 0`.
  1. Normalizes `v_month := date_trunc('month', p_month)::date;`
  2. Acquires month lock (`classid = 1001`).
  3. Asserts `EXISTS (SELECT 1 FROM month_closes WHERE month = v_month AND status = 'closed')`. If not found or open, raises `422 month_not_closed` (F70).
  4. Updates `month_closes set status = 'open', reopened_by = p_actor_id, reopened_at = now(), reopen_reason = p_reason, updated_at = now() where month = v_month;`
  5. Updates all `statements` and child `statement_payables` for `v_month` from `'reconciled'` back to `'open'` (F47).
  6. Inserts `month_close_events` action `'reopen'`, appends `month.reopen` to `audit_log`.
- `reconcile_statement(p_statement_id uuid, p_note text, p_actor_id uuid)` (Findings A1, F42, F56, Finding 5, F67, F69, Items 3.1, 3.2, 3.3, Item 3):
  Admin or Owner only.
  1. Normalizes `v_month := date_trunc('month', (select month from statements where id = p_statement_id))::date;`
  2. Acquires month lock: `perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);`
  3. Asserts month is open (Item 3): `IF EXISTS (SELECT 1 FROM month_closes WHERE month = v_month AND status = 'closed') THEN RAISE EXCEPTION '422 month_closed'; END IF;`
  4. Acquires statement row lock: `SELECT * FROM statements WHERE id = p_statement_id FOR UPDATE;`
  5. **Bifurcated Reconciliation Modes (Finding A1)**:
     - **Mode A: Totals-Only Manual Reconciliation (`source = 'manual_total'`)**:
       - Statement lines do not exist for manual statements (`count(statement_lines) = 0`).
       - Line matching and entry-level exception assertions are skipped.
       - Recomputation Check: Asserts `expected_poisha` matches current sum of active entries for all covered payables (`sum(business_charge_poisha)` for method payables, `sum(vat_poisha)` for VAT).
       - Variance Clearance: Asserts `abs(variance_poisha) <= (SELECT reconcile_tolerance_poisha FROM app_settings)` OR `(p_note IS NOT NULL AND length(trim(p_note)) > 0)`.
       - Sets `statements.status = 'reconciled'` and all child `statement_payables.status = 'reconciled'` atomically.
     - **Mode B: Line-Item Reconciliation (`source = 'file'`)**:
       - Statement lines exist.
       - Asserts all statement lines have `(match_status = 'matched' and matched_entry_id is not null)` OR `(match_status = 'accepted' and reviewed_by is not null and reviewed_at is not null and review_note is not null)` (F69).
       - Line Integrity Assertion (Item 3.1): For lines with `match_status = 'matched'`, asserts referenced entry `e` has `e.status = 'active'`, `date_trunc('month', e.entry_date)::date = v_month`, and `e.method_id` is covered by the statement.
       - Non-Zero Entry Matching Scope (Item 3.2, 3.3): For each payable covered by this statement, asserts all active entries in `v_month` with non-zero liability (`(payables.kind = 'vat' AND entries.vat_poisha > 0) OR (payables.kind = 'method_charge' AND entries.method_id = payables.method_id AND entries.business_charge_poisha > 0)`) are EITHER matched to an active line in THIS statement (`statement_lines.statement_id = p_statement_id AND statement_lines.matched_entry_id = entries.id AND statement_lines.is_active_match = true`) OR have an approved scoped exception in `entry_reconciliation_exceptions` for that exact payable and month:
         `EXISTS (SELECT 1 FROM entry_reconciliation_exceptions x WHERE x.entry_id = entries.id AND x.payable_id = sp.payable_id AND x.month = v_month AND x.status = 'approved')` (F67). Unmatched non-zero liability entries raise `422 unmatched_entries_without_approved_exceptions`. Customer-borne charges and zero-VAT entries are excluded from fee statement matching requirements.
       - Asserts net variance <= tolerance or covered by non-empty `p_note`.
       - Sets statement status and all child `statement_payables.status` to `'reconciled'` atomically.
  6. Records `reconciled_by = p_actor_id, reconciled_at = now()`, and appends `statement.reconcile` to `audit_log`.
- `transfer_ownership(p_new_owner_id uuid, p_caller_id uuid)` (Findings B7, F15):
  Owner only.
  1. Verifies caller is the currently active Owner: `SELECT role INTO v_role FROM profiles WHERE id = p_caller_id FOR UPDATE; IF v_role != 'owner' THEN RAISE EXCEPTION '403 unauthorized'; END IF;`
  2. Verifies target account exists and is active: `SELECT active INTO v_target_active FROM profiles WHERE id = p_new_owner_id FOR UPDATE; IF NOT v_target_active THEN RAISE EXCEPTION '422 target_user_inactive'; END IF;`
  3. Ordered two-step role swap:
     - `UPDATE profiles SET role = 'admin', updated_at = now() WHERE id = p_caller_id AND role = 'owner';`
     - `UPDATE profiles SET role = 'owner', updated_at = now() WHERE id = p_new_owner_id;`
  4. Deferrable constraint trigger `trg_prevent_zero_owners` evaluates at commit to verify that exactly 1 active Owner remains in `profiles`. (Note: An Owner cannot be deactivated directly via `active = false`; ownership must be transferred first).
  5. Appends `user.ownership_transfer` to `audit_log`.
- `generate_monthly_settlements(p_month date)` (Finding B5, Items 2.2, 3.5):
  Admin or Owner only.
  1. Normalizes `v_month := date_trunc('month', p_month)::date;`
  2. Acquires month advisory lock (`classid = 1001`).
  3. Iterates over all payables that are active OR accrued liability in `v_month` OR already exist in `settlements` (Item 3.5):
     `SELECT * FROM payables p WHERE p.active = true OR EXISTS (SELECT 1 FROM entries e WHERE date_trunc('month', e.entry_date)::date = v_month AND e.status = 'active' AND ((p.kind = 'vat' AND e.vat_poisha > 0) OR (p.kind = 'method_charge' AND e.method_id = p.method_id AND e.business_charge_poisha > 0))) OR EXISTS (SELECT 1 FROM settlements s WHERE s.payable_id = p.id AND s.month = v_month);`
     - Computes `v_expected`: For VAT (`kind = 'vat'`), `COALESCE(SUM(vat_poisha), 0)` from `entries WHERE status = 'active' AND date_trunc('month', entry_date) = v_month`. For method charges (`kind = 'method_charge'`), `COALESCE(SUM(business_charge_poisha), 0)` from `entries WHERE status = 'active' AND method_id = p.method_id AND date_trunc('month', entry_date) = v_month`.
     - Inserts or updates row (Item 2.2):
       ```sql
       INSERT INTO settlements (payable_id, month, expected_poisha, paid_poisha, status)
       VALUES (p.id, v_month, v_expected, 0, calc_settlement_status(v_expected, 0))
       ON CONFLICT (payable_id, month) DO UPDATE
       SET expected_poisha = EXCLUDED.expected_poisha
       WHERE NOT EXISTS (
         SELECT 1 FROM month_closes mc WHERE mc.month = v_month AND mc.status = 'closed'
       );
       ```
- `publish_rate_profile(p_profile_id uuid, p_actor_id uuid)` (F18, F41, F53, Finding 7, Item 4):
  Asserts profile is `'draft'`, asserts `effective_from >= (now() at time zone 'Asia/Dhaka')::date` (Finding 7), asserts complete rate coverage for all active payment methods (F53).
  Server-Side 100% Deduction Guard (Item 4):
  `SELECT vat_bp, commission_bp INTO v_vat_bp, v_comm_bp FROM rate_profiles WHERE id = p_profile_id;`
  `SELECT COALESCE(MAX(charge_bp), 0) INTO v_max_charge_bp FROM method_rates WHERE rate_profile_id = p_profile_id;`
  `IF (v_vat_bp + v_comm_bp + v_max_charge_bp > 10000) THEN RAISE EXCEPTION '422 deductions_exceed_100_percent'; END IF;`
  Acquires `pg_advisory_xact_lock(1003, 1)`, assigns version, sets `status = 'published'`, `published_at = now()`.

- `record_settlement_payment(p_settlement_id uuid, p_amount_poisha bigint, p_paid_on date, p_reference text, p_receipt_path text, p_note text, p_is_reversal boolean, p_reverses_id uuid, p_actor_id uuid)` (F17, F36, F50, Finding 6, Item 1, Item 2.1, Item 3, Item 4, m5):
  Admin or Owner only. Asserts `p_amount_poisha > 0`.
  Asserts `p_paid_on <= (now() at time zone 'Asia/Dhaka')::date` (m5: prevents future-date typos; raises `422 future_payment_date`).
  1. Queries month from `settlements WHERE id = p_settlement_id;` normalizes `v_month`.
  2. Acquires month advisory lock (Step 1, Item 2.1): `perform pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);`
  3. Row-locks parent settlement: `SELECT id, expected_poisha, paid_poisha INTO v_settlement_id, v_expected, v_current_paid FROM settlements WHERE id = p_settlement_id FOR UPDATE;`
  4. Closed-Month Payout Policy (Item 3): Since `close_month()` gates on statements being reconciled and overpayments approved, businesses close the accounting month once reconciled and record the actual payout on `due_day` of the following month. If `v_month` is closed:
     - Asserts `NOT p_is_reversal` (reversals on closed months are blocked unless reopened).
     - Asserts payment does not exceed expected liability (`coalesce(v_current_paid, 0) + p_amount_poisha <= v_expected`); creating an overpayment in a closed month raises `422 month_closed`.
  5. If `p_is_reversal = true`:
     - Row-locks target payment: `SELECT amount_poisha, settlement_id, is_reversal INTO v_target_amount, v_target_settlement_id, v_target_is_reversal FROM settlement_payments WHERE id = p_reverses_id FOR UPDATE;`
     - Asserts `NOT v_target_is_reversal`, `v_target_settlement_id = p_settlement_id`, and `coalesce((SELECT sum(amount_poisha) FROM settlement_payments WHERE reverses_payment_id = p_reverses_id AND is_reversal = true), 0) + p_amount_poisha <= v_target_amount`.
  6. Inserts into `settlement_payments (settlement_id, amount_poisha, paid_on, reference, receipt_storage_path, note, is_reversal, reverses_payment_id, recorded_by)` with `recorded_by = p_actor_id` (Item 1).
  7. Recalculates: `v_new_paid := (SELECT coalesce(sum(amount_poisha * (case when is_reversal then -1 else 1 end)), 0) FROM settlement_payments WHERE settlement_id = p_settlement_id);`
  8. Updates `settlements SET paid_poisha = v_new_paid, updated_at = now() WHERE id = p_settlement_id;` (This UPDATE fires `trg_settlements_recalc_status_and_overpayment`, recalculating status and invalidating overpayments in a single authoritative place).
  9. Appends `settlement.payment` to `audit_log`.

- `create_or_update_draft_rate_profile(p_profile_id uuid, p_effective_from date, p_vat_mode text, p_vat_bp integer, p_commission_base text, p_commission_bp integer, p_charges_borne_by text, p_note text, p_method_rates jsonb, p_actor_id uuid)` (F18, F41, Item 4):
  Admin or Owner only. Asserts `p_effective_from >= (now() at time zone 'Asia/Dhaka')::date`.
  If `p_profile_id` is null:
    Generates new UUID, inserts into `rate_profiles (effective_from, vat_mode, vat_bp, commission_base, commission_bp, charges_borne_by, note, status, created_by)` with `status = 'draft'`.
    Logs `rate_profile.create` to `audit_log`.
  If `p_profile_id` is provided:
    Asserts `status = 'draft'` (trigger blocks updating published profiles). Updates fields.
    Logs `rate_profile.update` to `audit_log`.
  Upserts associated `method_rates` rows from `p_method_rates`.

- `create_statement(p_kind text, p_month date, p_source text, p_file_storage_path text, p_statement_total_poisha bigint, p_payable_ids uuid[], p_lines jsonb, p_actor_id uuid)` (F21, F37, F55, Item 1, Item 2, Item 3, Item 4):
  Admin or Owner only. Asserts `p_kind IN ('single_payable', 'combined_card')` and `p_source IN ('manual_total', 'file')`.
  1. Normalizes `v_month := date_trunc('month', p_month)::date;`
  2. Acquires month advisory lock `pg_advisory_xact_lock(1001, extract(year from v_month)::int * 12 + extract(month from v_month)::int);`
  3. Asserts month is open (Item 3): `IF EXISTS (SELECT 1 FROM month_closes WHERE month = v_month AND status = 'closed') THEN RAISE EXCEPTION '422 month_closed'; END IF;`
  4. Computes `expected_poisha`:
     - For method charges: sums `business_charge_poisha` of active entries in `v_month` for covered methods.
     - For VAT: sums `vat_poisha` of active entries in `v_month`.
  5. Inserts into `statements (kind, month, source, file_storage_path, statement_total_poisha, expected_poisha, status, created_by)` with `created_by = p_actor_id` (Item 1).
  6. Inserts covered payables into `statement_payables (statement_id, payable_id, month, status)`. (Unique partial index `uq_active_statement_coverage` prevents overlapping active coverage).
  7. Statement Lines Ingestion (Mode B, Item 2):
     - If `p_source = 'file'`: Asserts `p_lines IS NOT NULL AND jsonb_array_length(p_lines) > 0`. Inserts parsed lines into `statement_lines (statement_id, line_date, reference, gross_poisha, fee_poisha, raw, match_status, is_active_match)`, normalizing `reference := nullif(upper(trim(line->>'reference')), '')`. Automatically executes initial reference-matching pass against active entries for covered payables in `v_month`.
     - If `p_source = 'manual_total'`: Asserts `p_lines IS NULL OR jsonb_array_length(p_lines) = 0`.
  8. Appends `statement.create` to `audit_log`.

- `supersede_statement(p_original_statement_id uuid, p_file_storage_path text, p_statement_total_poisha bigint, p_note text, p_lines jsonb, p_actor_id uuid)` (F22, F37, Item 2, Item 3, Item 4):
  Admin or Owner only.
  1. Queries month from original statement; normalizes `v_month`.
  2. Acquires month advisory lock `(1001, v_month)`.
  3. Asserts month is open (Item 3): `IF EXISTS (SELECT 1 FROM month_closes WHERE month = v_month AND status = 'closed') THEN RAISE EXCEPTION '422 month_closed'; END IF;`
  4. Row-locks original statement: `SELECT * FROM statements WHERE id = p_original_statement_id FOR UPDATE;`
  5. Asserts `original.status != 'superseded'`.
  6. Generates `v_new_statement_id := gen_random_uuid();`
  7. Marks original `status = 'superseded', superseded_by = v_new_statement_id, updated_at = now();`
  8. Updates original statement lines: `UPDATE statement_lines SET is_active_match = false WHERE statement_id = p_original_statement_id;`
  9. Updates original covered payables: `UPDATE statement_payables SET status = 'superseded' WHERE statement_id = p_original_statement_id;`
  10. Inserts new statement row (`created_by = p_actor_id`) and linked `statement_payables`.
  11. If original statement had `source = 'file'`, asserts `p_lines IS NOT NULL AND jsonb_array_length(p_lines) > 0`, inserts replacement lines into `statement_lines` for `v_new_statement_id`, and executes auto-matching pass (Item 2).
  12. Appends `statement.supersede` to `audit_log`.

- `match_statement_line(p_line_id uuid, p_entry_id uuid, p_actor_id uuid)` (F22, F69, Item 3, Item 4):
  Admin or Owner only.
  1. Queries month and statement ID from line: `SELECT s.month, sl.statement_id INTO v_month, v_statement_id FROM statement_lines sl JOIN statements s ON s.id = sl.statement_id WHERE sl.id = p_line_id;`
  2. Acquires month advisory lock `(1001, v_month)`.
  3. Asserts month is open (Item 3): `IF EXISTS (SELECT 1 FROM month_closes WHERE month = v_month AND status = 'closed') THEN RAISE EXCEPTION '422 month_closed'; END IF;`
  4. Row-locks line: `SELECT * FROM statement_lines WHERE id = p_line_id FOR UPDATE;`
  5. Asserts `match_status = 'unmatched'` and `matched_entry_id IS NULL`.
  6. Row-locks entry: `SELECT * FROM entries WHERE id = p_entry_id FOR UPDATE;`
  7. Asserts `entries.status = 'active'`, `date_trunc('month', entries.entry_date)::date = v_month`, and entry method matches covered payables for the statement.
  8. Updates line: `UPDATE statement_lines SET matched_entry_id = p_entry_id, match_status = 'matched', is_active_match = true, updated_at = now() WHERE id = p_line_id;`
  9. Appends `statement.match_line` to `audit_log`.

- `unmatch_statement_line(p_line_id uuid, p_reason text, p_actor_id uuid)` (H4):
  Admin or Owner only. Asserts `length(trim(p_reason)) > 0`.
  1. Queries month and statement ID from line: `SELECT s.month, sl.statement_id INTO v_month, v_statement_id FROM statement_lines sl JOIN statements s ON s.id = sl.statement_id WHERE sl.id = p_line_id;`
  2. Acquires month advisory lock `(1001, v_month)`.
  3. Asserts month is open: `IF EXISTS (SELECT 1 FROM month_closes WHERE month = v_month AND status = 'closed') THEN RAISE EXCEPTION '422 month_closed'; END IF;`
  4. Row-locks line: `SELECT * FROM statement_lines WHERE id = p_line_id FOR UPDATE;`
  5. Asserts `match_status = 'matched'` and `matched_entry_id IS NOT NULL`.
  6. Updates line: `UPDATE statement_lines SET match_status = 'unmatched', matched_entry_id = null, updated_at = now() WHERE id = p_line_id;`
  7. Invalidation cascade (F47, H4): If parent statement or child `statement_payables` were `'reconciled'`, cascades them back to `'open'`:
     `UPDATE statements SET status = 'open', updated_at = now() WHERE id = v_statement_id AND status = 'reconciled';`
     `UPDATE statement_payables SET status = 'open' WHERE statement_id = v_statement_id AND status = 'reconciled';`
  8. Appends `statement.unmatch_line` to `audit_log`.

- `admin_manage_payment_method(p_action text, p_id uuid, p_code text, p_name text, p_sort_order int, p_active boolean, p_requires_txn_ref boolean, p_actor_id uuid)` (F43, F53, Item 1, Item 4):
  Admin or Owner only.
  If `p_action = 'create'`: asserts `p_code` and `p_name` are not null; inserts into `payment_methods (code, name, sort_order, active, requires_txn_ref)`. Logs `payment_method.create`.
  If `p_action = 'update'`: updates `name`, `sort_order`, `active`, `requires_txn_ref`, `updated_at = now()`. Code update is blocked by trigger `trg_payment_methods_immutable_code`. Setting `active = true` triggers `trg_payment_methods_active_rate_check`. Logs `payment_method.update`.

- `admin_manage_payable(p_action text, p_id uuid, p_kind text, p_method_id uuid, p_code text, p_name text, p_due_day int, p_remind_days_before int, p_active boolean, p_actor_id uuid)` (Finding 4, Item 1, Item 4):
  Admin or Owner only.
  If `p_action = 'create'`: asserts `p_code` and `p_name` are not null, `p_due_day between 1 and 28`, `p_remind_days_before >= 0`; inserts into `payables (code, name, kind, method_id, due_day, remind_days_before, active)`. Enforced by `chk_payable_method_consistency` and unique partial indexes `uq_active_vat_payable` / `uq_active_method_payable`. Logs `payable.create`.
  If `p_action = 'update'`: updates `name`, `due_day`, `remind_days_before`, `active`, `updated_at = now()`. Code and kind are immutable. Logs `payable.update`.

- `admin_update_settings(p_settings jsonb, p_actor_id uuid)` (Item 1, Item 4):
  Admin or Owner only.
  Updates `app_settings` singleton row (`net_label`, `reconcile_tolerance_poisha`, `timezone`, `currency`, `locale`, `updated_at = now()`).
  Logs `app_settings.update` to `audit_log`.

- `admin_manage_user(p_action text, p_user_id uuid, p_role text, p_active boolean, p_actor_id uuid)` (F15, Item 4):
  Admin or Owner only.
  Caller permission check: If caller is Admin, rejects attempts to modify accounts with role `'admin'` or `'owner'`.
  If caller is Owner modifying self: blocks setting `active = false` via trigger `trg_users_prevent_sole_owner_deactivation` (must transfer ownership first).
  If `p_action = 'update_role'`: updates `profiles.role`. Logs `user.role_change`.
  If `p_action = 'deactivate'`: sets `profiles.active = false`. Logs `user.deactivate`.

- `admin_manage_device(p_device_id text, p_action text, p_actor_id uuid)` (H3, M4):
  Admin or Owner only.
  If `p_action = 'revoke'`: sets `devices.revoked = true` (remote killswitch; immediate revocation of lost/stolen device session). Logs `device.revoke`.
  If `p_action = 'unrevoke'`: sets `devices.revoked = false`. Logs `device.unrevoke`.

- `upsert_device_sync_state(p_device_id text, p_user_id uuid, p_rate_version int)` (H3, M4):
  Invoked under `service_role` during `/api/v1/sync/pull`.
  Upserts device presence and rate profile watermark:
  ```sql
  INSERT INTO devices (id, user_id, last_seen_at, last_rate_version)
  VALUES (p_device_id, p_user_id, now(), coalesce(p_rate_version, 0))
  ON CONFLICT (id) DO UPDATE
  SET user_id = EXCLUDED.user_id,
      last_seen_at = now(),
      last_rate_version = GREATEST(devices.last_rate_version, EXCLUDED.last_rate_version);
  ```

- Maintenance Routine `purge_expired_sync_ops()` (M2):
  Scheduled via `pg_cron` (runs daily at 03:00 Asia/Dhaka):
  Deletes resolved sync operations (`resolution_status in ('resolved', 'discarded')`) where `created_at < now() - interval '90 days'`.
  Deletes child superseding operations first, or leverages `ON DELETE SET NULL` on `supersedes_rejected_op_id` to prevent FK constraint violations.
  Unresolved rejected operations (`resolution_status = 'pending'`) are permanently preserved until explicitly resolved or discarded.

Database Triggers:
- Commit-order cursor trigger `trg_entries_server_seq` (F3, F54): sole authoritative sequence allocator; BEFORE INSERT OR UPDATE ON entries assigns `NEW.server_seq := nextval('entry_seq')` under sequence advisory lock on **every** INSERT and UPDATE (including voids and supersedes).
- Rate profile draft/publish lock (F18, F41): blocks UPDATE and DELETE on `rate_profiles` once published; blocks INSERT, UPDATE, and DELETE on `method_rates` for published profiles.
- Payment method code lock (F43): blocks UPDATE on `payment_methods.code`.
- Payment method active profile guard (F53): blocks setting `active = true` on `payment_methods` unless covered by the currently effective published rate profile.
- Financial entries immutability trigger (F19): blocks DELETE on `entries`; blocks direct UPDATE on financial/identity fields.
- Settlement dynamic recalculation trigger `trg_entries_recalc_settlements` (H1, Test #6): AFTER INSERT OR UPDATE OF `status, entry_date, method_id, gross_poisha, vat_poisha, business_charge_poisha` ON `entries` FOR EACH ROW WHEN `(NEW.status = 'active' OR (TG_OP = 'UPDATE' AND OLD.status = 'active'))`:
  1. Identifies affected month(s): `NEW` month, and if date shifted, `OLD` month.
  2. For each open month (`NOT EXISTS (SELECT 1 FROM month_closes mc WHERE mc.month = v_month AND mc.status = 'closed')`):
     - For VAT payable: recalculates `COALESCE(SUM(vat_poisha), 0)` from active entries in `v_month`.
     - For affected Method Charge payable(s) (`NEW.method_id`, `OLD.method_id`): recalculates `COALESCE(SUM(business_charge_poisha), 0)` from active entries in `v_month`.
     - Live Upsert into `settlements`:
       ```sql
       INSERT INTO settlements (payable_id, month, expected_poisha, paid_poisha, status)
       VALUES (v_payable_id, v_month, v_expected, 0, calc_settlement_status(v_expected, 0))
       ON CONFLICT (payable_id, month) DO UPDATE
       SET expected_poisha = EXCLUDED.expected_poisha, updated_at = now()
       WHERE NOT EXISTS (SELECT 1 FROM month_closes mc WHERE mc.month = v_month AND mc.status = 'closed');
       ```
     - Statement Recalculation & Invalidation Cascade (F47, Item 2): Updates `statements.expected_poisha` for any non-superseded statement covering the affected payables in `v_month` to match the current sum of active entries across covered payables, resetting `status = 'open'` and updating child `statement_payables.status = 'open'`:
       ```sql
       UPDATE statements s
       SET expected_poisha = (
         SELECT coalesce(sum(
           case
             when p.kind = 'vat' then e.vat_poisha
             when p.kind = 'method_charge' and e.method_id = p.method_id then e.business_charge_poisha
             else 0
           end
         ), 0)
         FROM statement_payables sp
         JOIN payables p ON p.id = sp.payable_id
         JOIN entries e ON date_trunc('month', e.entry_date)::date = s.month AND e.status = 'active'
         WHERE sp.statement_id = s.id
       ),
       status = 'open',
       updated_at = now()
       WHERE s.month = v_month AND s.status != 'superseded'
         AND EXISTS (SELECT 1 FROM statement_payables sp WHERE sp.statement_id = s.id AND sp.payable_id = v_payable_id);

       UPDATE statement_payables sp
       SET status = 'open'
       FROM statements s
       WHERE sp.statement_id = s.id AND s.month = v_month AND s.status != 'superseded'
         AND sp.payable_id = v_payable_id;
       ```
       (Since `statements.variance_poisha` is a stored generated column `statement_total_poisha - expected_poisha`, updating `expected_poisha` automatically recalculates variance in real time, keeping open and invalidated statements dynamically accurate and allowing subsequent `reconcile_statement()` recomputation checks to succeed).
- Settlement status recalculation & overpayment invalidation trigger `trg_settlements_recalc_status_and_overpayment` (Items 2.2, F68, Finding 1): BEFORE UPDATE OF `expected_poisha`, `paid_poisha` ON `settlements` automatically computes `NEW.status := calc_settlement_status(NEW.expected_poisha, NEW.paid_poisha);`.
  - Overpayment Invalidation Rule (Finding 1):
    Whenever `(OLD.overpayment_review_status = 'approved' AND (NEW.status != 'overpaid' OR (NEW.paid_poisha - NEW.expected_poisha) IS DISTINCT FROM OLD.overpayment_approved_amount_poisha))` OR `(OLD.overpayment_review_status = 'pending_approval' AND NEW.status != 'overpaid')`:
    Resets **all five** overpayment columns to satisfy `chk_overpayment_approval`:
    `NEW.overpayment_review_status := 'none';`
    `NEW.overpayment_approved_amount_poisha := null;`
    `NEW.overpayment_reason := null;`
    `NEW.overpayment_approved_by := null;`
    `NEW.overpayment_approved_at := null;`
    If transitioning from `'approved'`, appends `settlement.overpayment_invalidated` to `audit_log`.
- Statement line unmatching trigger `trg_entries_unmatch_statement_lines` (Item 3.1): AFTER UPDATE OF `status, entry_date, method_id` ON `entries` FOR EACH ROW WHEN `(OLD.status = 'active' AND (NEW.status IN ('voided', 'superseded') OR date_trunc('month', NEW.entry_date) != date_trunc('month', OLD.entry_date) OR NEW.method_id != OLD.method_id))` sets `statement_lines.matched_entry_id = null, statement_lines.match_status = 'unmatched' WHERE matched_entry_id = OLD.id AND is_active_match = true`.
- Reconciliation exception invalidation trigger `trg_entry_exceptions_invalidate_reconciliation` (H5, Test #54): AFTER UPDATE OR DELETE ON `entry_reconciliation_exceptions` FOR EACH ROW WHEN `(OLD.status = 'approved' AND (TG_OP = 'DELETE' OR NEW.status != 'approved'))`:
  Automatically invalidates any reconciled statement covering `OLD.payable_id` in `OLD.month`:
  `UPDATE statements s SET status = 'open', updated_at = now() FROM statement_payables sp WHERE sp.statement_id = s.id AND sp.payable_id = OLD.payable_id AND s.month = OLD.month AND s.status = 'reconciled';`
  `UPDATE statement_payables SET status = 'open' WHERE payable_id = OLD.payable_id AND month = OLD.month AND status = 'reconciled';`
- Settlement payment reversal lock & reduction trigger (F17, F36, F50, Finding 6): locks target row with `SELECT FOR UPDATE`, validates cumulative reversals <= original amount, recalculates `settlements.paid_poisha` via `UPDATE settlements`. Blocks direct UPDATE and DELETE on `settlement_payments`.
- Statement invalidation & supersession trigger (F22, F37, F47): when entries modify liabilities in an open month, resets parent `statements.status = 'open'` and cascades `statement_payables.status = 'open'`; on supersession, sets `is_active_match = false` on child `statement_lines` and updates `statement_payables.status = 'superseded'`.
- Audit log immutability trigger (F19): blocks UPDATE and DELETE on `audit_log`.

### 7.4 Bootstrap Runbook & Seed Script (M0, H6)

Because `profiles.id` references Supabase `auth.users`, and `publish_rate_profile()` strictly prohibits backdating, initial database provisioning cannot execute via pure static DDL. The initial system baseline is provisioned via an automated bootstrap runner script (`scripts/bootstrap.ts`) using Supabase Auth Admin API and `service_role` credentials:

1. **Step 1: Provision Initial Owner Auth User**:
   Invokes Supabase Auth Admin API:
   ```ts
   const { data: user, error } = await supabase.auth.admin.createUser({
     email: process.env.BOOTSTRAP_OWNER_EMAIL,
     password: process.env.BOOTSTRAP_OWNER_PASSWORD,
     email_confirm: true,
     user_metadata: { full_name: 'Primary Owner' }
   });
   ```
2. **Step 2: Insert Owner Profile**:
   Inserts the corresponding row in `profiles`:
   ```sql
   INSERT INTO profiles (id, full_name, role, active)
   VALUES (user.id, 'Primary Owner', 'owner', true);
   ```
3. **Step 3: Seed Canonical Payment Methods**:
   ```sql
   INSERT INTO payment_methods (code, name, requires_txn_ref, sort_order, active) VALUES
     ('cash', 'Cash', false, 1, true),
     ('bkash', 'bKash', true, 2, true),
     ('visa', 'Visa', true, 3, true),
     ('mastercard', 'Mastercard', true, 4, true),
     ('bank_transfer', 'Bank Transfer', true, 5, true);
   ```
4. **Step 4: Seed Canonical Payables**:
   ```sql
   INSERT INTO payables (code, name, kind, method_id, due_day, remind_days_before, active) VALUES
     ('vat_payable', 'Government VAT Challan', 'vat', null, 15, 3, true),
     ('bkash_charge_payable', 'bKash Merchant Charge', 'method_charge', (SELECT id FROM payment_methods WHERE code = 'bkash'), 10, 3, true),
     ('visa_charge_payable', 'Visa Merchant Charge', 'method_charge', (SELECT id FROM payment_methods WHERE code = 'visa'), 15, 3, true),
     ('mastercard_charge_payable', 'Mastercard Merchant Charge', 'method_charge', (SELECT id FROM payment_methods WHERE code = 'mastercard'), 15, 3, true);
   ```
5. **Step 5: Seed & Publish Rate Profile v1 (Bootstrap Exemption)**:
   Inserts Profile v1 directly with `status = 'published'` effective from the current business date:
   ```sql
   INSERT INTO rate_profiles (id, version, status, effective_from, vat_mode, vat_bp, commission_base, commission_bp, charges_borne_by, note, created_by, published_at)
   VALUES (
     gen_random_uuid(),
     1,
     'published',
     (now() at time zone 'Asia/Dhaka')::date,
     'manual',
     0,
     'gross_minus_vat',
     4200,
     'business',
     'Initial system rate profile v1 (seeded via M0 bootstrap)',
     user.id,
     now()
   );
   ```
   *(Note: Documented in `DECISIONS.md`: Seeding Profile v1 directly under `service_role` establishes the initial published rate profile so day-one transaction sync succeeds without violating `publish_rate_profile()` runtime backdating constraints).*
6. **Step 6: Seed `method_rates` for Profile v1**:
   Covers all active payment methods:
   ```sql
   INSERT INTO method_rates (rate_profile_id, method_id, charge_bp)
   SELECT p.id, m.id,
     CASE m.code
       WHEN 'bkash' THEN 115
       WHEN 'visa' THEN 150
       WHEN 'mastercard' THEN 150
       ELSE 0
     END
   FROM rate_profiles p CROSS JOIN payment_methods m
   WHERE p.version = 1 AND p.status = 'published';
   ```
7. **Step 7: Initialize `app_settings`**:
   ```sql
   INSERT INTO app_settings (id, timezone, currency, locale, net_label, reconcile_tolerance_poisha)
   VALUES (true, 'Asia/Dhaka', 'BDT', 'en-BD', 'Net after deductions', 100)
   ON CONFLICT (id) DO NOTHING;
   ```
8. **Step 8: Initialize Monthly Settlements**:
   Executes `generate_monthly_settlements((now() at time zone 'Asia/Dhaka')::date)` to populate initial settlement rows.

Verification: The M0 Definition of Done requires running `scripts/bootstrap.ts` against a blank Supabase instance, asserting all 18 tables, profile v1, payables, and settlements exist.

## 8. Functional requirements

### 8.1 New entry (primary screen)

- Fields:
  - Entry date: default today (Asia/Dhaka timezone). When changed, the form dynamically loads the cached published profile effective for that `entry_date` (`effective_from <= entry_date`, sorted by `effective_from DESC, version DESC LIMIT 1`) from Dexie, alerting the user if historical rates differ from current rates (Finding A3).
  - Human-readable ID: While offline / pending sync, shows a temporary badge `#LOCAL-xxxx` (first 6 characters of client UUID). Once synced, the server assigns a sequential `entry_number` formatted as `E-YYYYMM-XXXXXX` (e.g., `E-202610-000042`). Semantics (m2): `YYYYMM` is derived from the transaction's business `entry_date`, while `XXXXXX` is zero-padded from the monotonically increasing global sequence `entry_number_seq`.
  - Customer name: required, free text.
  - Sub quantity: integer, default `1`, min `0` (m3: e.g. countable sessions, services, or units; sums to 16 in fixture; `sub_qty = 0` is valid for non-unit retainer, deposit, or fee-only adjustments).
  - Sub description: optional text for qualitative notes.
  - Gross amount: entered in BDT (converted to integer poisha on keystroke).
  - Payment method: dropdown/chips (bKash, Visa, Mastercard, Cash, Bank Transfer, etc.).
  - Transaction (tracing) ID: required when method has `requires_txn_ref = true`. The client automatically trims and uppercases input: `txn_ref = nullif(upper(trim(rawInput)), '')` (e.g., `bjt84920kl ` $\to$ `BJT84920KL`) to prevent search and reconciliation mismatches.
  - Notes: optional text.
  - VAT field: displayed and required when active profile has `vat.mode = manual`. Hidden / auto-computed when in percentage modes.
- Live breakdown card: recalculates instantly on every keystroke using `packages/calc` with the rate profile effective for the selected `entry_date`.
- UI specification for `chargesBorneBy`:
  - When `chargesBorneBy = 'business'` (default):
    - Breakdown card lists method charge as a deduction: `bKash charge (1.15%): -৳67.95`.
    - `net_after_deductions = gross - vat - commission - charge`.
  - When `chargesBorneBy = 'customer'`:
    - Breakdown card displays: `bKash charge (1.15%): ৳67.95 (Customer-paid — not deducted)`.
    - `net_after_deductions = gross - vat - commission` (charge is NOT subtracted from business net; merchant owes no provider fee liability).
- Duplicate warning banner (non-blocking): triggers if same `txn_ref` + method exists, or same customer + amount + date against active entries (`status = 'active'`).
- Local-first save: writes to Dexie `entries` and `outbox` within 100ms. UI immediately returns to empty form or ledger with a toast and "Pending sync" status badge. Never blocks on connectivity (Rule #7).
- Acceptance: with rate profile from 6.6 loaded, entering 5909 gross, VAT 509, bKash method shows commission ৳2,268.00 (226800 poisha), charge ৳67.95 (6795 poisha), net ৳3,064.05 (306405 poisha) and saves while offline.

### 8.2 Ledger

- Grouped by day, newest first, daily subtotals.
- Display: each row displays `entry_number` (`E-YYYYMM-XXXXXX`, e.g. `E-202610-000042`, or `#LOCAL-xxxx`), customer name, `sub_qty`, method badge, gross, deductions, and net. If `chargesBorneBy = 'customer'`, displays a subtle `[Customer Fee]` badge.
- Search and filters: search by `entry_number`, customer name, `txn_ref`, and notes. Search queries targeting entry numbers automatically strip any formatted `E-\d{6}-0*` or `E-0*` prefix before querying raw integer `entries.entry_number`. Filter by date range, payment method, creator staff, status (`active`, `pending_sync`, `voided`, `superseded`), and flags (`duplicate_txn`, `stale_rates`).
- Detail drawer / page: displays full breakdown, snapshot rates applied, creator, device ID, created/updated timestamps, supersede history chain, and audit events.
- Void flow (Finding A7): Staff can tap "Request Void" only on active entries (`status = 'active'`; attempting to request void on voided or superseded entries is blocked in the UI and rejected with `422 cannot_void_non_active`). Opens modal for mandatory reason, writes `void_requested_by/at`. Admin or Owner taps "Approve Void" or directly "Void Entry" (marks `status = 'voided'`, sets `voided_at`, excludes from reports, draws strikethrough in ledger). Entries are never hard-deleted.
- Supersede (edit) flow (Finding 3, Finding A7):
  1. Permissions: Admin or Owner directly (Staff must request a void and create a new entry).
  2. Initiation: Clicking "Edit / Supersede" is allowed strictly on an active entry (`status = 'active'`; non-active entries reject with `422 cannot_supersede_non_active`). Opens the Entry Form in Supersede mode with a banner: `Editing Entry E-202610-000042 (Will supersede original)`.
  3. Pre-population: All original fields (date, customer, sub_qty, sub_description, method, gross, txn_ref, overrides, notes) are pre-filled.
  4. Modifications: Any field can be corrected. Calculations dynamically update using the rate profile effective for the replacement entry date.
  5. Save & Chain: Saving creates a new entry with `supersedes_id` pointing to the original entry's UUID. The original entry is marked `status = 'superseded'` with `superseded_at = now()`.
  6. Audit & Recovery Lifecycle (Finding A7): In the ledger, superseded entries are dimmed. If successor Entry B is subsequently voided, the transaction is formally cancelled. If an operator inadvertently voided B and needs to record a valid replacement, original Entry A remains immutably `superseded` (cannot be reopened); the operator enters a fresh Entry C referencing the historical UUIDs of A and B in `notes`, preserving an unalterable audit chain.
- Mutating Unsynced Local Entries Offline: If a user taps "Request Void", "Void", or "Edit / Supersede" on an entry that is still pending sync (`#LOCAL-xxxx`), the client appends the mutation operation to the Dexie `outbox` referencing the local entry UUID. Operations are pushed in strict FIFO order (`clientCreatedAt` / local sequence). If the preceding `create_entry` operation is rejected or fails in a subtransaction, dependent operations in the batch fail gracefully with `parent_entry_not_found`.

### 8.3 Reports (core output)

Computed strictly from active entries (`status = 'active'`, not voided, not superseded) grouped by `entry_date` month:

- Month picker with previous / next navigation.
- Payables summary table: VAT, bKash charge, Visa charge, Mastercard charge, each with monthly total in poisha and BDT, entry count, and settlement status (`not_applicable`, `due`, `partly_paid`, `paid`, `overpaid`) determined by `calc_settlement_status()` (F50).
  - Note on `chargesBorneBy = 'customer'`: If a method's charges were borne by customers, that charge total is displayed in a separate informational section `Customer-paid provider fees` and is excluded from business settlement liabilities.
- Income summary: total collected (gross), commission earned, net after deductions.
- Sub-quantity summary: total sessions/units (`sum(sub_qty)`), matching the paper ledger's sum (e.g. 16 in fixture).
- Breakdown by payment method and by day, daily trend chart, month-over-month deltas.
- Full entry list with a totals row that equals the summary cards exactly (asserted in tests).
- Drill-down: tap any aggregate total to filter the ledger view to the exact underlying entries.
- Export: print-ready PDF statement (clean print stylesheet) and CSV/XLSX export.
- Historical immutability: past months never change when rate profiles change (totals derive from per-entry stored snapshot values).

### 8.4 Monthly settlement

- After month end, app generates one `settlements` row per active payable for that month with `expected_poisha` computed from active entries.
- Settlement lifecycle & live recalculation:
  - **Prior to Month Close**: `expected_poisha` is dynamic. Maintained continuously by trigger `trg_entries_recalc_settlements` (H1, Test #6): Any insert, void, or supersede of an active entry in an open month automatically creates/updates the corresponding `settlements` row for that payable and month, recomputes `expected_poisha`, and updates `variance_poisha`. Open-month reports and settlement screens always read live, accurate liability figures.
  - **Reconciliation Invalidation (F47, H1)**: If active entries in an open month change after a statement for that payable has already been marked `reconciled`, the parent statement status automatically reverts to `'open'` AND all child `statement_payables` rows revert to `'open'` in the same transaction, with an alert: `Expected liability changed; re-reconciliation required`.
  - **On Month Close**: `expected_poisha` is permanently frozen and locked.
  - **On Month Reopen**: The lock is released; recalculations resume, and an audit event is logged.
- Due date = `due_day` of the following month (admin-set per payable). In-app reminders start `remind_days_before` days earlier. Overdue banner appears if unpaid after the due date.
- Multiple payment tracking: Admin or Owner records partial or full payments in `settlement_payments` (date, amount_poisha, reference, receipt photo path, note).
- Payment corrections: Historical payments cannot be mutated or deleted in place. Corrections require recording an explicit reversal row with `is_reversal = true` (audited).
- Denormalized status: A trigger recalculates `settlements.paid_poisha` and automatically transitions status using `calc_settlement_status(expected_poisha, paid_poisha)` (F50):
  - `not_applicable`: `expected_poisha = 0 and paid_poisha = 0` (zero liability; satisfies month close gating without payment).
  - `due`: `expected_poisha > 0 and paid_poisha = 0`.
  - `partly_paid`: `0 < paid_poisha < expected_poisha`.
  - `overpaid`: `paid_poisha > expected_poisha` (surplus; displays `[Overpaid]` badge with positive variance surplus `+৳...`; requires explicit Owner approval via `approve_settlement_overpayment(settlement_id, reason, actor_id)` recording the exact surplus amount; if the surplus amount changes, approval is automatically invalidated, F68).
  - Variance = `paid_poisha - expected_poisha` is always displayed.
- Month close gating: Owner can close a month only when every payable for that month is reconciled (variance within tolerance or covered by a mandatory note) and any overpaid settlements have active Owner approvals matching the exact surplus amount (F68). If the month has never been closed before, `close_month()` performs an idempotent insert into `month_closes` (F70). Closing locks all entries whose `entry_date` falls in that month against edits, voids, and additions.
- Owner can reopen a closed month by providing a mandatory audit reason.
- Offline entry for a closed month (recovery workflow, F4, F14, F23, F45):
  - If a device creates an entry offline dated in October, and the Owner closes October before the device syncs, the server push rejects that op with `{ status: 'rejected', reason: 'month_closed' }`.
  - The local client moves the entry into a dedicated "Needs Attention (Closed Month)" queue on the Admin/Owner dashboard.
  - The Admin or Owner has three explicit resolution options:
    1. **Reassign to Open Month (M5)**: Updates `entry_date` to the 1st of the current open month, preserves original date in `entries.original_entry_date`, requires a mandatory `reassign_reason text`, displays a clear UI warning ("Reassigning this transaction shifts VAT and merchant liability from <Closed Month> to <Open Month>"), recalculates snapshot, generates a new operation with a fresh `op_id` and `supersedes_rejected_op_id`, and pushes to sync.
    2. **Reopen Month (F23, F45 Sequence)**: Owner reopens the historical month (`reopen_month(month, reason)`). This automatically invalidates existing reconciled statements and child `statement_payables` for that month back to `'open'` (F47). **The client generates a fresh `op_id` with `supersedes_rejected_op_id` pointing to the original rejection** (F45). Replaying the original `op_id` is rejected by the server idempotency cache because the original rejection is immutable. The new operation syncs cleanly in the open month, dynamic recalculations update liabilities, Admin/Owner re-reconciles, and Owner re-closes the month.
    3. **Discard (F14, F35)**: Client sends a `discard_rejected_entry` operation with a mandatory reason. The server verifies caller authorization (`sync_ops.actor_id = caller_id` or Admin/Owner), records the discard in `sync_ops`, appends an audit event, and returns confirmation. Only after server confirmation does the client permanently purge the entry from local Dexie storage.

### 8.5 Dashboards (one per role, offline-capable)

| Role | Shows |
|---|---|
| Staff | My total collected today and this month, my recent entries, prominent New Entry button, pending sync counter. |
| Admin | Today and month-to-date metrics, entries by method, pending sync queue, void requests requiring approval, stale-rate alerts, duplicate txn flags, closed-month offline entries ("Needs Attention"), settlement checklist, staff activity. |
| Owner | Financial summary (Gross, Commission, Net vs last month), payables due with due dates and statuses, trend charts, unclosed months, reconciliation variance alerts, month close/reopen actions. |

### 8.6 Admin panel

- Rates and rules: edit VAT mode and rate, commission rate and base, per-method charge rates, who bears charges. Drafts are saved in `rate_profiles (status = 'draft')`. When complete, Admin/Owner taps "Publish Profile" which triggers `publish_rate_profile()` RPC, atomically validating complete method coverage, assigning sequential version, and locking against any further edits or child rate additions (F18).
  - Admin-side validation: On submit, the form tests deductions against 100%: `vat_bp + commission_bp + max(charge_bp) <= 10000`. If deductions exceed 100%, submission is blocked with an error highlighting the specific excess percentage.
- Payment methods: add, rename, reorder, activate/deactivate, toggle `requires_txn_ref`.
- Payables and schedule: set `due_day` (1–28) and `remind_days_before` per payable.
- Reconciliation tolerance: configure `reconcile_tolerance_poisha` (default: 100 poisha / ৳1.00).
- Users: invite users, assign roles (Staff, Admin), deactivate accounts. (Admin cannot modify Admin or Owner accounts).
- Ownership transfer (F15): Owner-only action initiating atomic `transfer_ownership(new_owner_id)` RPC.
- Audit log viewer: searchable and filterable by date, actor, action, and target table.
- Data tools: complete JSON/CSV export. (Historical import deferred to roadmap).

## 9. Offline-first and sync

Client storage: IndexedDB via Dexie. Tables: `entries`, `outbox`, `rateProfiles`, `methods`, `payables`, `profiles`, `settlements`, `statements`, `monthCloses`, `rejectedOps`, `meta` (pull cursor, device id, last sync).
- **Embedded Method Rates in DTO & Dexie**: In Dexie storage and in wire transfers, each `RateProfile` object explicitly embeds `methodRates: Record<string, number>` (mapping `methodId` to `chargeBp`) so offline client devices can run `packages/calc` without requiring relational database joins or network lookups.

### 9.1 API Contract and Wire Format

To guarantee precision across JavaScript, PostgreSQL, and JSON:
- **Wire Format Rule**: All 64-bit integer values (`Poisha` monetary amounts, `server_seq` cursors, `entry_number`) MUST be serialized as **decimal strings** in JSON payloads (e.g., `"grossPoisha": "590900"`, `"since": "1042"`).
- Inside TypeScript/Dexie: represented as native `bigint`.
- Zod schemas parse and validate numeric string to `bigint` on arrival: `z.string().regex(/^\d+$/).transform(BigInt)`.
- Decimal UI inputs: BDT amounts accept up to 2 decimal places (paisas). Inputs with > 2 decimal places are rejected with "Maximum 2 decimal digits allowed".

#### Outbox Operation Schema (`OutboxOp`)

```ts
interface OutboxOp {
  opId: string;                     // Client-generated UUID
  type: 'create_entry' | 'request_void' | 'void_entry' | 'supersede_entry' | 'discard_rejected_entry';
  payload: Record<string, unknown>; // Operation-specific data (all Poisha amounts as decimal strings)
  clientCreatedAt: string;          // ISO8601 string recorded at local enqueue (untrusted metadata, F39, F49)
  payloadHash?: string;             // Optional client SHA-256 for network transport check
  supersedesRejectedOpId?: string;  // If recovering from a previously rejected op (F45, Item 5)
  maxKnownRateVersion?: number;     // Highest rate profile version present in client's local cache at enqueue time (Item 3)
}
```

#### Sync Endpoints (SvelteKit `+server.ts`, versioned under `/api/v1/`)

> **Client Sync Execution Order**: The client sync runner MUST flush `/api/v1/sync/push` to completion (pushing all pending outbox operations) BEFORE calling `/api/v1/sync/pull`. This ensures that offline entries recorded before reconnection are pushed under the device's pre-pull state rather than racing with new rate profiles pulled from the server.

- `POST /api/v1/sync/push`:
  - Request body: `{ deviceId: string, ops: OutboxOp[] }`. Maximum 50 ops per request (rejects with `413 Payload Too Large` if exceeded).
  - Server Processing Protocol:
    1. Authenticate caller from verified Supabase Auth JWT (`auth.uid()`). Derive `caller_id` and `caller_role`.
    2. Check `profiles.active`. If `false`, reject entire request with `403 user_deactivated`.
    3. Invoke database procedure `rpc_push_sync_op(deviceId, caller_id, caller_role, ops_json)` in a single transaction (F26, F34).
    4. Execution inside `rpc_push_sync_op`:
       a. **Ascending Multi-Month Lock Acquisition (Finding 2, F46)**: Before executing mutations, extract all distinct target months from `p_ops` (including both original and replacement months for supersedes), normalize to first-of-month (`date_trunc('month', m)::date`), sort them in **ascending numeric order** ($M_1 < M_2 < \dots$), and acquire:
          `perform pg_advisory_xact_lock(1001, extract(year from m)::int * 12 + extract(month from m)::int);`
       b. **Complete Semantic Operation Hashing (F33, F49, Item 3)**: The server canonically stringifies the entire semantic operation:
          `canonical_op = { type: op.type, payload: op.payload, supersedesRejectedOpId: op.supersedesRejectedOpId ?? null, clientCreatedAt: op.clientCreatedAt, maxKnownRateVersion: op.maxKnownRateVersion ?? null }`
          Computes `server_calculated_hash = sha256(canonical_json(canonical_op))`.
       c. **Idempotency Check First (Item 5, Finding 8, F45)**: Query `sync_ops WHERE op_id = op.opId` **before** performing any table insert or evaluating transport hashes:
          - If found:
            - If `stored.payload_hash === server_calculated_hash`: return cached `{ opId: op.opId, status: result, reason }` (idempotent replay of previously processed op).
            - If `stored.payload_hash !== server_calculated_hash`: return `{ opId: op.opId, status: 'rejected', reason: 'op_id_conflict_tampered' }` without attempting a duplicate insert into `sync_ops` (preventing `23505 unique_violation`).
          - If not found:
            - **Transport Integrity Verification**: If the client supplied `op.payloadHash` and it differs from `server_calculated_hash`, record in `sync_ops` with `{ status: 'rejected', reason: 'payload_hash_mismatch' }` and return it (Finding 8).
            - **Superseded Op Ownership & State Verification (Item 5)**: If `op.supersedesRejectedOpId` is non-null, assert that the referenced row exists in `sync_ops` with `result = 'rejected'`, `resolution_status = 'pending'`, and `(actor_id = caller_id OR caller_role IN ('admin', 'owner'))`. If not satisfied, record in `sync_ops` and return `{ opId: op.opId, status: 'rejected', reason: 'invalid_superseded_op' }`.
       d. **Client Timestamp Sanity & Offline Retention (F39, F49, Finding 7)**:
          - Check clock skew: If `op.clientCreatedAt > (now() + interval '5 minutes')`, reject with `{ opId: op.opId, status: 'rejected', reason: 'future_timestamp_skew' }`.
          - Retention policy: `clientCreatedAt` is treated as advisory metadata; if `now() - op.clientCreatedAt > interval '90 days'`, flag and reject with `{ opId: op.opId, status: 'rejected', reason: 'queue_expired_needs_review' }`. The entry moves to the Admin/Owner review queue on the dashboard for explicit revalidation rather than being dropped silently.
       e. **Month-Close Check (F70)**: Check if an explicit closed record exists: `EXISTS (SELECT 1 FROM month_closes WHERE month = target_month AND status = 'closed')`. If closed, record in `sync_ops` (with `payload jsonb`, `resolution_status = 'pending'`) and return `{ opId: op.opId, status: 'rejected', reason: 'month_closed' }`. If no record exists in `month_closes`, the month is open by default and operations proceed.
       f. **Per-Operation Subtransaction Fault Isolation (F48, Finding 2, Finding 3, Finding A3, Item 3)**: Each operation executes in an isolated PL/pgSQL `BEGIN ... EXCEPTION WHEN OTHERS THEN ... END` subtransaction block adhering strictly to the lock hierarchy:
          - `create_entry`:
            - Query database for the authoritative published profile effective on `entry_date`:
              `SELECT id, effective_from FROM rate_profiles WHERE status = 'published' AND effective_from <= (op.payload->>'entryDate')::date ORDER BY effective_from DESC, version DESC LIMIT 1`.
            - Device Check & Remote Killswitch (H3, M4):
              If `p_device_id` is provided, server checks `devices WHERE id = p_device_id`. If `revoked = true`, rejects with `{ opId: op.opId, status: 'rejected', reason: 'device_revoked' }`.
            - Engine Version Check (H2):
              If `(op.payload->'snapshot'->>'engineVersion')::int != 1`, rejects with `{ opId: op.opId, status: 'rejected', reason: 'upgrade_required' }`.
            - Rate Profile Verification & Anti-Cherry-Picking (Finding A3, Rule #4, Item 3, H3):
              1. Submitted `rate_profile_id` MUST have `status = 'published'` and `effective_from <= entry_date` (otherwise reject with `{ opId: op.opId, status: 'rejected', reason: 'rate_profile_date_mismatch' }`).
              2. Let `v_expected_profile` be the highest-version profile with `status = 'published' AND effective_from <= entry_date AND version <= coalesce(op.maxKnownRateVersion, (op.payload->'snapshot'->>'version')::int)`. If `submitted_profile_id != v_expected_profile.id`, the client had a newer applicable profile in its local cache and cherry-picked an older one $\to$ reject with `{ opId: op.opId, status: 'rejected', reason: 'rate_profile_date_mismatch' }` (anti-cherry-picking, Test #41).
              3. Device Rate Watermark Grounding (H3): If `p_device_id` is provided, server cross-references `op.maxKnownRateVersion` against `devices.last_rate_version`. If `coalesce(op.maxKnownRateVersion, (op.payload->'snapshot'->>'version')::int) < devices.last_rate_version` AND `op.clientCreatedAt > devices.last_seen_at`, rejects with `{ opId: op.opId, status: 'rejected', reason: 'rate_profile_date_mismatch' }` (tampered / cherry-picked op created after pulling newer rate version). Legitimate offline entries created prior to pulling the newer profile (`op.clientCreatedAt <= devices.last_seen_at`) are accepted.
              4. Otherwise, let `v_latest_profile` be the highest-version published profile in the database with `effective_from <= entry_date`. If `submitted_profile_id != v_latest_profile.id`, a newer profile for `entry_date` was published on the server while the client was offline $\to$ accept the entry with `stale_rates = true` (offline stale rate preservation, Rule #4, Test #46, Test #9); otherwise `stale_rates = false`.
            - Normalize `txn_ref := nullif(upper(trim(op.payload->>'txnRef')), '')`. If `payment_methods.requires_txn_ref = true` and `v_txn_ref IS NULL`, reject with `{ opId: op.opId, status: 'rejected', reason: 'missing_txn_ref' }`.
            - Check active duplicate `txn_ref` against active entries (`WHERE method_id = v_method_id AND txn_ref = v_txn_ref AND status = 'active'`).
            - Verify `method_id` is active and covered in profile (F53). Recompute `packages/calc` with explicit inputs (F2, F20). Assert per-entry deduction guard. Acquire sequence advisory lock `pg_advisory_xact_lock(1002, 1)` (Finding 2). Insert into `entries` with `created_by = caller_id`. (Trigger `trg_entries_server_seq` assigns `server_seq` automatically, F54).
          - `request_void`: Allowed for Staff on own entries (`created_by = caller_id`) or Admin/Owner on any entry. Requires non-empty `void_request_reason` (F25). Asserts `entries.status = 'active'` (rejects with `cannot_void_non_active` if voided or superseded, Finding A7). Acquire sequence advisory lock `pg_advisory_xact_lock(1002, 1)`, then update `void_requested_by = caller_id`, `void_requested_at = now()`, `void_request_reason`. (Trigger automatically allocates new `server_seq`, F54).
          - `void_entry`: Admin or Owner only. Requires non-empty `void_reason` (F25). Asserts `entries.status = 'active'`. Acquire sequence advisory lock `pg_advisory_xact_lock(1002, 1)` **before** row lock (Finding 2). Acquires row lock `SELECT * FROM entries WHERE id = $1 FOR UPDATE`. Sets `status = 'voided'`, `voided_at = now()`, `voided_by = caller_id`, `void_reason`. (Trigger automatically allocates new `server_seq`, F54).
          - `supersede_entry` (F27, Finding 2, Finding 3): Admin or Owner only. Calls `rpc_supersede_entry()`. Sequence lock `pg_advisory_xact_lock(1002, 1)` acquired **before** row lock (Finding 2). Row locks original entry. **Asserts `original.status = 'active'`** (Finding 3); rejects with `cannot_supersede_non_active` if already voided or superseded. Asserts neither original nor replacement month is closed. Marks original `status = 'superseded'`. Inserts new entry using published profile valid for new entry's business date (F41). (Trigger assigns new sequence to both rows, F54).
          - `discard_rejected_entry` (F14, F35): Authenticated caller authorization check: queries `sync_ops WHERE op_id = op.payload.rejectedOpId`. Asserts `sync_ops.actor_id = caller_id` OR `caller_role in ('admin', 'owner')` (F35). Asserts prior op `result = 'rejected'`. Records discard in `sync_ops` with `result = 'ok'`, updates target rejected op `resolution_status = 'discarded'`, logs audit event `entry.discard_rejected`, and returns `{ status: 'ok' }`.
          - If a check constraint or business rule raises an exception: the subtransaction rolls back that operation's changes, maps the exception to a standardized application error code (e.g. `month_closed`, `calc_mismatch`, `rate_profile_date_mismatch`, `missing_txn_ref`, `deductions_exceed_gross`), logs `{ status: 'rejected', reason: standardized_code }` to `sync_ops` (storing full `payload jsonb` and `resolution_status = 'pending'`) and `audit_log`, and appends the rejection to results without failing unrelated operations in the batch (F48).
       g. Record operation in `sync_ops (op_id, actor_id, device_id, op_type, entry_id, payload, payload_hash, client_created_at, supersedes_rejected_op_id, result, reason, resolution_status)`. If operation succeeded and `supersedes_rejected_op_id` is present, atomically update the prior failed op in `sync_ops SET resolution_status = 'resolved'`.
       h. Append corresponding event to `audit_log`.
    5. Commit transaction and return `{ results: [{ opId, status: 'ok' | 'duplicate' | 'rejected', reason? }] }`.

- `GET /api/v1/sync/pull?since=<server_seq>&includeMeta=<true|false>&deviceId=<device_id>`:
  - Device Watermark & Presence Tracking (H3, M4):
    If `deviceId` query parameter is provided, server calls RPC `upsert_device_sync_state(deviceId, caller_id, max_delivered_rate_version)` to update `devices.last_seen_at` and `devices.last_rate_version` with the highest published rate profile version included in the response.
  - Role-Dependent Visibility & Watermark Cursor Guarantee (F16, F31):
    - Caller identity and role derived from verified JWT.
    - Watermark and scan metadata are calculated independently from filtered entries (F31) so `nextCursor` advances reliably even when a batch contains zero records visible to Staff:
      ```sql
      with scanned as (
        select * from entries
        where server_seq > $since
        order by server_seq asc limit 200
      ),
      batch_meta as (
        select coalesce(max(server_seq), $since) as watermark,
               count(*) as scanned_count
        from scanned
      )
      select s.*, m.watermark, m.scanned_count
      from batch_meta m
      left join scanned s on ($caller_role in ('admin','owner') or s.created_by = $caller_id);
      ```
    - The server extracts:
      - `nextCursor`: `watermark` string (always advances to the highest scanned sequence, even if 0 visible entries returned).
      - `hasMore`: `scanned_count === 200`.
      - `entries`: array of visible `s.*` rows (excluding nulls from outer join).
  - **DTO Response Schema**:
    `{ entries: SerializedEntry[], hasMore: boolean, nextCursor: string, settings?: AppSettings, rateProfiles?: RateProfileWithMethodRates[], methods?: PaymentMethod[], payables?: Payable[], profiles?: Profile[], settlements?: Settlement[], statements?: Statement[], monthCloses?: MonthClose[], rejectedOps?: RejectedSyncOp[] }`
  - **Metadata Pagination Bloat Protection & Incremental Sync Protocol (Item 2)**:
    To eliminate redundant payload bloat across 200-entry pagination pages:
    - `includeMeta` Query Parameter:
      - At the start of ANY sync cycle (whether initial sync `since === '0'` or incremental sync `since > '0'`, e.g., `since = '1042'`), the client sends `includeMeta=true` on the **first request**.
      - When `includeMeta === true` (or when `since === '0'`): the server returns all relational metadata and configuration tables (`settings`, `rateProfiles` with embedded `methodRates`, `methods`, `payables`, `profiles`, `settlements`, `statements`, `monthCloses`) alongside role-filtered `rejectedOps` and the first batch of `entries`. This guarantees that devices on incremental sync cycles always receive newly published rate profiles, month closes, settlements, and statements without metadata starvation.
      - If the response indicates `hasMore === true`, the client loops to fetch remaining entry pages using `since=<nextCursor>&includeMeta=false`. For these subsequent pagination requests (`includeMeta=false`), the server strictly returns `{ entries, hasMore, nextCursor }`, completely preventing metadata duplication and `rejectedOps` duplication across pagination batches.
  - **Role-Dependent Metadata and Rejected Ops Ingestion**:
    - **Admin and Owner**: Receive full configuration, plus `profiles` (`id, full_name, role, active`), `settlements`, `statements`, `monthCloses`, and all unresolved rejected sync operations from `sync_ops WHERE resolution_status = 'pending'`. This populates the Admin/Owner Dashboard "Needs Attention (Closed Month)" and "Long-term Offline (>90d)" review queues.
    - **Staff**: Receives `monthCloses` (so the client UI can detect and warn before creating an entry in a closed month before going offline) and their own rejected sync operations (`sync_ops WHERE actor_id = $caller_id AND resolution_status = 'pending'`).
  - Error responses:
    - `400 Bad Request`: `since` missing, non-numeric, or negative.
    - `401 Unauthorized`: missing or invalid auth token.
    - `409 Conflict`: `since` cursor exceeds server max sequence (triggers client cache reset to 0).
    - `410 Gone`: cursor pruned by retention policy (triggers client full resync; note: financial `entries` and `server_seq` are permanent and never pruned; 410 applies only if a future entry-archival window is enabled) (M2).
    - `429 Too Many Requests`: exceeded 60 requests/min; returns `Retry-After: <seconds>`.

### 9.2 State-Transition & Failure Recovery Matrices

#### 9.2.1 Database Entity State-Transition Matrix
Governs PostgreSQL tables (`entries`, `statements`, `month_closes`):

| Current Entity State | Operation / Event | Permitted Role | Resulting State | Effect on Reports & Settlements | Audit Action |
|---|---|---|---|---|---|
| `active` | `void_entry` | Admin, Owner | `voided` | Excluded from active ledger totals and settlement liabilities | `entry.void` |
| `active` | `supersede_entry` | Admin, Owner | Original: `superseded`<br>New: `active` | Original excluded; new replacement included in reports & settlements | `entry.supersede` |
| `active` | `request_void` | Staff (own), Admin, Owner | `active` (flagged) | Remains active in reports pending review | `entry.void_request` |
| `voided` or `superseded` | `request_void` | Any | *Rejected* (`422 cannot_void_non_active`) | No state change | none |
| `voided` or `superseded` | `supersede_entry` | Admin, Owner | *Rejected* (`422 cannot_supersede_non_active`) | No state change | `sync.rejected` |
| `open` (Statement) | Entry in month modified | System | `open` | Dynamically recomputes expected liability and variance | `statement.recalculate` |
| `reconciled` (Statement) | Entry in month modified | System | `open` (*Invalidated*) | Invalidates reconciled status; prompts re-reconciliation | `statement.invalidated` |
| `open` (Month) | Close month | Owner | `closed` | Permanently locks entries and freezes settlement liabilities | `month.close` |
| `closed` (Month) | Reopen month | Owner | `open` | Unlocks entries, unfreezes settlement liabilities | `month.reopen` |

#### 9.2.2 Client Outbox State & Server Sync Rejection Recovery Matrix (Finding B12)

> **Global Retry Invariant**: **Every** retry of a server-rejected operation that exists in `sync_ops` MUST allocate a **new UUID `opId`** and set `supersedesRejectedOpId` to the prior failed `opId`. Any client retry that modifies `clientCreatedAt` or `payload` while reusing the original `opId` will be permanently rejected by the server with `op_id_conflict_tampered`. When an operation with `supersedes_rejected_op_id` succeeds, the server marks `resolution_status = 'resolved'` on the prior failed op (enforced by partial unique index `uq_sync_ops_superseded`).

Governs Dexie client `outbox` records across all server rejection reasons:

| Rejection Reason | Trigger Condition | Client Outbox State | UI Manifestation | Mandatory Recovery Path |
|---|---|---|---|---|
| `month_closed` | Device offline while historical month closed by Owner | `rejected_closed_month` | Amber card in "Needs Attention (Closed Month)" queue | 3-way resolution: (1) Reassign date to open month, (2) Reopen month by Owner and push with fresh `opId` (`supersedes_rejected_op_id`), or (3) Discard with audited reason. |
| `rate_profile_date_mismatch` | Client entry used a rate profile not effective for `entry_date` at creation time (cherry-picked profile or `effective_from > entry_date`). Note: Legitimate offline stale rates are accepted with `stale_rates = true`. | `error_rate_profile` | Badge: "Rate Profile Date Mismatch" | Entry moves to User/Admin review queue. Does NOT auto-recompute silently (which could fail on `vat_mode` change or alter historical intent). User/Admin confirms applicable rate profile, re-verifies VAT inputs, assigns a fresh `opId`, sets `supersedesRejectedOpId`, and retries sync. |
| `future_timestamp_skew` | Client device clock skew > 5 min ahead of server time | `error_clock_skew` | Warning: "Device clock inaccurate" | Client computes clock delta from server HTTP response `Date` header, adjusts local `clientCreatedAt` timestamp, assigns a fresh `opId`, sets `supersedesRejectedOpId`, and auto-retries push. |
| `queue_expired_needs_review` | Client offline > 90 days before syncing | `needs_admin_review` | Red banner on Admin Dashboard: "Long-term Offline Batch (>90d)" | Admin reviews raw entries and taps "Approve Backdated Sync" (enqueues new ops with fresh `opId`, `supersedesRejectedOpId`, verified admin actor) or "Reject Batch". |
| `payload_hash_mismatch` | Bit-flip or proxy payload mutation detected by server | `error_hash_mismatch` | Warning: "Sync transport integrity failure" | Client re-canonicalizes payload, regenerates `payloadHash`, allocates a fresh `opId`, sets `supersedesRejectedOpId`, and re-pushes. |
| `op_id_conflict_tampered` | Reused `opId` with differing semantic payload | `error_id_conflict` | Error: "Operation ID collision" | Client generates a fresh UUID `opId`, retains operation in outbox, and retries. |
| `calc_mismatch` | Client calculation output differs from server recomputation | `error_calc_mismatch` | Alert: "Calculation discrepancy" | Client updates local rate cache, re-runs `packages/calc` engine; if difference persists, displays side-by-side breakdown for user confirmation before re-submitting with a fresh `opId` and `supersedesRejectedOpId`. |
| `invalid_snapshot_rules` | Submitted snapshot values do not match historical database profile | `error_invalid_snapshot` | Alert: "Rate snapshot rejected" | Client refreshes `rateProfiles` table via pull sync, re-snapshots against authoritative profile, assigns a fresh `opId`, sets `supersedesRejectedOpId`, and retries. |
| `missing_txn_ref` | Payment method requires transaction reference, but none was provided | `error_missing_ref` | Alert: "Transaction reference required" | User inputs missing reference, client normalizes `upper(trim(txn_ref))`, assigns a fresh `opId`, sets `supersedesRejectedOpId`, and retries. |
| `user_deactivated` | User account marked inactive (`active = false`) while device offline | `error_deactivated` | Modal: "Account deactivated" | Local save remains preserved in Dexie; outbox execution pauses; requires active Admin to log in on the device to export or reconcile local records. |
| `parent_entry_not_found` | Dependent void or supersede operation references an original entry UUID that does not exist in `entries` | `failed_needs_review` | Alert: "Referenced entry not found" | Entry moves to Admin review queue. If original entry creation failed sync, retry original creation first; otherwise discard dependent op with audited reason (M1). |
| `upgrade_required` | Client snapshot `engineVersion` incompatible with server calculation engine (HTTP 426) | `blocked_upgrade_required` | Modal: "Application update required" | Client reloads application / updates service worker bundle to obtain latest calculation engine; pending entries recompute snapshots and retry sync with fresh `opId` (H2, M1). |
| `expected_poisha_mismatch` | Statement expected liability recomputation does not match sum of active entries for covered payables | `error_reconcile_mismatch` | Toast: "Expected liability mismatch" | Refresh statement view to load updated active ledger totals before retrying reconciliation (M1). |
| `variance_exceeds_tolerance` | Statement net variance exceeds `reconcile_tolerance_poisha` and explanatory note is missing | `error_variance_tolerance` | Alert: "Variance exceeds tolerance" | Provide a non-empty explanatory note before re-submitting reconciliation (M1). |
| `device_revoked` | Device has been marked revoked (`revoked = true`) via administrative killswitch | `blocked_device_revoked` | Modal: "Device access revoked" | Local data remains read-only in Dexie; outbox execution halted; user must contact Administrator to restore access or re-provision device (H3, M4). |

UI: always-visible sync indicator in the header with states:
- `Synced` (green dot)
- `Syncing...` (animated spinner)
- `Offline (n pending)` (amber dot with count)
- `Error (tap to retry)` (red warning badge)
Never lose data on browser kill, device restart, or connection drop.

PWA now (`@vite-pwa/sveltekit`, precache app shell). Capacitor later wraps the same SPA build.

### 9.3 Offline Supabase JWT Expiration Handling & SvelteKit Auth Guard

In an offline-first PWA, users authenticate once while online and subsequently use the app in low-connectivity retail environments. Supabase access tokens expire after 1 hour (3600s); when the user opens the PWA offline after 1 hour, standard token refresh requests will fail with network errors.

To prevent premature sign-outs and offline lockouts:
1. **Local Session & Profile Caching**: Upon successful online authentication, the user's verified session tokens, user ID, role, and profile are cached locally in Dexie (`profiles` and `meta` tables) and secure persistent storage.
2. **SvelteKit Auth Guard Offline Behavior**: In `hooks.client.ts` and page navigation guards:
   - When the browser is offline (`!navigator.onLine`) or when Supabase token refresh fails due to a network connection error (e.g. `TypeError: Failed to fetch`), the auth guard MUST NOT clear local credentials or redirect to `/login`.
   - Instead, the guard validates against the cached local profile in Dexie, permitting full access to offline features (entering new transactions, viewing the offline ledger, searching cached entries, and offline dashboard metrics).
3. **Strict Sign-Out Criteria**: The client application triggers an automatic sign-out and redirect to `/login` **only** when the server explicitly returns an HTTP `401 Unauthorized` (indicating revoked session or invalid cryptographic signature) or `403 user_deactivated` while the device is actively online. Network timeouts, DNS failures, and offline token refresh failures MUST be suppressed.


## 10. Reports SQL (reference)

```sql
-- monthly totals (active entries only), month = first day of month (Finding 1: security_invoker = true)
create or replace view v_monthly_totals
with (security_invoker = true) as
select
  date_trunc('month', entry_date)::date as month,
  count(*) as entries,
  sum(sub_qty) as total_sub_qty,
  sum(gross_poisha) as gross,
  sum(vat_poisha) as vat,
  sum(commission_poisha) as commission,
  sum(charge_poisha) as total_charge,
  sum(business_charge_poisha) as business_charge,
  sum(customer_charge_poisha) as customer_charge,
  sum(net_poisha) as net
from entries
where status = 'active'
group by 1;

-- charges per method (business liability vs customer fee) (Finding 1: security_invoker = true)
create or replace view v_monthly_method_charges
with (security_invoker = true) as
select
  date_trunc('month', entry_date)::date as month,
  m.code,
  sum(e.business_charge_poisha) as business_charge,
  sum(e.customer_charge_poisha) as customer_charge,
  sum(e.charge_poisha) as total_charge,
  count(*) as entries
from entries e join payment_methods m on m.id = e.method_id
where e.status = 'active'
group by 1, 2;

-- staff personal dashboard metrics (F40, F51, Finding 1: security_invoker = true, strictly scoped to caller's own entries and Asia/Dhaka timezone)
create or replace view v_staff_personal_metrics
with (security_invoker = true) as
select
  count(*) filter (where entry_date = (now() at time zone 'Asia/Dhaka')::date) as entries_today,
  coalesce(sum(gross_poisha) filter (where entry_date = (now() at time zone 'Asia/Dhaka')::date), 0) as gross_today,
  count(*) filter (where date_trunc('month', entry_date) = date_trunc('month', (now() at time zone 'Asia/Dhaka')::date)) as entries_this_month,
  coalesce(sum(gross_poisha) filter (where date_trunc('month', entry_date) = date_trunc('month', (now() at time zone 'Asia/Dhaka')::date)), 0) as gross_this_month
from entries
where status = 'active' and created_by = auth.uid();

-- Explicit View Security and Permissions (Finding 1):
-- Views run with security_invoker = true so underlying table RLS applies directly to the caller's JWT/session context.
-- Revoke all permissions on managerial views from PUBLIC, anon, and authenticated:
revoke all on v_monthly_totals, v_monthly_method_charges from public, anon, authenticated;
-- Grant managerial view access exclusively to service_role (and Admin/Owner via server-side queries):
grant select on v_monthly_totals, v_monthly_method_charges to service_role;

-- Staff dashboard view grants:
revoke all on v_staff_personal_metrics from public, anon;
grant select on v_staff_personal_metrics to authenticated, service_role;
```

Security and Access Semantics (F40, Finding 1):
- `v_monthly_totals` and `v_monthly_method_charges`: Restricted exclusively to `admin` and `owner` (via server-side endpoints executing under `service_role` after verifying user role). Direct select by Staff or unauthenticated callers via PostgREST is rejected at the database level (`403 Permission Denied`).
- `v_staff_personal_metrics`: Accessible to `authenticated` users (`staff`, `admin`, `owner`). Because it runs with `security_invoker = true`, PostgreSQL enforces `entries` RLS, and the explicit `created_by = auth.uid()` filter guarantees callers receive only their own personal metrics.
- Client computes matching local metrics from Dexie for offline dashboards and reports. Both paths must produce identical numbers (tested in CI with actual Staff, Admin, and Owner credentials).

## 11. Reconciliation

Scope: bKash merchant statement, card settlement report, VAT challan. Formats are OPEN (Q14), so build the framework and manual path first.

### 11.1 Statement Semantics & Expected Liability Definitions (Finding A2)
`statements.statement_total_poisha` represents the external third-party balance against which internal records are compared:
- **For VAT (`kind = 'vat'`)**: `statement_total_poisha` is the total VAT deposited to the government treasury as printed on the bank/treasury VAT challan. `expected_poisha = sum(vat_poisha)` across active ledger entries for that month.
- **For Payment Method Fees (`kind = 'method_charge'`)**: `statement_total_poisha` is the total transaction fees debited by the payment gateway or acquiring bank according to the official monthly merchant statement. `expected_poisha = sum(business_charge_poisha)` across active entries for that method in that month.
  - *Customer-Borne Charges*: When `charges_borne_by = 'customer'`, the provider charges the customer directly or fees are settled at point-of-sale without merchant liability (`business_charge_poisha = 0`). Expected business liability is 0 poisha. If a provider debits merchant fees on a merchant account statement, `charges_borne_by` for that contract must be set to `'business'`.
- `variance_poisha = statement_total_poisha - expected_poisha` (automatically maintained by stored generated column in `statements`).

### 11.2 Manual Totals-Only Reconciliation Mode (`source = 'manual_total'`) (Finding A1 — Ships First in M2)
When the operator has a summary statement or challan and enters only the monthly total:
- Per payable (or combined card group) and month, the user enters `statement_total_poisha`.
- The system automatically evaluates `expected_poisha` and `variance_poisha`.
- **Completion Criteria for Totals-Only Mode (Finding A1)**:
  - Statement lines do not exist (`count(statement_lines) = 0`).
  - Line-level matching assertions and entry-level exception review requirements (`entry_reconciliation_exceptions`) are explicitly waived.
  - Reconciliation succeeds if `abs(variance_poisha) <= app_settings.reconcile_tolerance_poisha` (default 100 poisha / ৳1.00) OR if an explanatory `note` is provided.
  - Invoking `reconcile_statement(statement_id, note, actor_id)` atomically transitions `statements.status = 'reconciled'` and all covered `statement_payables.status = 'reconciled'`.

### 11.3 File-Based Line-Item Reconciliation Mode (`source = 'file'`) (Ships in M4)
After provider statement samples arrive, file-based line-item reconciliation is enabled:

```ts
interface StatementAdapter {
  id: string;                      // e.g. 'bkash-merchant-csv'
  accepts(file: File): boolean;
  parse(file: File): Promise<StatementLine[]>;
}
interface StatementLine {
  date?: string; reference?: string;
  grossPoisha?: bigint; feePoisha?: bigint; raw: unknown;
}
```

Card Statement Handling (Combined Reports, F21, F37):
When banks provide a single combined card settlement report (Visa + Mastercard):
1. Admin uploads the statement with `kind = 'combined_card'`, which creates rows in `statement_payables` linking the statement to both the Visa and Mastercard payables for that month.
2. Unique Active Statement Coverage (F37): Enforced via unique index `uq_active_statement_coverage` on `statement_payables (payable_id, month) where status != 'superseded'`. This physically prevents overlapping single-payable and combined statements from covering the same liability.
3. App compares the statement total against the combined `sum(business_charge_poisha)` across active entries for all payables linked in `statement_payables`.
4. Line matching matches transaction references against active entries for either Visa or Mastercard.
5. Month-Close Verification (F42): The `close_month()` procedure asserts that every active payable for that month has an active `statement_payables` record with `status = 'reconciled'` or is zero-liability (`settlements.status = 'not_applicable'`). This eliminates liability ambiguity and guarantees non-overlapping reconciliation.

Matching Algorithm and Disambiguation Rules (M6, F22, F24, F69):
1. **Primary Pass (Exact Reference Equality)**: For statement lines where `reference IS NOT NULL` and entries where `txn_ref IS NOT NULL`, match if `upper(trim(line.reference)) = upper(trim(entry.txn_ref))` and entry payment method is covered by the statement.
2. **Fallback Pass (Unique Date + Gross Match)**: For statement lines lacking a reference (common in certain card fee or bKash aggregator statements), attempt fallback matching where `line.line_date = entry.entry_date AND line.gross_poisha = entry.gross_poisha`. This fallback matches ONLY when there is **exactly one** unmatched active entry in the statement month with that exact date and gross. If multiple entries share the same date and gross, auto-match skips them to prevent ambiguous matching, leaving them `unmatched` for explicit manual matching via `match_statement_line`.
3. **Matching Uniqueness (F22)**: Enforced via unique index `uq_active_statement_line_entry` on `(statement_id, matched_entry_id) where matched_entry_id is not null and is_active_match = true`. This permits a single active ledger entry to be matched in multiple statements covering distinct payables (e.g., matching Entry #1 in a bKash fee statement and also in a VAT statement), while preventing duplicate matches within the same statement. When an uploaded statement is superseded, its lines transition to `is_active_match = false`, freeing matched entries to be re-matched in the replacement statement without destroying historical audit lines.
4. **Operational Unmatch Capability (H4)**: If an entry is mistakenly matched to a line, an Admin or Owner can call `unmatch_statement_line(line_id, reason, actor_id)` while the month is open. This resets the line to `match_status = 'unmatched'`, unlinks `matched_entry_id`, and cascades any reconciled statement covering that payable back to `'open'`.
4. Line-Item Reconciliation Completion Criteria (F24, Finding 5, F65, F67, F68, F69):
   A file-based statement is strictly Reconciled only when ALL of the following conditions are met:
   - **Statement-Side Review (F69)**: Every statement line must either be `matched` to an active entry (`matched_entry_id is not null and is_active_match = true`) OR explicitly marked `accepted` with verified review evidence (`reviewed_by`, `reviewed_at`, and non-empty `review_note` enforced by database check constraint `chk_statement_line_acceptance`). Unmatched lines are accepted via `accept_statement_line(line_id, review_note, actor_id)` (Admin or Owner only).
   - **Entry-Side Review & Scoped Exceptions (F24, Finding 5, F65, F67)**: Every active ledger entry for that payable/method in the statement month that carries non-zero merchant liability—specifically where `(payables.kind = 'vat' AND entries.vat_poisha > 0) OR (payables.kind = 'method_charge' AND entries.method_id = payables.method_id AND entries.business_charge_poisha > 0)`—must either be matched to an active line in this statement (`statement_lines.matched_entry_id = entries.id AND statement_lines.is_active_match = true AND statement_lines.statement_id = p_statement_id`) OR have an approved reconciliation exception explicitly scoped to that entry, payable, and month in `entry_reconciliation_exceptions (entry_id, payable_id, month, status = 'approved')` (F67). Entries with customer-borne charges (`business_charge_poisha = 0`) and zero-VAT entries (`vat_poisha = 0` in manual mode) carry 0 merchant settlement liability and are automatically exempt from statement matching. Exceptions are reviewed via `review_entry_reconciliation_exception(entry_id, payable_id, action, reason, actor_id)` where `action in ('approved', 'rejected')` (Admin or Owner only). An exception approved for one payable (e.g. bKash charges) does NOT waive reconciliation for another liability (e.g. VAT) on the same entry. Unmatched entries with non-zero liability lacking a scope-matched approved exception block `reconcile_statement()` with `422 unmatched_entries_without_approved_exceptions`.
   - **Variance Clearance**: Total net variance is within `reconcile_tolerance_poisha` (default 100 poisha / ৳1.00) or covered by an approved reconciliation note.
   - **Owner Overpayment Approval Before Month Close (Finding 5, F50, F65, F68)**: If a settlement is in `overpaid` status (`paid_poisha > expected_poisha`), it cannot be closed until explicitly approved by the **Owner** via `approve_settlement_overpayment(settlement_id, reason, actor_id)`. This sets `settlements.overpayment_review_status = 'approved'`, binds the approval to the exact current surplus amount (`overpayment_approved_amount_poisha = paid_poisha - expected_poisha`), records `overpayment_reason`, `overpayment_approved_by`, and `overpayment_approved_at`. If subsequent entry or payment changes alter the financial balance or expected liability, the trigger automatically invalidates the approval back to `'none'` (F68). Without an active Owner approval matching the exact current surplus, `close_month()` fails with `422 unapproved_overpaid_settlement`.
   - All matching, exception approvals, overpayment reviews, line acceptances, and status transitions write immutable records to `audit_log`.

## 12. Non-functional requirements

- Local save under 100 ms. Report for a month with a few thousand entries under 1 s.
- All business dates and month boundaries in Asia/Dhaka. Store `entry_date` as a `date`.
- Currency BDT, formatted with South Asian grouping (Q12 default).
- Security: RLS on, HTTPS only, service role key only on the server, input validated with Zod on client and server, audit log on sensitive actions, daily backups with Supabase Point-in-Time Recovery (PITR, 7-day retention horizon), quarterly restore drills, and daily automated encrypted export archives of ledger snapshots stored off-Supabase (e.g., S3/GCS) (m7).
- Accessibility: WCAG AA contrast, 44px minimum touch targets, keyboard operable (including the floating menu), respects reduced motion and reduced transparency.
- i18n-ready: no hardcoded UI strings outside the message catalog.

## 13. Tech stack and repo layout

- Frontend: SvelteKit 2 with Svelte 5 (runes), TypeScript strict, SPA mode (`ssr = false`), Tailwind CSS 4 plus CSS variables for design tokens.
- Local data: Dexie.
- Backend and DB: Supabase (Postgres, Auth, RLS, Storage for receipts and statement files). Region nearest to Bangladesh (Singapore or Mumbai). Do not use SQLite: Vercel has no persistent disk and multiple devices need one shared DB.
- Hosting: Vercel (`adapter-vercel` for web, includes `+server.ts` sync routes). Native build uses `adapter-static` with `PUBLIC_API_BASE` pointing at the Vercel API (enable CORS for the app origin).
- Validation: Zod. Tests: Vitest (unit and property tests with fast-check), Playwright (e2e, including offline mode via network emulation).
- Charts: hand-rolled SVG or a light Svelte chart library. No heavy chart bundles.
- PWA: `@vite-pwa/sveltekit`. Later: Capacitor (Android first), `@capacitor/haptics`, `@capacitor/preferences`.

```
/packages/calc          pure calculation engine + tests + fixtures (section 6.6)
/packages/shared        types, zod schemas, money formatting
/apps/web
  /src/lib/db           dexie schema, outbox, sync runner
  /src/lib/ui           design system components (section 14)
  /src/routes
    /(app)
      /dashboard /entries/new /ledger /reports /settlements /reconcile /admin
    /api/v1
      /sync/push                          # POST: rpc_push_sync_op
      /sync/pull                          # GET: entries & metadata pull (?since=N&includeMeta=true|false&deviceId=id)
      /admin/methods                      # POST: admin_manage_payment_method
      /admin/payables                     # POST: admin_manage_payable
      /admin/rates/draft                  # POST: create_or_update_draft_rate_profile
      /admin/rates/publish                # POST: publish_rate_profile
      /admin/settings                     # POST: admin_update_settings
      /admin/users                        # POST: admin_manage_user
      /admin/devices                      # POST: admin_manage_device
      /admin/transfer-ownership           # POST: transfer_ownership
      /settlements/payments               # POST: record_settlement_payment
      /settlements/overpayment-approval   # POST: approve_settlement_overpayment
      /reconcile/statements               # POST: create_statement
      /reconcile/statements/supersede     # POST: supersede_statement
      /reconcile/statements/reconcile     # POST: reconcile_statement
      /reconcile/match-line               # POST: match_statement_line
      /reconcile/unmatch-line             # POST: unmatch_statement_line (H4)
      /reconcile/accept-line              # POST: accept_statement_line
      /reconcile/exceptions               # POST: review_entry_reconciliation_exception
      /months/close                       # POST: close_month
      /months/reopen                      # POST: reopen_month
/supabase/migrations    SQL from section 7 + RLS + triggers
/DECISIONS.md           log of any choice an agent made where the spec was silent
```

> **Server-Route Mediation Architecture (Item 4)**: Because direct writes (`INSERT`, `UPDATE`, `DELETE`) on all 18 public tables and routine `EXECUTE` privileges are revoked from `anon` and `authenticated` roles in PostgreSQL (§7.1), the SPA frontend cannot perform mutations via PostgREST or `supabase.rpc()` directly. Every mutation endpoint in `/api/v1/*` runs as a SvelteKit `+server.ts` endpoint that:
> 1. Authenticates caller identity and role from verified Supabase Auth JWT (`auth.uid()`).
> 2. Validates request body schemas using Zod.
> 3. Executes the corresponding privileged database function under Supabase `service_role`.
> 4. Appends audit log records and returns standardized JSON responses.

## 14. Design system

Concept: calm financial clarity. Large readable numbers, generous space, one confident accent. Not indigo.

### 14.1 Tokens (Contrast-Verified WCAG AA >= 4.5:1) (Findings C1, C2)

All light-mode color tokens below are measured and verified against `#F6F5F1` (pearl background) and `#FFFFFF` (white surface/glass):

```css
:root {
  --bg: #F6F5F1;            /* pearl base */
  --pearl-a: #FFFFFF;
  --pearl-b: #F1EEF6;       /* faint lilac */
  --pearl-c: #F7EEEA;       /* faint blush */
  --surface: #FFFFFF;
  --ink: #14161A;
  --muted: #5C6068;         /* 5.78:1 against #F6F5F1 (m1: measured) */
  --accent: #0B6B59;        /* dark jade - 5.90:1 against #F6F5F1, 6.44:1 against #FFFFFF (m1: measured) */
  --accent-2: #08556B;      /* deep teal, gradient end */
  --c-commission: #0B6B59;  /* 5.90:1 */
  --c-vat: #8C4F00;         /* deep amber-ochre - 5.95:1 against #F6F5F1 (m1: measured) */
  --c-vat-bg: #FFE8C2;      /* soft tinted pill background */
  --c-bkash: #B80053;       /* deep magenta - 6.09:1 against #F6F5F1 (m1: measured) */
  --c-bkash-bg: #FFD8EA;
  --c-visa: #1A54B8;        /* deep royal blue - 6.41:1 against #F6F5F1 (m1: measured) */
  --c-visa-bg: #DCE8FF;
  --c-mastercard: #9E3600;  /* deep rust orange - 6.46:1 against #F6F5F1 (m1: measured) */
  --c-mastercard-bg: #FFDBC8;
  --radius: 18px;
}
[data-theme="dark"] {
  --bg: #0E1116; --surface: #161A21; --ink: #EDEEF0; --muted: #9AA0A8;
  --pearl-a: #14181F; --pearl-b: #181C26; --pearl-c: #1B1A22;
  --accent: #14B89A;        /* 7.52:1 against dark bg (m1: measured) */
  --accent-2: #2BB3D6;
  --c-commission: #14B89A;
  --c-vat: #F5B041;         /* 10.06:1 against dark bg (m1: measured) */
  --c-vat-bg: #3D2B05;
  --c-bkash: #F75990;       /* 6.11:1 against dark bg (m1: measured) */
  --c-bkash-bg: #420A21;
  --c-visa: #64A0FF;        /* 7.22:1 against dark bg (m1: measured) */
  --c-visa-bg: #0E254A;
  --c-mastercard: #FF8C42;  /* 8.18:1 against dark bg (m1: measured) */
  --c-mastercard-bg: #421B05;
}
```

Fonts: Geist (UI), Geist Mono or a tabular-figure face for amounts, Noto Sans Bengali as fallback. Use `font-variant-numeric: tabular-nums` on all amounts. Self-host fonts (offline).

### 14.2 Grainy pearl-white background

Applied once on the app root. Gradient plus a fine noise layer generated in code (no network image, works offline).

```css
.app-bg {
  background:
    radial-gradient(1200px 600px at 10% -10%, var(--pearl-b), transparent 60%),
    radial-gradient(900px 500px at 100% 10%, var(--pearl-c), transparent 55%),
    linear-gradient(180deg, var(--pearl-a), var(--bg));
  min-height: 100dvh;
}
.app-bg::before {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
  opacity: .06; mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}
[data-theme="dark"] .app-bg::before { opacity: .09; mix-blend-mode: screen; }
```

Static layer only. Do not animate the grain. Soft color glows (blurred gradient blobs) sit behind the menu and key buttons so the glass has something to blur.

### 14.3 Glass surfaces (menu, sheets, buttons)

```css
.glass {
  background: color-mix(in oklab, white 55%, transparent);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  border: 1px solid rgb(255 255 255 / .6);
  box-shadow: 0 1px 0 rgb(255 255 255 / .8) inset, 0 8px 24px rgb(20 22 26 / .10), 0 2px 6px rgb(20 22 26 / .06);
}
[data-theme="dark"] .glass {
  background: color-mix(in oklab, white 8%, transparent);
  border-color: rgb(255 255 255 / .12);
}
@media (prefers-reduced-transparency: reduce) { .glass { background: var(--surface); backdrop-filter: none; } }
@supports not (backdrop-filter: blur(1px)) { .glass { background: var(--surface); } }
```

Limit `backdrop-filter` to the menu, buttons, and sheets. Never apply it to long lists (performance on low-end Android).

### 14.4 Frosted glass buttons with colorful engraved text & solid fallback (Findings C1, C2)

- Button = `.glass` + radius 14px, press state sinks 1px and reduces shadow.
- Label = engraved gradient text with solid high-contrast fallback:

```css
.btn-label {
  color: var(--c1, var(--ink)); /* solid fallback for high-contrast and Android WebView */
  background: linear-gradient(135deg, var(--c1, var(--accent)), var(--c2, var(--accent-2)));
  -webkit-background-clip: text; background-clip: text;
  filter: drop-shadow(0 1px 0 rgb(255 255 255 / .75)) drop-shadow(0 -1px 0 rgb(0 0 0 / .12));
  font-weight: 650; letter-spacing: .01em;
}
@supports (-webkit-background-clip: text) or (background-clip: text) {
  .btn-label { color: transparent; }
}
.btn--commission { --c1: #0B6B59; --c2: #08556B; }
.btn--vat        { --c1: #8C4F00; --c2: #6E3D00; }
.btn--bkash      { --c1: #B80053; --c2: #8C003E; }
.btn--visa       { --c1: #1A54B8; --c2: #103A82; }
.btn--mastercard { --c1: #9E3600; --c2: #7A2A00; }

[data-theme="dark"] .btn-label {
  filter: drop-shadow(0 1px 0 rgb(0 0 0 / .6)) drop-shadow(0 -1px 0 rgb(255 255 255 / .15));
}
[data-theme="dark"] .btn--commission { --c1: #14B89A; --c2: #0D947B; }
[data-theme="dark"] .btn--vat        { --c1: #F5B041; --c2: #D99525; }
[data-theme="dark"] .btn--bkash      { --c1: #F75990; --c2: #D43870; }
[data-theme="dark"] .btn--visa       { --c1: #64A0FF; --c2: #3E7BE0; }
[data-theme="dark"] .btn--mastercard { --c1: #FF8C42; --c2: #E06B22; }
```

Contrast: All button label colors achieve $\ge 4.5:1$ contrast against the frosted glass background in both light and dark themes.

### 14.5 Floating draggable menu (mobile) & Safe Zones (Finding C3)

- A glass pill floating above content. Contains: New entry (primary), Dashboard, Ledger, Reports, Settings. Collapsed state shows the primary action plus a handle.
- Drag with Pointer Events (Svelte action). On release it snaps to the nearest screen edge or corner, with spring easing. Position persists per device (`Preferences`/storage).
- **Default Docked Position & Safe Zones (Finding C3)**: Default position is docked at `bottom: 24px; right: 24px`. To prevent covering primary actions (Save button `#btn-save`, Submit button `#btn-submit`), the floating menu enforces an exclusion safe-zone: if dragged over the primary action area, it automatically dodges to the opposing margin or docks cleanly into a bottom sheet bar on screens $< 640px$.
- Tap expands to the full menu. Double-tap resets position.
- Respect safe-area insets and keyboard height.
- Haptic tick on snap in Capacitor (`@capacitor/haptics`).
- Accessibility: focusable, arrow keys move it, Enter expands. Setting "Menu position: free, bottom, left, right" pins it for one-handed or assistive use.
- Desktop: slim glass sidebar, plus command palette on Ctrl/Cmd+K.

### 14.6 Layout, Motion & High-Contrast Support (Finding C4)

- Bento-grid dashboard, radius 18-20px, generous spacing.
- Hero on the entry screen: a receipt-style breakdown card whose lines animate as the amount changes.
- Count-up on report totals, skeleton loaders, View Transitions between screens, spring easing. Disable all of it under `prefers-reduced-motion`.
- Mobile: floating menu (14.5). Desktop: sidebar, wide tables.
- Category colors (14.1) are used consistently across chips, charts, report cards, and button labels. Chips use high-contrast text on soft tinted backgrounds (`--c-vat-bg`, `--c-bkash-bg`, etc.) rather than carrying meaning solely through color.
- **High-Contrast Media Query Support (`prefers-contrast: more`) (Finding C4)**:
  ```css
  @media (prefers-contrast: more) {
    .glass { background: var(--surface); backdrop-filter: none; border: 2px solid var(--ink); }
    .btn-label { color: var(--c1); background: none; -webkit-background-clip: unset; filter: none; }
    .app-bg::before { display: none; }
  }
  ```

## 15. Security and audit

- Roles from `profiles.role`, checked in RLS and again in server routes.
- Only the server holds the service role key. The client only has the anon key and the user JWT.
- Receipts and statement files go to a private storage bucket with signed URLs.

### 15.1 Audit Coverage Matrix (Finding B13)

Every financial, settings, or role state mutation MUST write an append-only row to `audit_log` within the mutating database transaction:

| Event Action | Permitted Role | Target Table | Target ID | Logged Data (`before` / `after`) |
|---|---|---|---|---|
| `entry.create` | Staff, Admin, Owner | `entries` | entry UUID | `before: null`, `after: { gross, net, snapshot, inputs }` |
| `entry.void_request` | Staff, Admin, Owner | `entries` | entry UUID | `before: { void_requested_at: null }`, `after: { void_requested_by, void_request_reason }` |
| `entry.void` | Admin, Owner | `entries` | entry UUID | `before: { status: 'active' }`, `after: { status: 'voided', void_reason }` |
| `entry.supersede` | Admin, Owner | `entries` | original UUID | `before: { status: 'active' }`, `after: { status: 'superseded', superseding_id }` |
| `entry.reconciliation_exception` | Admin, Owner | `entry_reconciliation_exceptions` | exception UUID | `before: null` or `{ status }`, `after: { entry_id, payable_id, month, status: 'approved' | 'rejected', reason, reviewed_by }` |
| `entry.discard_rejected`| Staff (own), Admin, Owner | `sync_ops` | op UUID | `before: { result: 'rejected' }`, `after: { result: 'ok', discard_reason }` |
| `rate_profile.create` | Admin, Owner | `rate_profiles` | profile UUID | `before: null`, `after: { status: 'draft', effective_from, rates }` |
| `rate_profile.publish` | Admin, Owner | `rate_profiles` | profile UUID | `before: { status: 'draft' }`, `after: { status: 'published', version }` |
| `payment_method.create` | Admin, Owner | `payment_methods` | method UUID | `before: null`, `after: { code, name, requires_txn_ref, active }` |
| `payment_method.update` | Admin, Owner | `payment_methods` | method UUID | `before: { name, active }`, `after: { name, active }` |
| `payable.create` | Admin, Owner | `payables` | payable UUID | `before: null`, `after: { code, kind, method_id, due_day }` |
| `payable.update` | Admin, Owner | `payables` | payable UUID | `before: { due_day, active }`, `after: { due_day, active }` |
| `app_settings.update` | Admin, Owner | `app_settings` | `true` | `before: { tolerance, net_label }`, `after: { tolerance, net_label }` |
| `settlement.payment` | Admin, Owner | `settlement_payments` | payment UUID | `before: null`, `after: { amount, paid_on, reference, is_reversal, reverses_payment_id }` |
| `settlement.overpayment_approved` | Owner | `settlements` | settlement UUID | `before: { overpayment_review_status: 'none' }`, `after: { overpayment_review_status: 'approved', approved_amount_poisha, reason, approved_by }` |
| `settlement.overpayment_invalidated` | System Trigger | `settlements` | settlement UUID | `before: { overpayment_review_status: 'approved', approved_amount_poisha }`, `after: { overpayment_review_status: 'none', current_surplus, reason: 'balance_changed' }` |
| `statement.create` | Admin, Owner | `statements` | statement UUID | `before: null`, `after: { kind, month, source, statement_total_poisha, covered_payables }` |
| `statement.reconcile`| Admin, Owner | `statements` | statement UUID| `before: { status: 'open' }`, `after: { status: 'reconciled', variance, note, covered_payables }` |
| `statement.supersede`| Admin, Owner | `statements` | statement UUID| `before: { status: 'reconciled' }`, `after: { status: 'superseded', superseded_by }` |
| `statement.invalidate`| System Trigger | `statements` | statement UUID| `before: { status: 'reconciled' }`, `after: { status: 'open', reason }` |
| `rate_profile.update` | Admin, Owner | `rate_profiles` | profile UUID | `before: { draft_rates }`, `after: { updated_draft_rates }` |
| `statement.match_line` | Admin, Owner | `statement_lines` | line UUID | `before: { match_status: 'unmatched' }`, `after: { match_status: 'matched', matched_entry_id }` |
| `statement.unmatch_line` | Admin, Owner | `statement_lines` | line UUID | `before: { match_status: 'matched', matched_entry_id }`, `after: { match_status: 'unmatched', matched_entry_id: null }` |
| `statement_line.accept` | Admin, Owner | `statement_lines` | line UUID | `before: { match_status: 'unmatched' }`, `after: { match_status: 'accepted', review_note, reviewed_by }` |
| `device.revoke` | Admin, Owner | `devices` | device ID | `before: { revoked: false }`, `after: { revoked: true, reason: 'admin_killswitch' }` |
| `device.unrevoke` | Admin, Owner | `devices` | device ID | `before: { revoked: true }`, `after: { revoked: false }` |
| `sync.upgrade_required` | System | `sync_ops` | op UUID | `before: null`, `after: { engine_version: client_version, server_version: 1 }` |
| `month.close` | Owner | `month_closes` | YYYY-MM-01 | `before: { status: 'open' }` or `null`, `after: { status: 'closed', closed_at }` |
| `month.reopen` | Owner | `month_closes` | YYYY-MM-01 | `before: { status: 'closed' }`, `after: { status: 'open', reopen_reason }` |
| `user.role_change` | Owner | `profiles` | profile UUID | `before: { role, active }`, `after: { role, active }` |
| `user.deactivate` | Owner | `profiles` | profile UUID | `before: { active: true }`, `after: { active: false }` |
| `user.ownership_transfer`| Owner | `profiles` | new owner UUID| `before: { owner: caller_id }`, `after: { owner: new_owner_id }` |

## 16. Test plan

### 16.1 Calculation and Invariant Tests
1. Calc unit tests: all 10 fixtures in 6.6 plus totals, rounding traps, guard errors. All 3 `percent_inclusive` fixtures in 6.7.
2. Property tests: sum identity, non-negative, idempotence, charge partitioning (`businessCharge + customerCharge === charge`), input-mode mutual exclusivity (F20).

### 16.2 Mandatory Critical Regression Tests (Must pass before production)
1. **Forged Snapshot Rejection**: Client submits a modified snapshot with a lowered rate. Server independently checks DB records and rejects with `403 invalid_snapshot_rules` (F1).
2. **Commit-Order Sequence Race Immunity**: Two concurrent transactions allocate sequence numbers out of order. Verify that `pg_advisory_xact_lock` serializes commit order so pull cursor never skips an uncommitted or late-committing row (F3, F54).
3. **Rejected-Op Recovery Cycle with Fresh OpId**: An offline entry is rejected with `month_closed`. When reopening the month, the retry sends a **fresh `opId`** with `supersedes_rejected_op_id` pointing to the original rejection. Verify that the server accepts the new op, assigns an entry number, and preserves the original rejection in `sync_ops`. Replaying the original `opId` returns the cached rejection (F4, F14, F23, F45).
4. **JSON 64-Bit Wire Precision**: Very large monetary values (> $2^{53}-1$) serialize as decimal strings and survive client-server round-trips without precision loss (F5).
5. **Customer-Paid Fees Isolation**: Run test fixture with `chargesBorneBy = 'customer'`. Verify customer fee does not reduce business net in reports and is excluded from business settlement liabilities (F6).
6. **Settlement Dynamic Recalculation**: Modifying or voiding an entry in an open month dynamically updates `settlements.expected_poisha` and automatically invalidates any existing reconciled statement back to `'open'` (F8).
7. **Repeated Month Close/Reopen Lifecycle**: Executing multiple close and reopen cycles preserves unambiguous current state (`month_closes.status = 'closed'` or `'open'`) and records complete event history in `month_close_events` (F9).
8. **Concurrent Supersedes Serialization**: Two simultaneous supersede requests targeting the same original entry serialize via row locks (`SELECT FOR UPDATE`); exactly one succeeds and the second is rejected (F12, F27).
9. **30-Day Offline Retention Recovery**: Device offline for 30 days reconnects and pushes outbox. During the offline period, a new rate profile was published on the server. Because the client's operations record `maxKnownRateVersion` matching its offline state, the server recognizes legitimate offline operation rather than backdated cherry-picking, successfully processes all entries idempotently within the 90-day retention window, flags the new entries with `stale_rates = true`, and raises an alert on the Admin Dashboard without duplicate inserts or false date-mismatch rejections (F30, F39, Item 3).
10. **Account Deactivation Enforcement**: User deactivated while offline reconnects and attempts sync. Server rejects with `403 user_deactivated` and preserves pending local data for admin review.
11. **Server Payload Hash Verification (F13, F33, F49, Finding 8)**: Server computes SHA-256 independently over `{type, payload, supersedesRejectedOpId, clientCreatedAt, maxKnownRateVersion}`. Client-supplied hash mismatches return per-operation `{ opId, status: 'rejected', reason: 'payload_hash_mismatch' }`. Reusing an `opId` with altered type or payload returns per-operation `{ opId, status: 'rejected', reason: 'op_id_conflict_tampered' }`.
12. **Staff Cursor Monotonic Watermark (F16, F31)**: In a database with interleaved entries from multiple staff, a Staff user pulls changes. Verify that `nextCursor` equals the highest `server_seq` scanned and monotonically advances past inaccessible entries even when 0 matching rows are returned.
13. **Settlement Payment Reversal Net Reduction (F17, F36, F50)**: Record a payment of ৳5,000, then record a reversal of ৳2,000. Verify that `settlements.paid_poisha` equals ৳3,000 (not ৳7,000). Verify that reversals targeting an invalid or already-reversed payment are rejected under row-level locking.
14. **Rate Profile Draft-Publish Immutability (F18, F41, F53)**: Once a profile is published via `publish_rate_profile`, verify that attempts to insert new `method_rates` rows or update/delete `rate_profiles` are blocked by database triggers. Verify publishing backdated profiles (`effective_from < current_date`) is rejected.
15. **Atomic Ownership Transfer (F15)**: Call `transfer_ownership(new_owner_id)`. Verify previous owner becomes admin, new owner becomes owner, and the deferrable 1-owner invariant trigger passes at transaction commit.
16. **Multi-Payable Combined Card Reconciliation (F21, F22, F37, F55)**: Upload combined statement covering Visa and Mastercard. Match entries from both methods. Verify both payables satisfy month-close gating. Supersede statement and verify that previously matched entries can be matched in the replacement statement.
17. **Month Close, Reconciliation, and Entry Sync Multi-Month Race Immunity (F32, F46, F56, Finding 2)**: Simulate concurrent execution of `rpc_push_sync_op` (with a batch touching multiple months in reverse order), `reconcile_statement`, and `close_month`. Verify that ascending month advisory lock acquisition (`pg_advisory_xact_lock(1001, year*12 + month)`) prevents deadlocks and ensures atomic isolation.
18. **Discard Authorization and Provenance (F14, F35)**: A Staff user calls `discard_rejected_entry` on their own rejected operation. Verify authorization passes. Verify an attempt by another Staff user to discard it is rejected with `403 unauthorized`.
19. **Non-Overlapping Statement Coverage (F37, F55)**: Attempt to insert a statement for Visa while an active combined card statement covering Visa already exists for the same month. Verify rejection by `uq_active_statement_coverage`.
20. **Zero-Liability Settlement Status (F38, F50)**: For a month with zero Mastercard entries, verify `settlements.status` is `'not_applicable'` and satisfies `close_month()` gating without requiring payments.
21. **Payment Method Code Immutability (F43)**: Attempt to update `payment_methods.code`. Verify trigger `trg_payment_methods_immutable_code` raises an exception.
22. **Privileged Function Search Path & Grants (F34, F52, Finding 1)**: Verify all SECURITY DEFINER RPCs have explicit `search_path = public, pg_temp` and execute only under service role. Verify routine execution is explicitly revoked from `PUBLIC`, `anon`, and `authenticated`, and default privileges are set correctly.
23. **Parent-Child Statement Invalidation Cascade (F47)**: Modify an entry in an open month after a statement was marked `reconciled`. Verify that both parent `statements.status` and child `statement_payables.status` rows are reset to `'open'`, and verify `close_month()` is blocked until re-reconciliation occurs.
24. **Batch Subtransaction Fault Isolation (F48)**: Submit a batch of 3 operations where op #2 violates a check constraint. Verify that op #1 and op #3 commit successfully and return `status = 'ok'`, while op #2 returns `status = 'rejected'` with failure recorded in `sync_ops`.
25. **Untrusted Timestamp Validation & Queue Expiry (F49, Finding 7)**: Submit an op with clock skew (> 5 min future) $\to$ rejected. Submit an op older than 90 days $\to$ rejected with `queue_expired_needs_review` and routed to the admin review queue.
26. **Authoritative 5-State Settlement Lifecycle (F50, Finding 5)**: Verify transitions across `not_applicable`, `due`, `partly_paid`, `paid`, `overpaid` using `calc_settlement_status()`. Verify overpaid status requires an approved review note via `approve_settlement_overpayment()` before month close can succeed.
27. **Asia/Dhaka Midnight and Boundary Verification (F51)**: Test `v_staff_personal_metrics` around midnight and month-end in Asia/Dhaka across different database session timezones.
28. **Payment Method Activation Profile Guard (F53)**: Attempt to set a payment method `active = true` when no published rate profile covers it. Verify database trigger blocks the update.
29. **Statement Coverage Month FK Integrity (F55)**: Attempt to insert `statement_payables` with a month differing from `statements.month`. Verify rejection by composite foreign key.
30. **View Security Isolation & Credential Verification (Finding 1)**: Direct SQL or PostgREST `SELECT` on `v_monthly_totals` or `v_monthly_method_charges` executed with actual Staff credentials is rejected with `403 Permission Denied`. Same query executed under `service_role` (for Admin/Owner server handlers) succeeds. Direct RPC execution of privileged routines by `anon` or `authenticated` roles is rejected. Querying `v_staff_personal_metrics` as Staff returns only caller's own records via `security_invoker = true`.
31. **Cross-Concurrency Void/Supersede vs Create Lock Inversion Deadlock Immunity (Finding 2)**: Simulate two concurrent database connections: Txn A executes `rpc_push_sync_op` creating a new entry (acquiring sequence lock `(1002, 1)` and entry row lock), while Txn B calls `void_entry` or `supersede_entry` on an existing entry. Because both paths acquire the sequence lock `(1002, 1)` **before** row-level entry locks, verify that no deadlock occurs and both transactions serialize cleanly without error.
32. **Supersede Rejected on Non-Active Original (Finding 3)**: Create Entry A. Supersede Entry A with Entry B; subsequently supersede Entry B with Entry C. Then execute a delayed request attempting to supersede Entry A again. Verify that `rpc_supersede_entry` row-locks Entry A, detects `original.status != 'active'`, and rejects with `422 cannot_supersede_non_active`. Also verify attempting to supersede an already-voided entry is immediately rejected.
33. **Duplicate Payable Prevention & Method Consistency (Finding 4)**: Attempt to insert a payable with `kind = 'vat'` and `method_id is not null` $\to$ rejected by `chk_payable_method_consistency`. Attempt to insert `kind = 'method_charge'` with `method_id is null` $\to$ rejected. Insert an active VAT payable, then attempt to insert a second active VAT payable $\to$ rejected by `uq_active_vat_payable`. Insert an active method-charge payable for bKash, then attempt to insert a second active bKash payable $\to$ rejected by `uq_active_method_payable`. Verify that setting `active = false` on an old payable allows creating a replacement payable.
34. **Reconciliation Exception & Overpayment Review Evidence Gating (Finding 5, F65, F67, F68)**: Create an entry unmatched to any statement line for payable P. Attempt `reconcile_statement(statement_id, '', actor_id)` without an approved exception $\to$ rejected with `422 unmatched_entries_without_approved_exceptions`. Admin calls `review_entry_reconciliation_exception(entry_id, payable_id, 'approved', 'Bank cutoff delay', actor_id)`. Verify row inserted into `entry_reconciliation_exceptions` with status `'approved'`, and `reconcile_statement()` succeeds. Next, create a settlement in `overpaid` status (`paid_poisha > expected_poisha`). Attempt `close_month(month, actor_id)` $\to$ rejected with `422 unapproved_overpaid_settlement`. Owner calls `approve_settlement_overpayment(settlement_id, 'Advance credit for next cycle', owner_id)`. Verify `settlements.overpayment_review_status = 'approved'`, `overpayment_approved_amount_poisha` records exact surplus, and `close_month()` succeeds.
35. **Concurrent Settlement Payment Parent Row-Locking Serialization & Dynamic Overpayment Invalidation (Finding 6, F68, Item 1)**: Fire two concurrent payment transactions against different payment rows on the same parent settlement. Verify parent settlement row-locking (`SELECT ... FOR UPDATE`) serializes the aggregate calculation so neither payment overwrites `paid_poisha` with a stale total. Owner approves an overpayment surplus of ৳500 on a settlement (`overpayment_review_status = 'approved'`). Later, an entry in the month is modified or voided, shifting `expected_poisha` such that the surplus becomes ৳2,000 (or the settlement is no longer overpaid). Verify database trigger `trg_settlements_recalc_status_and_overpayment` automatically resets **all five** overpayment columns (`overpayment_review_status := 'none'`, `overpayment_approved_amount_poisha := null`, `overpayment_reason := null`, `overpayment_approved_by := null`, `overpayment_approved_at := null`) to satisfy `chk_overpayment_approval` without raising a check constraint violation, logs `settlement.overpayment_invalidated`, and blocks `close_month()` until the Owner re-approves the new surplus amount.
36. **First-of-Month Date Normalization & Timezone-Aware Rate Profile Publish Gate (Finding 7)**: Attempt to insert a record into `settlements`, `statements`, `statement_payables`, `month_closes`, or `month_close_events` with `month = '2026-10-15'` $\to$ rejected by `check (month = date_trunc('month', month)::date)`. Attempt to publish a rate profile with `effective_from` set to yesterday's date in `Asia/Dhaka` while the DB session is UTC $\to$ rejected by `effective_from >= (now() at time zone 'Asia/Dhaka')::date`.
37. **Scoped Exception Isolation Across Unrelated Liabilities (F67)**: Create an entry contributing both VAT and bKash method charges. The entry is unmatched in both statements. Admin approves a reconciliation exception for bKash charges: `review_entry_reconciliation_exception(entry_id, bkash_payable_id, 'approved', 'Cutoff delay', admin_id)`. Verify bKash statement reconciliation succeeds. Verify that attempting to reconcile the VAT statement without a separate approved VAT exception is rejected with `422 unmatched_entries_without_approved_exceptions`, proving exceptions cannot cross liability boundaries.
38. **Accepted Statement Line Review Evidence Enforcement (F69)**: Attempt to insert or update `statement_lines` with `match_status = 'accepted'` without reviewer metadata or note $\to$ rejected by check constraint `chk_statement_line_acceptance`. Attempt to insert `match_status = 'matched'` without `matched_entry_id` $\to$ rejected. Admin calls `accept_statement_line(line_id, 'Approved merchant fee discrepancy', admin_id)`. Verify `reviewed_by`, `reviewed_at`, and `review_note` are populated and line validation passes during `reconcile_statement()`.
39. **First-Time Month Close Idempotent Upsert & Reopen Semantics (F70)**: For a fresh calendar month with no record in `month_closes`, verify sync push accepts entries (implicit open state). Owner calls `close_month(month, owner_id)`. Verify row is inserted with `status = 'closed'` and settlement liabilities are frozen. Re-invoking `close_month()` on the same closed month returns success idempotently without error. Owner calls `reopen_month(month, 'Audit corrections', owner_id)`. Verify `status` transitions to `'open'`, child statements revert to `'open'`, and sync push resumes accepting entries.
40. **Totals-Only Manual Statement Reconciliation (Finding A1)**: For a statement with `source = 'manual_total'`, line items are intentionally empty (0 `statement_lines` rows). User enters `statement_total_poisha` matching `expected_poisha` within `tolerance_poisha` (or with an explanatory note). Call `reconcile_statement(statement_id, p_note, actor_id)`. Verify that step 5 line-matching is waived in Mode A (`source = 'manual_total'`), status transitions to `'reconciled'`, `statement_payables.status` transitions to `'reconciled'`, and no exception records are required.
41. **Date-Effective Rate Profile Authorization & Anti-Cherry-Picking (Finding A3, Item 3)**: Seed Profile 1 (published, `effective_from = '2026-01-01'`, `version = 1`) and Profile 2 (published, `effective_from = '2026-06-01'`, `version = 2`). A client with cached `maxKnownRateVersion = 2` pushes an entry dated `'2026-07-15'` but submits `rate_profile_id` referencing Profile 1 (an older, cheaper rate). Verify server recalculation detects that Profile 2 was already published and known to the client for `entry_date`, rejects the cherry-picked push with `403 rate_profile_date_mismatch`. Next, verify that pushing an entry dated `'2026-05-10'` successfully resolves Profile 1 as the date-effective profile without requiring Profile 2.
42. **NULL-Safe JSONB VAT Mode Constraint Enforcement (Finding B1)**: Attempt direct insert into `entries` with `snapshot = '{"vat": {}}'::jsonb` (missing `'mode'`), or `snapshot = '{}'::jsonb`. Verify that check constraint `chk_vat_input_mode_exclusivity` evaluates `coalesce(snapshot->'vat'->>'mode', '')` safely, does not satisfy via NULL evaluation, and actively raises a check constraint violation.
43. **Customer-Borne Method Charge Zero Settlement Liability (Finding A2)**: Create an entry for bKash payment with `charges_borne_by = 'customer'`. Verify that calculation engine outputs `businessChargePoisha = 0` and `customerChargePoisha = 6795`. Verify that `settlements.expected_poisha` for bKash method charges does not include the customer charge, ensuring no permanent reconciliation variance or settlement liability is attributed to the merchant.
44. **Two-Step Atomic Ownership Transfer Demote-Before-Promote Ordering (Finding B7)**: Execute `transfer_ownership(new_owner_id, current_owner_id)`. Verify that the implementation executes the update as an atomic two-step sequence (demote current owner to `'admin'`, then promote target admin to `'owner'`) without firing a unique constraint violation on `one_owner`, and verify that attempts to deactivate the sole active owner account are blocked by `trg_users_prevent_sole_owner_deactivation`.
45. **Table-Level Direct Write Revocation Security Proof (Finding A4)**: Using authenticated Admin and Owner JWT tokens, execute direct PostgREST or SQL `INSERT`, `UPDATE`, and `DELETE` queries against `statements`, `settlements`, `settlement_payments`, `month_closes`, and `rate_profiles`. Verify that PostgreSQL immediately blocks all direct writes with `403 Permission Denied` due to explicit table-level write revocations. Verify that financial state transitions succeed only when invoked through authorized `SECURITY DEFINER` RPCs under `service_role`.
46. **Legitimate Offline Stale Rate Acceptance & Admin Alert (Item 3)**: Seed Profile 1 (published, `effective_from = '2026-01-01'`, `version = 1`). A client device caches Profile 1 (`maxKnownRateVersion = 1`) and goes offline on `'2026-05-10'`. On `'2026-05-12'`, the Owner publishes Profile 2 (`effective_from = '2026-05-12'`, `version = 2`). On `'2026-05-13'`, while still offline, the Staff user records an entry with business date `entry_date = '2026-05-13'` referencing Profile 1 (`maxKnownRateVersion = 1`). On `'2026-05-15'`, the offline client reconnects and syncs. The server verifies that Profile 1 was the latest published profile known to the client (`version <= maxKnownRateVersion`), detects that Profile 2 was published on the server while the client was offline, accepts the entry into `entries` with `stale_rates = true`, and raises an amber alert on the Admin Dashboard.
47. **Rejected Op Persistence & Admin Dashboard Queue Visibility**: A Staff member working offline creates an entry in a month that was closed by the Owner. On sync reconnect, `rpc_push_sync_op` rejects the operation with `month_closed`. Verify that `sync_ops` records `op_id`, `actor_id`, full `payload jsonb`, and `resolution_status = 'pending'`. The Admin logs in and queries `GET /api/v1/sync/pull?since=0`. Verify that the rejected operation is returned in `rejectedOps` and renders in the Admin Dashboard "Needs Attention (Closed Month)" queue with complete transaction details. When the Staff member submits a fresh op with a new `op_id` and `supersedes_rejected_op_id` targeting an open month, verify `resolution_status` transitions to `'resolved'`.
48. **Cross-Table Trigger Lock Inversion Deadlock Immunity**: Concurrently simulate (1) entry creation/supersession/voiding which fires triggers locking `entries -> settlements -> statements`, (2) `record_settlement_payment` or `approve_settlement_overpayment` modifying settlements, and (3) `reconcile_statement` modifying statements. Verify that all financial RPCs acquire the Month Advisory Lock `pg_advisory_xact_lock(1001, year*12 + month)` as Step 1 and strictly adhere to row lock hierarchy `payables (KEY SHARE) -> entries -> settlements -> statements -> statement_payables -> statement_lines -> entry_reconciliation_exceptions`, eliminating cross-table deadlocks.
49. **Settlements Update Status & Dynamic Overpayment Invalidation (Item 1)**: Invoke `generate_monthly_settlements(v_month)` when active entries exist. Verify that the query executes cleanly without SQL syntax error via `WHERE NOT EXISTS (SELECT 1 FROM month_closes mc WHERE mc.month = v_month AND mc.status = 'closed')`. Owner approves an overpayment surplus of ৳500 on a settlement (`overpayment_review_status = 'approved'`, with `approved_by` and `approved_at` recorded). An Admin modifies an entry in the month, increasing `expected_poisha`. Verify trigger `trg_settlements_recalc_status_and_overpayment` automatically recomputes `status = calc_settlement_status(NEW.expected_poisha, NEW.paid_poisha)` and resets **all five** overpayment columns (`overpayment_review_status := 'none'`, `overpayment_approved_amount_poisha := null`, `overpayment_reason := null`, `overpayment_approved_by := null`, `overpayment_approved_at := null`), preventing a `chk_overpayment_approval` check constraint crash, invalidating the overpayment approval, and logging `settlement.overpayment_invalidated`.
50. **`txn_ref` Normalization & Mandatory Enforcement**: Submit an entry for bKash (`requires_txn_ref = true`) with padded lowercase string `txn_ref = '  bjt84920kl  '`. Verify client and server normalize to `'BJT84920KL'`. Submit an entry for bKash with `txn_ref = null` or empty string `""`; verify rejection with `missing_txn_ref`. Insert an active entry with `txn_ref = 'BJT84920KL'`, void it, and submit a new entry with the same reference; verify `dup_txn_flag = false` because the duplicate check filters exclusively on `status = 'active'`.
51. **Statement Line Auto-Unmatch on Void/Supersede**: In Mode B, Entry A is matched to line L in statement S (`match_status = 'matched'`, `matched_entry_id = Entry_A`, `is_active_match = true`). Admin voids Entry A or supersedes Entry A with a changed business date. Verify database trigger `trg_entries_unmatch_statement_lines` fires, resets line L to `matched_entry_id = null, match_status = 'unmatched'`, and cascades statement status back to `'open'`.
52. **Dual-Payable Line Matching & Customer-Borne Exemption in Mode B**: Create Entry #1 with bKash fee (charge = 6,795 poisha) and VAT (vat = 50,900 poisha). In file-based Mode B, match Entry #1 to a line in bKash Fee Statement S1, and also match Entry #1 to a line in VAT Challan Statement S2. Verify unique index `uq_active_statement_line_entry` on `(statement_id, matched_entry_id)` allows matching the same entry across the two distinct statements. Next, create an entry with `charges_borne_by = 'customer'` (`business_charge_poisha = 0`). In Mode B `reconcile_statement()`, verify that the customer-borne entry is automatically exempt from provider fee statement matching, allowing reconciliation to complete successfully.
53. **Statement Line Unmatching Cascade (H4)**: In Mode B, match an entry to a statement line, then call `unmatch_statement_line(line_id, reason, actor_id)`. Verify line resets to `unmatched`, `matched_entry_id = null`, and any parent statement and covered `statement_payables` previously marked `'reconciled'` revert to `'open'`.
54. **Reconciliation Exception Flip Invalidation (H5)**: Reconcile a statement citing an approved entry reconciliation exception. Later, flip that exception to `rejected` while the month is open. Verify statement and `statement_payables` automatically revert to `'open'`.
55. **Live Settlement & Statement Expected Recalculation Trigger (H1)**: Insert, void, and supersede entries in an open month without running `generate_monthly_settlements`. Verify `settlements.expected_poisha` and open `statements.expected_poisha` update dynamically via `trg_entries_recalc_settlements`.
56. **Engine Version Skew Enforcement (H2)**: Submit a sync op with snapshot `engineVersion = 999`. Verify server hard-rejects with `426 upgrade_required`.

### 16.3 Security, System, and Visual Tests
1. RLS tests: Staff cannot read others' entries or write settings or close months; Admin cannot manage Admins or close months; exactly one Owner invariant enforced.
2. Report parity: SQL views equal client-computed totals on the same data. Totals row equals summary cards.
3. Settlement and reconciliation: expected amounts, variance, tolerance, one-to-one line match constraint.
4. E2E (Playwright): offline entry in airplane mode, live breakdown, role dashboards, floating menu drag and snap, reduced-motion fallbacks.
5. Visual check: pearl grain background, glass menu, frosted buttons with engraved labels, light and dark mode contrast >= 4.5:1.

## 17. Milestones (build order and Definition of Done)

| M | Scope | Definition of Done |
|---|---|---|
| M0 | Monorepo, Supabase project, migrations from section 7 (with table-level write revocations on all 18 public tables, RLS enabled on all 18 tables, 2-integer collision-free advisory lock triggers with sequence lock throughput budget, deferrable owner trigger, draft/published rate profiles with Asia/Dhaka publication check and server-side 100% deduction guard, immutable payment methods code, method activation guard, payable consistency constraints & unique partial indexes, NULL-safe JSONB constraints, first-of-month check constraints, security-invoker views with explicit grants/revokes, composite statement foreign keys, scoped entry_reconciliation_exceptions table, statement_lines acceptance constraint, statement_lines unique index on `(statement_id, matched_entry_id)`, settlement overpayment amount binding with dynamic recalc triggers, `sync_ops` schema with payload jsonb, resolution status, and partial unique index on supersession, and audit log), seed methods and payables, `packages/calc` engine with all fixtures (P1–P6), design tokens and glass components | `packages/calc` fixtures pass (including 6.7 percent_inclusive, P4 percent_of_gross, P5 customer-borne, P6 overrides, and F20 mutual exclusivity); migrations apply cleanly; bootstrap runbook script (`scripts/bootstrap.ts`) runs end-to-end on clean database (H6); RLS tests pass; Tests #1 (forged snapshot), #2 (commit-order sequence race), #4 (JSON string precision), #14 (rate profile immutability), #15 & #44 (atomic two-step ownership transfer), #21 (method code immutability), #22 (Postgres privileges), #28 (method activation guard), #29 (statement month FK), #30 (view security isolation), #31 & #48 (lock hierarchy deadlock immunity), #32 (supersede active check), #33 (duplicate payables prevention), #36 (first-of-month date checks), #38 (accepted statement line evidence), #39 (first-time month close upsert), #41 (date-effective rate profile verification), #42 (NULL-safe JSONB constraint), #45 (table-level write revocations), #49 (settlements update & overpayment invalidation), #50 (`txn_ref` normalization & enforcement), #51 (statement line auto-unmatch on void/supersede), and #55 (live settlement recalculation trigger) pass |
| M1 | Auth, three roles, role dashboards (basic), admin rates and methods and payables, new entry with live breakdown, ledger list, **local-first save with IndexedDB (Dexie) and outbox** (with date-effective rate profile resolution, embedded `methodRates` in DTO, and offline Supabase JWT expiration handling), initial entry sync endpoint (Rule #7: never block a Save on connectivity) | Entry 1 from 6.6 reproduces exactly, saved locally to Dexie while in airplane mode; automatically syncs to Supabase on reconnect; Staff sees only own entries; Tests #12 (staff cursor watermark) and #27 (Asia/Dhaka timezone metrics) pass |
| M2 | Full sync engine (`sync_ops` idempotency with independent server hash verification, subtransaction fault isolation, cursor pull pagination with metadata bloat protection, sync indicator, rejected ops queue for Admin/Owner dashboard), reports and payables summary, settlement tracking with `settlement_payments` (including reversals, parent row locking, dynamic status recomputation via trigger, surplus amount binding & invalidation) and reminders, manual reconciliation (totals-only mode shipping first with 100 poisha tolerance, scoped entry exception review evidence), month close gating (Owner overpayment approval evidence matching surplus), CSV and PDF export, audit log viewer | Full offline→sync cycle passes e2e; month totals match 6.6 totals; close month gated by reconciliation and overpayment approvals; Tests #5 & #43 (customer fees settlement isolation), #6 (settlement recalculation), #7 (month close lifecycle), #8 (concurrent supersedes), #11 (server payload hash), #13 (payment reversals), #17 & #48 (multi-month lock ordering & trigger deadlock immunity), #20 & #26 (5-state settlements), #23 (statement invalidation cascade), #24 (subtransaction fault isolation), #34 (reconciliation exception & overpayment gating), #35 (concurrent payment parent locking & dynamic overpayment invalidation), #37 (scoped exception isolation), #40 (totals-only manual reconciliation), #48 (cross-table lock inversion immunity), #49 (settlements status recalc & overpayment invalidation), #50 (`txn_ref` normalization & enforcement), #51 (statement line auto-unmatch), and #52 (dual-payable matching & customer-borne exemption) pass |
| M3 | PWA service worker and installability, stale-rate handling (Rule #4 offline preservation vs anti-cherry-picking), advanced sync edge cases (closed-month rejection with complete recovery matrix including fresh-op retry, date reassignment, and discard op, void vs supersede conflict, rejected ops dashboard queue), performance tuning | No lost entries on kill and restart; Tests #3 (rejected-op fresh retry), #9 & #25 (offline retention & expiry queue), #10 (account deactivation), #18 (discard authorization), #46 (offline stale rate preservation & admin alert), and #47 (rejected op persistence & dashboard queue) pass; PWA install works |
| M4 | File-based reconciliation adapters (after sample statements), line-item reconciliation mode (one-to-one active line matching, statement-scoped matching index, customer-borne and zero-VAT auto-exemption), card combined reports (multi-payable scope) | Adapter tests with real samples; unmatched lists correct; line-item reconciliation gating verified; Tests #16 (combined card reconciliation & active matching scope), #19 (non-overlapping statement coverage), and #52 (dual-payable matching & customer-borne exemption) verified |
| M5 | Capacitor Android build, haptics, push reminders, store packaging | App runs offline on device; floating menu behaves on real hardware with docking and collision avoidance; Business Owner confirmation of open business policies (Q1–Q4) recorded in `DECISIONS.md` |
| Later | Historical ledger import, customer records, receipt sharing, online payments, automatic bank and bKash feeds | not in scope now |

## 18. Implementation Readiness Gate

The five Implementation Readiness Gates establish mandatory verification criteria before deployment. To align with milestone deliverables (M7):
- **Milestone M2 Gate**: Gates 1, 2, 3, and 4 (Database Proof, Financial Proof, Sync Proof, Lifecycle Proof) MUST be 100% satisfied and verified before signing off Milestone M2.
- **Production / Launch Gate**: All five gates (including Gate 5: Accessibility & Visual Proof) MUST be 100% satisfied before closing Milestone M3/M5 and deploying to production.

1. **Database Proof**:
   - All migrations apply cleanly to a clean Supabase / PostgreSQL 15+ database instance.
   - All 18 public tables have Row Level Security explicitly enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`).
   - All table-level writes are explicitly revoked: direct `INSERT, UPDATE, DELETE` on all 18 public tables (`entries`, `settlements`, `settlement_payments`, `statements`, `statement_payables`, `statement_lines`, `month_closes`, `month_close_events`, `entry_reconciliation_exceptions`, `rate_profiles`, `method_rates`, `audit_log`, `sync_ops`, `profiles`, `payment_methods`, `payables`, `devices`, `app_settings`) are revoked from `anon` and `authenticated`. All financial and configuration state transitions execute exclusively through `SECURITY DEFINER` RPCs under `service_role` (Finding A4, Rule #9).
   - All check constraints reject invalid writes: `chk_charge_partition`, `chk_gross_conservation`, NULL-safe `chk_vat_input_mode_exclusivity` (`(snapshot ? 'vat') and (snapshot->'vat' ? 'mode') and coalesce(...)`), `chk_reversal_reference`, `chk_void_request_reason`, `chk_void_reason`, `chk_payable_method_consistency`, `chk_overpayment_approval`, `chk_statement_line_acceptance`, and first-of-month checks `check (month = date_trunc('month', month)::date)` on all monthly tables (Findings B1, B8).
   - Generated stored column `statements.variance_poisha` physically guarantees `statement_total_poisha - expected_poisha` without manual drifting (Finding B4).
   - Dedicated `entry_reconciliation_exceptions` table scopes exception evidence per entry, payable, and month without mutating immutable `entries` (F66, F67).
   - Unique partial indexes `uq_active_vat_payable` and `uq_active_method_payable` physically prevent duplicate active liabilities for VAT or any payment method (Finding 4).
   - Unique index on `statement_lines` is scoped to `(statement_id, matched_entry_id) where matched_entry_id is not null and is_active_match = true`, allowing a single entry to match lines across separate payables (e.g. VAT vs bKash charge).
   - Triggers for immutable rate profiles (with Asia/Dhaka publish check and 100% deduction upper-bound guard), immutable entries, immutable settlement payments, immutable payment method codes (`trg_payment_methods_immutable_code`), method activation profile guard (`trg_payment_methods_active_rate_check`), sole sequence allocator (`trg_entries_server_seq`), statement line auto-unmatching on entry void/supersede (`trg_entries_unmatch_statement_lines`), settlement status recalculation and overpayment invalidation (`trg_settlements_recalc_status_and_overpayment`), and append-only `audit_log` block unauthorized mutation or deletion.
   - Atomic RPC functions (`transfer_ownership`, `publish_rate_profile`, `rpc_push_sync_op`, `rpc_supersede_entry`, `reconcile_statement`, `review_entry_reconciliation_exception`, `approve_settlement_overpayment`, `accept_statement_line`, `close_month`, `reopen_month`, `generate_monthly_settlements`, `record_settlement_payment`, `create_or_update_draft_rate_profile`, `create_statement`, `supersede_statement`, `match_statement_line`, `admin_manage_payment_method`, `admin_manage_payable`, `admin_update_settings`, `admin_manage_user`, `unmatch_statement_line`, `admin_manage_device`, `upsert_device_sync_state`) execute within single database transactions without partial commits, with strict `search_path = public, pg_temp` (Item 4, Item 5).
   - Routine execution is explicitly revoked from `PUBLIC`, `anon`, and `authenticated`, and granted exclusively to `service_role` (Finding 1).
   - Views (`v_monthly_totals`, `v_monthly_method_charges`, `v_staff_personal_metrics`) are defined `with (security_invoker = true)` with explicit role permissions (`revoke all ... from public, anon, authenticated; grant select ... to service_role;` on managerial views; `grant select ... to authenticated, service_role;` on staff metrics) and verified under actual Staff, Admin, and Owner credentials (Finding 1).
   - Composite foreign keys guarantee `statement_payables.month` strictly matches parent `statements.month`.
2. **Financial Proof**:
   - Shared `packages/calc` satisfies all paper ledger fixtures (Section 6.6), inclusive VAT fixtures (Section 6.7.1), percent-of-gross fixture P4 (Section 6.7.2), customer-borne charge fixture P5 (Section 6.7.3), and manual override fixture P6 (Section 6.7.4) with exact integer poisha arithmetic.
   - Server calculation engine authorization distinguishes cherry-picking from legitimate offline stale rates: profiles with `effective_from > entry_date` or where submitted version < expected version (`version <= maxKnownRateVersion`) are hard-rejected with `403 rate_profile_date_mismatch` (anti-cherry-picking), while entries where submitted profile was the latest known offline but superseded on the server are accepted with `stale_rates = true` (Rule #4, Finding A3, Item 3, Item 5).
   - Calculation engine enforces arithmetic sanity upper bounds (`vatInputPoisha <= grossPoisha`) and strict precedence: `DeductionsExceedGrossError` evaluates and throws before individual non-negativity checks (Finding B3).
   - Customer-borne charges (`charges_borne_by = 'customer'`) and zero-VAT manual entries generate 0 merchant liability in settlements and are automatically excluded from Mode B merchant fee/challan reconciliation, eliminating permanent structural variances and false matching blocks (Finding A2).
   - Reconciliation explicitly supports dual modes: Mode A (Totals-Only for `manual_total`, waiving line matching) shipping in M2, and Mode B (Line-Item for `file`, requiring 100% active line matches or approved exceptions for entries with non-zero liability) shipping in M4 (Finding A1).
   - Settlement payments serialize on the parent settlement row lock (`SELECT id FROM settlements WHERE id = ... FOR UPDATE`) before calculating aggregate `paid_poisha`. Net paid poisha calculates accurately ($\text{paid} = \sum \text{payments} - \sum \text{reversals}$) with row-level locks preventing concurrent reversal over-allocation (Finding 6).
   - Settlement statuses adhere strictly to the 5-state authoritative function `calc_settlement_status()`, recomputed automatically via trigger whenever `paid_poisha` OR `expected_poisha` changes (Finding 6).
   - Dynamic overpayment approval binding & invalidation: `approve_settlement_overpayment()` is **Owner only**, binds approval to the exact current surplus amount (`overpayment_approved_amount_poisha = paid_poisha - expected_poisha`), and is automatically invalidated back to `'none'` if subsequent entry or payment changes alter the financial balance or expected liability (F68).
   - Settlements in `overpaid` status require an explicit approval decision via `approve_settlement_overpayment()` recording reason, approver UUID, and timestamp matching the exact surplus before `close_month()` can proceed (Finding 5, F68).
   - Reporting views (`v_monthly_totals`, `v_monthly_method_charges`) produce numbers identical to client-side Dexie calculations and are accessible only to Admin and Owner; Staff access `v_staff_personal_metrics` computed explicitly in `Asia/Dhaka` timezone.
3. **Sync Proof**:
   - Single trust model: client identity is derived strictly from verified JWT claims (`auth.uid()`), eliminating untrusted caller parameters from RPC interfaces (Finding A5).
   - Independent server-side canonical SHA-256 hash calculation over `{type, payload, supersedesRejectedOpId, clientCreatedAt, maxKnownRateVersion}` detects payload tampering and enforces true idempotency in `sync_ops` (Item 3, Item 5).
   - Global Retry Invariant: every retry of a rejected operation MUST allocate a fresh UUID `opId` and set `supersedesRejectedOpId`. Retrying with altered payload or timestamp under the same `opId` is rejected with `op_id_conflict_tampered`. Partial unique index `uq_sync_ops_superseded` ensures single successful resolution.
   - Rejected sync operations store full `payload jsonb` and `resolution_status = 'pending'`, surfaced via `/sync/pull` to populate Admin/Owner Dashboard "Needs Attention" review queues.
   - Comprehensive rejection recovery matrix defines client state and recovery action for every server rejection reason (`month_closed`, `rate_profile_date_mismatch`, `future_timestamp_skew`, `queue_expired_needs_review`, `payload_hash_mismatch`, `op_id_conflict_tampered`, `calc_mismatch`, `invalid_snapshot_rules`, `missing_txn_ref`, `user_deactivated`) and cleanly separates database entity states from client outbox states (Finding B12).
   - SvelteKit auth guard supports offline operation, validating against cached Dexie sessions and suppressing sign-out redirects on offline network refresh errors.
   - Voiding non-active entries is rejected with `422 cannot_void_non_active`, preventing corrupted or ambiguous recovery chains (Finding A7).
   - Pull synchronization cursor ordering is immune to commit-order races via sequence advisory locking (`pg_advisory_xact_lock(1002, 1)`) with documented throughput budget ($\ge 1,000$ ops/sec, lock duration 0.5–1.0 ms) (Finding A8).
   - Incremental pull protocol & pagination bloat protection: client requests `includeMeta=true` on the first request of any sync cycle (receiving all relational config tables and rejectedOps), and passes `includeMeta=false` on subsequent pagination pages (strictly returning `{ entries, hasMore, nextCursor }`) to eliminate pagination bloat and avoid metadata starvation (Item 2, Item 5).
   - Staff pull filtering advances monotonically using independent batch scan watermarks, preventing cursor starvation even when zero matching rows are returned.
   - 3-way closed-month recovery operates reliably: reassigning dates, reopening months with fresh `op_id` retry and liability re-reconciliation, and atomic `discard_rejected_entry` execution with verified actor ownership.
   - Client timestamps are treated as advisory metadata, checked for clock skew ($\le 5$ min), and operations older than 90 days are safely routed to the Admin review queue (Finding 7).
   - Universal lock hierarchy is strictly adhered to in ALL mutation paths (ascending month locks $\to$ sequence lock $\to$ cross-table row locks: `payables (FOR KEY SHARE)` $\to$ `entries` $\to$ `settlements` $\to$ `statements` $\to$ `statement_payables` $\to$ `statement_lines` $\to$ `entry_reconciliation_exceptions`), eliminating lock-inversion deadlocks (Finding 2, Finding B10).
   - Advisory lock keys use collision-free 2-integer locks (`classid = 1001`, `objid = extract(year from m)::int * 12 + extract(month from m)::int`) (Finding 2).
   - Isolated PL/pgSQL subtransactions guarantee per-operation fault isolation so invalid operations do not roll back valid entries in the same batch.
4. **Lifecycle Proof**:
   - Atomic two-step ownership transfer procedure swaps roles safely (demote old owner before promoting new owner) without violating the 1-owner invariant (Finding B7).
   - Rate profiles strictly respect the draft/published lifecycle; backdating published profiles is blocked against the `Asia/Dhaka` business calendar (Finding 7).
   - First-time month close operates as an idempotent upsert into `month_closes`; any calendar month with no row in `month_closes` is implicitly `open` (F70).
   - Month close gating prevents closing until all payables (including multi-payable combined card scopes normalized in `statement_payables`) are 100% reconciled or marked `not_applicable`, and all overpayments have active approvals matching the exact surplus amount (F68).
   - Modifying entries in an open month triggers a cascading invalidation resetting both parent `statements` and child `statement_payables` rows to `'open'`, unmatches statement lines pointing to voided/superseded entries, and invalidates stale overpayment approvals.
   - Entry supersession requires the original to be `active` (`original.status = 'active'`) and verifies neither original nor replacement month is closed, preventing historical branching while maintaining the single active successor guarantee and preserving side-by-side audit history (Finding 3).
5. **Accessibility & Visual Proof**:
   - Design system tokens verified to meet WCAG AA $\ge 4.5:1$ contrast against `#F6F5F1` in light mode: `--muted: #5C6068` (5.78:1), `--accent: #0B6B59` (5.90:1 against `#F6F5F1`, 6.44:1 against `#FFFFFF`), `--c-vat: #8C4F00` (5.95:1), `--c-bkash: #B80053` (6.09:1), `--c-visa: #1A54B8` (6.41:1), `--c-mastercard: #9E3600` (6.46:1), and dark mode tokens $\ge 6.11:1$ (m1: measured).
   - Solid-color fallback for button text ensures readability over variable glass backgrounds and in Android WebView where `background-clip: text` can fail (Finding C2).
   - Floating draggable action menu includes default docked position (`bottom: 24px; right: 24px`) and collision avoidance auto-dodging to ensure it never covers the primary Save button (`#btn-save`) (Finding C3).
   - High-contrast styles (`@media (prefers-contrast: more)`) and reduced-transparency styles (`@media (prefers-reduced-transparency: reduce)`) verified across all views.
   - Glassmorphic backdrop filters strictly bounded to interactive overlays (menu, modal sheets) to protect rendering performance on low-end mobile devices (Finding C4).

## 19. Risks

| Risk | Mitigation |
|---|---|
| Business rules differ from assumptions (VAT, Final, charges) | All rules configurable; per-entry overrides with reasons; fixtures from the paper ledger |
| Offline entries use old rates | Snapshot per entry, `stale_rates` flag, Admin dashboard alert |
| Adversarial cherry-picking via client-attested watermark (H3) | `maxKnownRateVersion` is an honest-client heuristic; cross-referenced with server `devices.last_rate_version`; high-value stale-rate entries flagged for admin review |
| Glass and blur hurt performance on low-end phones | Blur only on menu, buttons, sheets; reduced-transparency fallback; test on a low-end Android |
| Supabase free tier limits or pausing | Plan for a paid tier in production; verify current limits |
| Statement formats unknown | Adapter interface plus manual-total path ships first |
| Scope creep | Strict milestones; non-goals in section 2 |
