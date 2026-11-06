# Owner Decision Packet — Q1…Q4 (Rule 20 production precondition)

Prepared: 2026-11-06. For **Zia**. Nothing here is a tax, legal, or accounting
conclusion (AGENTS.md Rule 15); Q1 in particular needs a qualified accountant's
answer before it is treated as settled.

Every fact below was read from the running system on 2026-11-06, not from the
plan text: `app_settings`, the seeded `rate_profiles` v1 and `method_rates`
rows on the local Supabase (port 54322), PRD v1.19 §4 and §6.6, and
`packages/calc/fixtures/test_fixtures.json`.

## How to confirm

Answer each question in one line. Then copy the four blocks from §6 into the
root `DECISIONS.md`. The release gate `scripts/ops/deploy-check.ts` reads them
with these rules, so the wording matters:

- each block is a `## …` heading that contains `Q1` and `VAT`, `Q2` and `Net`,
  `Q3` and `Commission`, `Q4` and `Charges` respectively;
- each block contains `Status: CONFIRMED`;
- no `PENDING` anywhere inside the block;
- the confirmation count must reach at least 4 (`grep -c "Status: CONFIRMED" DECISIONS.md`).

---

## Q1 — VAT rule

**The question.** How is VAT captured on each payment, and must it be captured on
every entry or only on VAT-liable ones?

**What is true today.** The historical paper ledger does not use a flat VAT rate:
PRD §6.6 note records 3300→300 (9.09%), 5909→509 (8.61%), 8384→584 (6.97%). The
seeded rate profile v1 (effective 2026-01-01) is `vat_mode = manual`, `vat_bp = 0`,
so staff type the VAT amount per entry; `percent_of_gross` and `percent_inclusive`
exist as admin-selectable modes but are unused by the seed. Fixture row 1
(Ayash, bKash): gross ৳5,909.00, VAT ৳509.00.

**Why it matters.** VAT is deducted before the commission base and before the net
figure; switching modes changes every future snapshot, never an existing entry.

**Options**
- **A (PRD default, currently seeded):** staff enter the VAT amount per entry
  (`manual`). Matches how the paper ledger was kept and is the only mode validated
  against it.
- **B:** a single percentage of gross for all entries — name the basis points
  (115 bp = 1.15%) and the effective date.
- **C:** a percentage already included in the gross ("inclusive") — name the basis
  points and the effective date.
- **D:** no VAT captured until the accountant decides — accept that reports then
  show ৳0.00 VAT and no VAT payable.

**What only you can decide:** whether VAT appears on all entries or only some;
and, with your accountant, whether any percentage is legally usable at all.

**Answer line:** `Q1: A | B(<bp>) | C(<bp>) | D — VAT on all entries? yes/no.`

---

## Q2 — Meaning of "Final" / net

**The question.** What does the figure at the end of each ledger row mean, and who
receives it?

**What is true today.** The field is `net_after_deductions`; the admin-editable
label in `app_settings` is **"Net after deductions"**. The arithmetic is fixed by
the calculation engine and proven by fixture row 1: ৫,909.00 − 509.00 VAT −
2,268.00 commission − 67.95 bKash charge = **৳3,064.05**. The same identity holds
for every entry: `gross = VAT + commission + business-borne charge + net`.

**Why it matters.** If "Final" is intended to be something else (for example, the
amount remitted to a partner, or a figure that excludes a charge you do not carry),
that is a **change to the calculation identity**, not a setting — it needs a plan
change and a new audit, because every stored snapshot and report depends on it.

**Options**
- **A (PRD default):** keep `net_after_deductions` = gross − VAT − commission −
  business-borne method charge; keep or rename the label.
- **B:** keep the arithmetic, change only the displayed label — supply the exact
  wording.
- **C:** different arithmetic — stop here and raise it as a plan change; state which
  component should or should not be deducted.

**What only you can decide:** whether the business keeps that amount, or whether
part of it belongs to someone else (the paper ledger's "BKL 42%" suggests an
external share; who receives that 42% is a business fact only you know).

**Answer line:** `Q2: A | B(label: "…") | C(…) — recipient of net: business / other.`

---

## Q3 — Commission structure

**The question.** Is commission one flat rate for everyone, or does it vary by
product, partner, or customer — and is it charged on gross or on gross minus VAT?

**What is true today.** Rate profile v1: `commission_bp = 4200` (**42.00%**),
`commission_base = gross_minus_vat`. Per-entry override exists with a mandatory
reason. Fixture row 1 confirms the base: 42% of (5,909.00 − 509.00 = 5,400.00) =
**2,268.00**, exactly the fixture value.

**Why it matters.** The base choice changes every net figure; for a row where VAT
is large the difference between "on gross" and "on gross minus VAT" is material
(42% of 509.00 = ৳213.78 on that one row).

**Options**
- **A (PRD default):** one rate per rate profile, base = gross minus VAT, 42.00% at
  launch; overrides per entry with a reason.
- **B:** one rate per rate profile, base = gross — say so explicitly, because it
  changes the net on every VAT-bearing entry.
- **C:** rates vary by product/partner — this needs new per-method or per-partner
  rate columns; raise it as a plan change, do not expect a setting today.

**Answer line:** `Q3: A 42.00% on gross−VAT | B(<bp>) on gross | C(describe).`

---

## Q4 — Who bears the method charges

**The question.** Do bKash/card charges reduce what the business keeps, or are they
passed to the customer?

**What is true today.** `rate_profiles.charges_borne_by` defaults to **`business`**
(column default, `check (charges_borne_by in ('business','customer'))`). Seeded
method rates: bKash 115 bp (1.15%), Visa 150 bp (1.50%), Mastercard 150 bp,
Cash 0, Bank transfer 0. Verified on a live entry: gross 5,909.00, commission
2,481.78 (42% — VAT was 0 in that profile), bKash 67.95, net 3,359.27, i.e. the
charge was deducted from the business's net.

**Consequence of the alternative.** With `customer`, the method charge is not
deducted from net and creates **no** merchant liability toward the provider, so no
bKash/card payable is generated for those entries.

**Options**
- **A (PRD default, paper-ledger behaviour):** business bears the charge, deducted
  from net, and it forms a monthly payable.
- **B:** customer bears it — charge recorded on the entry, not deducted, no payable.
- **C:** mixed per method (for example charges on cards, none on bKash) — the knob
  is per rate profile today, not per method; raise it as a plan change.

**Answer line:** `Q4: A | B | C(which methods bear what).`

---

## Adjacent observations (not part of the Q1–Q4 sign-off)

1. **Bank transfer requires a transaction reference in the seeded data**
   (`requires_txn_ref = true`), while PRD §4 Q15 lists mandatory references only for
   bKash, Visa, and Mastercard. Confirm whether bank transfers should require a
   reference; changing it is an admin edit to `payment_methods`, not code.
2. **Visa and Mastercard share 1.50%** (open item Q5 asks whether they should
   differ). If they differ in reality, that is an admin rate edit.
3. Live test entry arithmetic (bd-tax-free profile, VAT 0) is quoted above only to
   show the charge behaviour; it is not a rate recommendation.

## 6. Copy-paste blocks for root `DECISIONS.md`

Replace each `…` with your answer; keep the heading words and `Status: CONFIRMED`.

```
## CLT-POLICY-Q1: VAT Treatment Rule
Status: CONFIRMED
Decided by: Zia
Date: <YYYY-MM-DD>
Outcome: <manual per-entry VAT | percent_of_gross at <bp> bp | percent_inclusive at <bp> bp>
VAT applies to: <all entries | only VAT-liable customers>
Adviser consulted: <name/date or UNVERIFIED — needs accountant>

## CLT-POLICY-Q2: Net / Final Calculation Definition
Status: CONFIRMED
Decided by: Zia
Date: <YYYY-MM-DD>
Outcome: net_after_deductions = gross − VAT − commission − business-borne method charge; label "<exact label>"
Recipient of net: <business | other — describe>

## CLT-POLICY-Q3: Commission Deduction Structure
Status: CONFIRMED
Decided by: Zia
Date: <YYYY-MM-DD>
Outcome: <one flat rate per rate profile at <bp> bp | varies (describe)>
Commission base: <gross minus VAT | gross>
Per-entry override with reason: <allowed | not allowed>

## CLT-POLICY-Q4: Method Charges Borne Allocation
Status: CONFIRMED
Decided by: Zia
Date: <YYYY-MM-DD>
Outcome: charges_borne_by = <business | customer | mixed (describe)>
```

## 7. Verification after pasting

```bash
cd "/home/zia/Documents/My Projects/Cosmo_Ledger_Track"
grep -c "Status: CONFIRMED" DECISIONS.md          # expect >= 4
grep -n "CLT-POLICY-Q[1-4]" DECISIONS.md          # expect 4 headings
npx tsx scripts/ops/deploy-check.ts --env=production --milestone M2
```

The last command still fails until the gates and the `ZIA-APPROVED:` release line
exist — that is its designed behaviour (CLT-D-025 item 10), not a defect. It will
report the Q1–Q4 policies as satisfied once the four blocks above are present.
