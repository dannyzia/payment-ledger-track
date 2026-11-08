import Dexie, { type Table } from 'dexie';
import type { RateSnapshot } from '@clt/calc';

export interface LocalEntry {
  id: string; // UUID
  entry_number?: string | undefined; // Formatted E-YYYYMM-XXXXXX or null pre-sync
  local_id: string; // #LOCAL-xxxx badge
  entry_date: string; // YYYY-MM-DD (Asia/Dhaka)
  customer_name: string;
  sub_qty: number;
  sub_description?: string | undefined;
  method_id: string; // UUID references payment_methods
  gross_poisha: string; // SerializedPoisha decimal string (Rule 2)
  vat_poisha: string;
  commission_poisha: string;
  charge_poisha: string; // Required financial partition total
  business_charge_poisha: string;
  customer_charge_poisha: string;
  net_poisha: string;
  txn_ref?: string | undefined;
  notes?: string | undefined;
  status: 'active' | 'voided' | 'superseded';
  sync_status: 'pending' | 'synced' | 'rejected';
  created_by: string;
  created_at: string;
  server_seq?: string | undefined;
  stale_rates: boolean;
  rate_profile_id: string;
  snapshot?: RateSnapshot | undefined; // Rule 4 immutable rate snapshot
  vat_input_poisha?: string | undefined;
  supersedes_id?: string | undefined; // Original entry ID if created in supersede mode
  device_id?: string | undefined;
  dup_txn_flag?: boolean | undefined;
  void_requested_by?: string | undefined;
  void_reason?: string | undefined;
  stale_review_status?: 'none' | 'flagged' | 'approved' | 'rejected' | undefined; // DDL check: ('none','flagged','approved','rejected')
}

export interface LocalOutboxOp {
  opId: string;
  userId: string; // Required for multi-user outbox partitioning (Plan 011, Test #62)
  type:
    'create_entry' | 'request_void' | 'void_entry' | 'supersede_entry' | 'discard_rejected_entry';
  payload: Record<string, unknown>;
  clientCreatedAt: string;
  payloadHash?: string | undefined;
  supersedesRejectedOpId?: string | undefined;
  supersedes_rejected_op_id?: string | undefined; // Backward-compatible snake_case alias
  maxKnownRateVersion: number;
  status: 'pending' | 'in_flight' | 'rejected' | 'resolved';
  outboxState?: string | undefined;
  rejectionReason?: string | undefined;
  errorMessage?: string | undefined;
}

export interface CachedRateProfile {
  id: string;
  version: number;
  status: 'draft' | 'published';
  effective_from: string; // YYYY-MM-DD
  vat_mode: 'manual' | 'percent_of_gross' | 'percent_inclusive';
  vat_bp: number;
  commission_bp: number;
  commission_base: 'gross_minus_vat' | 'gross';
  charges_borne_by?: 'business' | 'customer' | undefined;
  note?: string | undefined;
  method_rates: Record<string, { fee_bp: number; charges_borne_by: 'business' | 'customer' }>;
}

export interface CachedPaymentMethod {
  id: string;
  code: string;
  name: string;
  requires_txn_ref: boolean;
  display_order: number;
  active: boolean;
}

export interface CachedPayable {
  id: string;
  name: string; // Aligned with DDL column name
  kind: 'vat' | 'method_charge';
  method_id?: string | undefined;
  code?: string | undefined;
  recipient_name?: string | undefined; // Backward-compatible alias
  recipient_account?: string | undefined;
  due_day: number;
  remind_days_before?: number | undefined;
  active: boolean;
}

export interface CachedProfile {
  id: string; // auth.users UUID
  role: 'owner' | 'admin' | 'staff';
  display_name: string;
  active: boolean;
  phone?: string | undefined;
  default_route: string;
  created_at: string;
}

export interface CachedSettlement {
  id: string;
  month: string; // YYYY-MM-01
  payable_id: string;
  expected_poisha: string;
  paid_poisha: string;
  variance_poisha?: string | undefined;
  status: 'not_applicable' | 'due' | 'partly_paid' | 'paid' | 'overpaid';
  note?: string | undefined;
  overpayment_review_status?: 'none' | 'approved' | undefined;
  overpayment_approved_amount_poisha?: string | undefined;
  overpayment_reason?: string | undefined;
  overpayment_approved_by?: string | undefined;
  overpayment_approved_at?: string | undefined;
}

export interface CachedSettlementPayment {
  id: string;
  settlement_id: string;
  amount_poisha: string;
  paid_on: string;
  reference?: string | undefined;
  is_reversal?: boolean | undefined;
  reverses_payment_id?: string | undefined; // Aligned with DDL
  reverses_id?: string | undefined; // Backward-compatible alias
  receipt_storage_path?: string | undefined; // Aligned with DDL
  receipt_path?: string | undefined; // Backward-compatible alias
  note?: string | undefined;
  recorded_by?: string | undefined;
  created_at?: string | undefined;
}

export interface CachedStatement {
  id: string;
  month: string;
  kind: 'single_payable' | 'combined_card';
  source: 'manual_total' | 'file';
  status: 'open' | 'reconciled' | 'superseded';
  total_gross_poisha?: string | undefined;
  total_fee_poisha?: string | undefined;
  net_poisha?: string | undefined;
  expected_poisha?: string | undefined;
  variance_poisha?: string | undefined;
  reconciled_at?: string | undefined;
  reconciled_by?: string | undefined;
  // Client-authoritative fields cached by Mode A screens before background sync (CLT-D-019)
  statement_total_poisha?: string | undefined;
  payable_ids?: string[] | undefined;
  payable_id?: string | undefined;
  note?: string | undefined;
}

export interface CachedStatementLine {
  id: string;
  statement_id: string;
  line_date: string;
  gross_poisha: string;
  fee_poisha: string;
  net_poisha?: string | undefined;
  match_status: 'unmatched' | 'matched' | 'accepted';
  matched_entry_id?: string | undefined;
  is_active_match?: boolean | undefined;
  review_note?: string | undefined;
}

export interface CachedMonthClose {
  month: string; // YYYY-MM-01
  status: 'closed' | 'open';
  closed_at?: string | undefined;
  closed_by?: string | undefined;
  reopened_at?: string | undefined;
  reopened_by?: string | undefined;
  reopen_reason?: string | undefined;
}

export interface CachedRejectedOp {
  opId: string;
  op_id?: string | undefined; // Backward-compatible snake_case alias
  entry_id?: string | undefined;
  error_code: string;
  error_message: string;
  reason?: string | undefined; // Backward-compatible alias for error_message
  rejected_at: string;
  status: 'pending' | 'resolved' | 'discarded';
  payload: Record<string, unknown>;
}

export interface CachedMeta {
  key: string; // 'pullCursor', 'deviceId', 'lastSync'
  value: string | number | boolean | Record<string, unknown>;
  updated_at: string;
}

export interface CachedAppSettings {
  id: string | boolean;
  net_label: string;
  reconcile_tolerance_poisha: string;
  timezone?: string | undefined;
  currency?: string | undefined;
  locale?: string | undefined;
  organization_name?: string | undefined;
  business_address?: string | undefined;
  vat_registration_no?: string | undefined;
  sync_retention_days?: number | undefined;
  updated_at: string;
}

export class CosmoDatabase extends Dexie {
  entries!: Table<LocalEntry, string>;
  outbox!: Table<LocalOutboxOp, string>;
  rateProfiles!: Table<CachedRateProfile, string>;
  methods!: Table<CachedPaymentMethod, string>;
  payables!: Table<CachedPayable, string>;
  profiles!: Table<CachedProfile, string>;
  settlements!: Table<CachedSettlement, string>;
  settlementPayments!: Table<CachedSettlementPayment, string>;
  statements!: Table<CachedStatement, string>;
  statementLines!: Table<CachedStatementLine, string>;
  monthCloses!: Table<CachedMonthClose, string>;
  rejectedOps!: Table<CachedRejectedOp, string>;
  meta!: Table<CachedMeta, string>;
  appSettings!: Table<CachedAppSettings, string | boolean>;

  constructor() {
    super('CosmoLedgerTrackDB');

    // Dexie Indexing Invariant (PRD §9.1):
    // NO indexes on string monetary amounts (lexicographical sorting bug prevention).
    // NO indexes on boolean properties (W3C IndexedDB spec key compatibility).
    this.version(1).stores({
      entries: 'id, entry_date, status, server_seq, created_by, method_id, sync_status',
      outbox: 'opId, userId, type, status, clientCreatedAt',
      rateProfiles: 'id, version, status, effective_from',
      methods: 'id, code, display_order',
      payables: 'id, kind, method_id',
      profiles: 'id, role',
      settlements: 'id, month, payable_id, status',
      settlementPayments: 'id, settlement_id, paid_on',
      statements: 'id, month, status, kind',
      statementLines: 'id, statement_id, match_status, matched_entry_id',
      monthCloses: 'month, status',
      rejectedOps: 'opId, status, rejected_at',
      meta: 'key',
      appSettings: 'id',
    });
  }
}

export const db = new CosmoDatabase();
