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

export interface OutboxOpDto {
  opId: string;
  type:
    'create_entry' | 'request_void' | 'void_entry' | 'supersede_entry' | 'discard_rejected_entry';
  clientCreatedAt: string;
  payload: Record<string, unknown>;
  supersedesRejectedOpId?: string | null;
  maxKnownRateVersion: number;
}

export interface EntryDto {
  id: string;
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
