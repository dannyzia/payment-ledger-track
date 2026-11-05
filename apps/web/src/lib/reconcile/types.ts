/**
 * Shared Reconciliation Data Contracts (PRD §11.3)
 * Exported from $lib/reconcile/ to eliminate client/server module boundary leaks.
 */

export interface StatementLine {
  lineIndex: number;
  date?: string;          // ISO YYYY-MM-DD
  reference?: string;     // Normalized transaction reference / TxnID / AuthCode
  grossPoisha?: bigint;   // Transaction amount in poisha
  feePoisha?: bigint;     // Merchant fee in poisha
  raw: Record<string, unknown>;
}

export interface StatementAdapterSummary {
  totalGrossPoisha: bigint;
  totalFeePoisha: bigint;
  linesCount: number;
  minDate?: string;
  maxDate?: string;
}

export interface ParsedStatement {
  adapterId: string;
  lines: StatementLine[];
  summary: StatementAdapterSummary;
}

export interface StatementAdapter {
  id: string; // e.g. 'bkash-merchant-csv' or 'card-combined-csv'
  accepts(buffer: Buffer, mimeType: string): boolean;
  parse(buffer: Buffer): Promise<ParsedStatement>;
}

export interface StatementLineItem {
  id: string;
  statement_id: string;
  line_date?: string;
  reference?: string;
  gross_poisha: string;
  fee_poisha: string;
  match_status: 'unmatched' | 'matched' | 'accepted';
  matched_entry_id?: string | null;
  review_note?: string | null;
}

export interface CandidateEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  customer_name: string;
  gross_poisha: string;
  liability_poisha: string;
  applicable_payable_id?: string;
  txn_ref?: string | null;
  is_matched: boolean;
  has_exception: boolean;
  exception_status?: string | null;
}

export interface ParsedLinePreview {
  lineIndex: number;
  lineDate?: string;
  reference?: string;
  grossPoisha: string;
  feePoisha: string;
  raw: Record<string, unknown>;
}

export interface ParsedPreviewSummary {
  totalGrossPoisha: string;
  totalFeePoisha: string;
  linesCount: number;
  minDate?: string;
  maxDate?: string;
}
