# Cosmo Ledger Track — Customer Presentation Deck

> **Enterprise Payment Ledger & Settlement Tracker**
> *Replacing manual handwritten payment notebooks with speed, calculation accuracy, and audit certainty.*

---

## Executive Overview

**Cosmo Ledger Track** is an offline-first payment recording and monthly settlement tracking solution designed specifically for businesses handling multi-channel retail payments in Bangladesh (bKash, Visa, Mastercard, Cash, and Bank Transfers).

Staff record one gross payment received; the app splits it in real time into **VAT**, **merchant commission**, and **channel processing charges**, manages fixed monthly settlement liabilities, and reconciles monthly statements down to the exact poisha.

---

````carousel
![S06 New Entry](/home/zia/.gemini/antigravity/brain/fa346a78-a6eb-4639-903a-66a7188b372b/S06_new_entry.png)
<!-- slide -->
![S08 Ledger](/home/zia/.gemini/antigravity/brain/fa346a78-a6eb-4639-903a-66a7188b372b/S08_ledger.png)
<!-- slide -->
![S05 Owner Dashboard](/home/zia/.gemini/antigravity/brain/fa346a78-a6eb-4639-903a-66a7188b372b/S05_owner_dashboard.png)
<!-- slide -->
![S13 Settlements](/home/zia/.gemini/antigravity/brain/fa346a78-a6eb-4639-903a-66a7188b372b/S13_settlements.png)
<!-- slide -->
![S12 Reports](/home/zia/.gemini/antigravity/brain/fa346a78-a6eb-4639-903a-66a7188b372b/S12_reports.png)
<!-- slide -->
![S19 Admin Rates](/home/zia/.gemini/antigravity/brain/fa346a78-a6eb-4639-903a-66a7188b372b/S19_admin_rates.png)
````

---

## 1. Counter Staff Speed & Accuracy (Screen S06: New Entry)

![Screen S06: New Entry](/home/zia/.gemini/antigravity/brain/fa346a78-a6eb-4639-903a-66a7188b372b/S06_new_entry.png)

### The Problem Solved
Manual notebooks force cashiers to calculate VAT and bank percentage deductions by hand while customers wait. Mistakes in rounding or forgetting bKash percentages lead to daily ledger deficits.

### Key Capabilities
- **Sub-20-Second Recording**: Staff enter a single Gross amount; the calculation engine instantly derives VAT, commission, and payment method charges before saving.
- **One-Tap Channel Selection**: Clear category chips for bKash, Visa, Mastercard, and Cash.
- **100% Offline-First**: Saves locally to the device database in under 100ms. Never blocks customer checkout if internet connectivity drops.
- **Duplicate Entry Warning**: Automatically flags duplicate payments with identical amounts or transaction IDs entered within 5 minutes.

---

## 2. Real-Time Transparency (Screen S08: Transaction Ledger)

![Screen S08: Transaction Ledger](/home/zia/.gemini/antigravity/brain/fa346a78-a6eb-4639-903a-66a7188b372b/S08_ledger.png)

### The Problem Solved
Paper registers lack search capabilities, get torn or lost, and make reviewing past transactions across shifts almost impossible.

### Key Capabilities
- **Chronological Transaction Stream**: Every transaction receives a standard human-readable identifier (`E-YYYYMM-XXXXXX`).
- **Instant Search & Filter**: Instantly search by transaction reference, customer name, date range, payment method, or amount.
- **Immutable Snapshots**: Historical entries can never be secretly edited. Changes require formal, audited "Void" or "Supersede" actions with mandatory audit notes.
- **Clear Status Badges**: Visual indicators for active, void-requested, voided, and superseded records.

---

## 3. Executive Visibility (Screen S05: Owner Dashboard)

![Screen S05: Owner Dashboard](/home/zia/.gemini/antigravity/brain/fa346a78-a6eb-4639-903a-66a7188b372b/S05_owner_dashboard.png)

### The Problem Solved
Business owners typically wait until the end of the month to know their true net revenue after bank charges and VAT liabilities have accumulated.

### Key Capabilities
- **Real-Time Net Revenue**: Continuously updates gross sales vs. true net merchant cash flow.
- **Liability Warning Alerts**: Prominent alert banners highlight upcoming and overdue settlement liabilities.
- **Payment Distribution**: Clean horizontal breakdown of revenue across bKash, Cards, and Cash.
- **Multi-Counter Monitoring**: Real-time visibility into all connected store terminals and staff activity.

---

## 4. Liability Tracking (Screen S13: Monthly Settlements)

![Screen S13: Monthly Settlements](/home/zia/.gemini/antigravity/brain/fa346a78-a6eb-4639-903a-66a7188b372b/S13_settlements.png)

### The Problem Solved
Missing bank charge deadlines or VAT payment dates leads to bank penalties, frozen merchant accounts, and compliance notices.

### Key Capabilities
- **Fixed Due-Date Schedule**: Settlement deadlines are locked between days 1 and 28 of the following month.
- **5-State Tracking**: Clear status tracking (`not_applicable`, `due`, `partly_paid`, `paid`, `overpaid`).
- **Deposit Slip Attachment**: Directly record bank transfers and cheque numbers with uploaded slip receipts.
- **Overpayment Guard**: Surplus payments require an explicit Owner authorization lock before processing.

---

## 5. Audit & Accounting (Screen S12: Reports & Reconciliation)

![Screen S12: Reports & Reconciliation](/home/zia/.gemini/antigravity/brain/fa346a78-a6eb-4639-903a-66a7188b372b/S12_reports.png)

### The Problem Solved
Reconciling paper receipts against bank and bKash merchant statements takes days of manual cross-referencing every month.

### Key Capabilities
- **Automated Mode A Reconciliation**: Compares statement totals directly against internal ledger sums within a 100-poisha tolerance (default ৳1.00).
- **NBR-Ready Tax Summaries**: Pre-formatted VAT summaries ready for tax filings in Bangladesh.
- **One-Click Export**: Export ledger tables and summaries to PDF, CSV, and Excel with one click.
- **Permanent Month Closing**: Sealing a month locks all historical entries and payables against tampering.

---

## 6. Business Safety & Control (Screen S19: Admin Rates & Rules)

![Screen S19: Admin Rates & Rules](/home/zia/.gemini/antigravity/brain/fa346a78-a6eb-4639-903a-66a7188b372b/S19_admin_rates.png)

### The Problem Solved
Hardcoding rates inside software or spreadsheets causes massive accounting chaos when rates change, or risks rates exceeding 100% of revenue.

### Key Capabilities
- **100% Deduction Upper-Bound Guard**: Built-in guard blocks rate profiles where `VAT + Commission + Charges > 10,000 bp` (100.00%).
- **Immutable Published Profiles**: Rate profiles are versioned; published profiles are locked permanently to protect past entries from retroactively changing.
- **No Developer Needed**: Administrators update commission and method rates directly through the UI.
- **Remote Device Killswitch**: Instantly revoke lost or stolen counter tablets with a single click.

---

## Summary of Customer ROI

| Metric | Previous Reality | With Cosmo Ledger Track |
|---|---|---|
| **Counter Entry Time** | 2–3 minutes with manual calculator | **< 20 seconds** on mobile device |
| **Offline Reliability** | Book recording lost / Excel unsynced | **Instant <100ms local save** |
| **Calculation Accuracy** | Frequent rounding and percentage errors | **0% math error** (Integer poisha math) |
| **Month-End Reconciliation** | 15–20 hours of manual paperwork | **1 click automated reconciliation** |
| **Audit Readiness** | Vulnerable physical notebooks | **Cryptographic, immutable audit log** |
| **Deployment Options** | Fixed desktop only | **Mobile PWA & Native Android App** |
