export type {
  Poisha,
  SerializedPoisha,
  VatMode,
  CommissionBase,
  ChargesBorneBy,
  RateSnapshot,
  CalcInput,
  CalcResult,
} from '@clt/calc';
export { ENGINE_VERSION } from '@clt/calc';

export type UserRole = 'super_admin' | 'owner' | 'admin' | 'staff';

export type CenterStatus = 'active' | 'suspended' | 'archived';

export interface CenterDto {
  id: string;
  centerNumber: number;
  code: string;
  name: string;
  legalEntityName: string;
  binNumber?: string | null;
  tradeLicenseNumber?: string | null;
  vatCircle?: string | null;
  address: string;
  phone: string;
  status: CenterStatus;
  createdAt: string;
}

export interface OutboxOpDto {
  opId: string;
  centerId: string;
  type:
    'create_entry' | 'request_void' | 'void_entry' | 'supersede_entry' | 'discard_rejected_entry';
  clientCreatedAt: string;
  payload: Record<string, unknown>;
  supersedesRejectedOpId?: string | null;
  maxKnownRateVersion: number;
}

export interface EntryDto {
  id: string;
  centerId: string;
  entryDate: string;
  customerName: string;
  subQty: number;
  paymentMethodCode: string;
  txnRef?: string | null;
  grossPoisha: string;
  vatInputPoisha?: string | null;
  vatOverridePoisha?: string | null;
  vatOverrideReason?: string | null;
  commissionOverridePoisha?: string | null;
  commissionOverrideReason?: string | null;
  vatPoisha: string;
  commissionPoisha: string;
  chargePoisha: string;
  businessChargePoisha: string;
  customerChargePoisha: string;
  netPoisha: string;
  rateProfileId: string;
  rateSnapshot: Record<string, unknown>;
}

export interface PayableDto {
  id: string;
  centerId: string;
  code: string;
  name: string;
  kind: 'vat' | 'method_charge';
  methodId?: string | null;
  dueDay: number;
  remindDaysBefore: number;
  active: boolean;
}

export interface SettlementDto {
  id: string;
  centerId: string;
  payableId: string;
  month: string;
  expectedPoisha: string;
  paidPoisha: string;
  variancePoisha: string;
  status: 'not_applicable' | 'due' | 'partly_paid' | 'paid' | 'overpaid';
  note?: string | null;
  overpaymentReviewStatus: 'none' | 'approved';
  overpaymentApprovedAmountPoisha?: string | null;
}

export interface StatementDto {
  id: string;
  centerId: string;
  kind: 'single_payable' | 'combined_card';
  month: string;
  source: 'manual_total' | 'file';
  fileStoragePath?: string | null;
  fileSha256?: string | null;
  statementTotalPoisha: string;
  expectedPoisha: string;
  variancePoisha: string;
  status: 'open' | 'reconciled' | 'superseded';
  note?: string | null;
}
