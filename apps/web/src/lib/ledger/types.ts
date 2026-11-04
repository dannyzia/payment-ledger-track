import type { LocalEntry } from '$lib/db';

export type ChipVariant = 'default' | 'commission' | 'vat' | 'bkash' | 'visa' | 'mastercard';

export interface LedgerFilters {
  startDate?: string | undefined;
  endDate?: string | undefined;
  methodId?: string | undefined;
  createdBy?: string | undefined;
  status?: 'all' | 'active' | 'pending_sync' | 'rejected' | 'voided' | 'superseded' | undefined;
  flagDuplicateTxn?: boolean | undefined;
  flagStaleRates?: boolean | undefined;
}

export interface NormalizedSearchQuery {
  rawQuery: string;
  numericEntryNumber: number | null;
  localBadgeQuery: string | null;
  textQuery: string;
}

export interface DayGroup {
  date: string; // YYYY-MM-DD
  entries: LocalEntry[];
  totalGrossPoisha: bigint;
  totalNetPoisha: bigint;
  totalDeductionsPoisha: bigint;
  totalSubQty: number;
}
