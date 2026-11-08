export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          operationName?: string;
          query?: string;
          variables?: Json;
          extensions?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      app_settings: {
        Row: {
          created_at: string;
          currency: string;
          id: boolean;
          locale: string;
          net_label: string;
          reconcile_tolerance_poisha: number;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          id?: boolean;
          locale?: string;
          net_label?: string;
          reconcile_tolerance_poisha?: number;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          id?: boolean;
          locale?: string;
          net_label?: string;
          reconcile_tolerance_poisha?: number;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          action: string;
          actor: string | null;
          after: Json | null;
          at: string;
          before: Json | null;
          id: number;
          target_id: string | null;
          target_table: string | null;
        };
        Insert: {
          action: string;
          actor?: string | null;
          after?: Json | null;
          at?: string;
          before?: Json | null;
          id?: never;
          target_id?: string | null;
          target_table?: string | null;
        };
        Update: {
          action?: string;
          actor?: string | null;
          after?: Json | null;
          at?: string;
          before?: Json | null;
          id?: never;
          target_id?: string | null;
          target_table?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_actor_fkey';
            columns: ['actor'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      devices: {
        Row: {
          created_at: string;
          device_id: string;
          device_name: string | null;
          id: string;
          last_rate_version: number;
          last_rate_version_at: string;
          last_seen_at: string;
          revoked: boolean;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          device_id: string;
          device_name?: string | null;
          id?: string;
          last_rate_version?: number;
          last_rate_version_at?: string;
          last_seen_at?: string;
          revoked?: boolean;
          user_id: string;
        };
        Update: {
          created_at?: string;
          device_id?: string;
          device_name?: string | null;
          id?: string;
          last_rate_version?: number;
          last_rate_version_at?: string;
          last_seen_at?: string;
          revoked?: boolean;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'devices_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      entries: {
        Row: {
          business_charge_poisha: number;
          charge_poisha: number;
          client_created_at: string | null;
          commission_override_poisha: number | null;
          commission_override_reason: string | null;
          commission_poisha: number;
          created_at: string;
          created_by: string;
          customer_charge_poisha: number;
          customer_name: string;
          device_id: string | null;
          dup_txn_flag: boolean;
          entry_date: string;
          entry_number: number | null;
          gross_poisha: number;
          id: string;
          method_id: string;
          net_poisha: number;
          notes: string | null;
          original_entry_date: string | null;
          rate_profile_id: string;
          reassign_reason: string | null;
          server_seq: number;
          snapshot: Json;
          stale_rates: boolean;
          stale_review_status: string;
          stale_reviewed_at: string | null;
          stale_reviewed_by: string | null;
          status: Database['public']['Enums']['entry_status'];
          sub_description: string | null;
          sub_qty: number;
          superseded_at: string | null;
          supersedes_id: string | null;
          txn_ref: string | null;
          updated_at: string;
          vat_input_poisha: number | null;
          vat_override_poisha: number | null;
          vat_override_reason: string | null;
          vat_poisha: number;
          void_reason: string | null;
          void_request_reason: string | null;
          void_requested_at: string | null;
          void_requested_by: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        Insert: {
          business_charge_poisha: number;
          charge_poisha: number;
          client_created_at?: string | null;
          commission_override_poisha?: number | null;
          commission_override_reason?: string | null;
          commission_poisha: number;
          created_at?: string;
          created_by: string;
          customer_charge_poisha: number;
          customer_name: string;
          device_id?: string | null;
          dup_txn_flag?: boolean;
          entry_date: string;
          entry_number?: number | null;
          gross_poisha: number;
          id: string;
          method_id: string;
          net_poisha: number;
          notes?: string | null;
          original_entry_date?: string | null;
          rate_profile_id: string;
          reassign_reason?: string | null;
          server_seq: number;
          snapshot: Json;
          stale_rates?: boolean;
          stale_review_status?: string;
          stale_reviewed_at?: string | null;
          stale_reviewed_by?: string | null;
          status?: Database['public']['Enums']['entry_status'];
          sub_description?: string | null;
          sub_qty?: number;
          superseded_at?: string | null;
          supersedes_id?: string | null;
          txn_ref?: string | null;
          updated_at?: string;
          vat_input_poisha?: number | null;
          vat_override_poisha?: number | null;
          vat_override_reason?: string | null;
          vat_poisha: number;
          void_reason?: string | null;
          void_request_reason?: string | null;
          void_requested_at?: string | null;
          void_requested_by?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          business_charge_poisha?: number;
          charge_poisha?: number;
          client_created_at?: string | null;
          commission_override_poisha?: number | null;
          commission_override_reason?: string | null;
          commission_poisha?: number;
          created_at?: string;
          created_by?: string;
          customer_charge_poisha?: number;
          customer_name?: string;
          device_id?: string | null;
          dup_txn_flag?: boolean;
          entry_date?: string;
          entry_number?: number | null;
          gross_poisha?: number;
          id?: string;
          method_id?: string;
          net_poisha?: number;
          notes?: string | null;
          original_entry_date?: string | null;
          rate_profile_id?: string;
          reassign_reason?: string | null;
          server_seq?: number;
          snapshot?: Json;
          stale_rates?: boolean;
          stale_review_status?: string;
          stale_reviewed_at?: string | null;
          stale_reviewed_by?: string | null;
          status?: Database['public']['Enums']['entry_status'];
          sub_description?: string | null;
          sub_qty?: number;
          superseded_at?: string | null;
          supersedes_id?: string | null;
          txn_ref?: string | null;
          updated_at?: string;
          vat_input_poisha?: number | null;
          vat_override_poisha?: number | null;
          vat_override_reason?: string | null;
          vat_poisha?: number;
          void_reason?: string | null;
          void_request_reason?: string | null;
          void_requested_at?: string | null;
          void_requested_by?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'entries_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entries_method_id_fkey';
            columns: ['method_id'];
            isOneToOne: false;
            referencedRelation: 'payment_methods';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entries_rate_profile_id_fkey';
            columns: ['rate_profile_id'];
            isOneToOne: false;
            referencedRelation: 'rate_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entries_stale_reviewed_by_fkey';
            columns: ['stale_reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entries_supersedes_id_fkey';
            columns: ['supersedes_id'];
            isOneToOne: false;
            referencedRelation: 'entries';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entries_void_requested_by_fkey';
            columns: ['void_requested_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entries_voided_by_fkey';
            columns: ['voided_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      entry_reconciliation_exceptions: {
        Row: {
          created_at: string;
          entry_id: string;
          id: string;
          month: string;
          payable_id: string;
          reason: string;
          reviewed_at: string;
          reviewed_by: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          entry_id: string;
          id?: string;
          month: string;
          payable_id: string;
          reason: string;
          reviewed_at?: string;
          reviewed_by: string;
          status: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          entry_id?: string;
          id?: string;
          month?: string;
          payable_id?: string;
          reason?: string;
          reviewed_at?: string;
          reviewed_by?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'entry_reconciliation_exceptions_entry_id_fkey';
            columns: ['entry_id'];
            isOneToOne: false;
            referencedRelation: 'entries';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entry_reconciliation_exceptions_payable_id_fkey';
            columns: ['payable_id'];
            isOneToOne: false;
            referencedRelation: 'payables';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entry_reconciliation_exceptions_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      method_rates: {
        Row: {
          charge_bp: number;
          method_id: string;
          rate_profile_id: string;
        };
        Insert: {
          charge_bp: number;
          method_id: string;
          rate_profile_id: string;
        };
        Update: {
          charge_bp?: number;
          method_id?: string;
          rate_profile_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'method_rates_method_id_fkey';
            columns: ['method_id'];
            isOneToOne: false;
            referencedRelation: 'payment_methods';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'method_rates_rate_profile_id_fkey';
            columns: ['rate_profile_id'];
            isOneToOne: false;
            referencedRelation: 'rate_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      month_close_events: {
        Row: {
          action: string;
          actor: string;
          created_at: string;
          id: string;
          month: string;
          reason: string | null;
        };
        Insert: {
          action: string;
          actor: string;
          created_at?: string;
          id?: string;
          month: string;
          reason?: string | null;
        };
        Update: {
          action?: string;
          actor?: string;
          created_at?: string;
          id?: string;
          month?: string;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'month_close_events_actor_fkey';
            columns: ['actor'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      month_closes: {
        Row: {
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          month: string;
          reopen_reason: string | null;
          reopened_at: string | null;
          reopened_by: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          closed_at?: string | null;
          closed_by?: string | null;
          created_at?: string;
          month: string;
          reopen_reason?: string | null;
          reopened_at?: string | null;
          reopened_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          closed_at?: string | null;
          closed_by?: string | null;
          created_at?: string;
          month?: string;
          reopen_reason?: string | null;
          reopened_at?: string | null;
          reopened_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'month_closes_closed_by_fkey';
            columns: ['closed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'month_closes_reopened_by_fkey';
            columns: ['reopened_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      payables: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          due_day: number;
          id: string;
          kind: string;
          method_id: string | null;
          name: string;
          remind_days_before: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          due_day: number;
          id?: string;
          kind: string;
          method_id?: string | null;
          name: string;
          remind_days_before?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          due_day?: number;
          id?: string;
          kind?: string;
          method_id?: string | null;
          name?: string;
          remind_days_before?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payables_method_id_fkey';
            columns: ['method_id'];
            isOneToOne: false;
            referencedRelation: 'payment_methods';
            referencedColumns: ['id'];
          },
        ];
      };
      payment_methods: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          id: string;
          name: string;
          requires_txn_ref: boolean;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          id?: string;
          name: string;
          requires_txn_ref?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          id?: string;
          name?: string;
          requires_txn_ref?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          active: boolean;
          created_at: string;
          full_name: string;
          id: string;
          role: Database['public']['Enums']['user_role'];
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          full_name: string;
          id: string;
          role?: Database['public']['Enums']['user_role'];
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          full_name?: string;
          id?: string;
          role?: Database['public']['Enums']['user_role'];
          updated_at?: string;
        };
        Relationships: [];
      };
      rate_profiles: {
        Row: {
          charges_borne_by: string;
          commission_base: string;
          commission_bp: number;
          created_at: string;
          created_by: string | null;
          effective_from: string;
          id: string;
          note: string | null;
          published_at: string | null;
          status: string;
          vat_bp: number;
          vat_mode: string;
          version: number | null;
        };
        Insert: {
          charges_borne_by?: string;
          commission_base?: string;
          commission_bp?: number;
          created_at?: string;
          created_by?: string | null;
          effective_from: string;
          id?: string;
          note?: string | null;
          published_at?: string | null;
          status?: string;
          vat_bp?: number;
          vat_mode?: string;
          version?: number | null;
        };
        Update: {
          charges_borne_by?: string;
          commission_base?: string;
          commission_bp?: number;
          created_at?: string;
          created_by?: string | null;
          effective_from?: string;
          id?: string;
          note?: string | null;
          published_at?: string | null;
          status?: string;
          vat_bp?: number;
          vat_mode?: string;
          version?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'rate_profiles_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      settlement_payments: {
        Row: {
          amount_poisha: number;
          created_at: string;
          id: string;
          is_reversal: boolean;
          note: string | null;
          paid_on: string;
          receipt_storage_path: string | null;
          recorded_by: string | null;
          reference: string | null;
          reverses_payment_id: string | null;
          settlement_id: string;
          updated_at: string;
        };
        Insert: {
          amount_poisha: number;
          created_at?: string;
          id?: string;
          is_reversal?: boolean;
          note?: string | null;
          paid_on: string;
          receipt_storage_path?: string | null;
          recorded_by?: string | null;
          reference?: string | null;
          reverses_payment_id?: string | null;
          settlement_id: string;
          updated_at?: string;
        };
        Update: {
          amount_poisha?: number;
          created_at?: string;
          id?: string;
          is_reversal?: boolean;
          note?: string | null;
          paid_on?: string;
          receipt_storage_path?: string | null;
          recorded_by?: string | null;
          reference?: string | null;
          reverses_payment_id?: string | null;
          settlement_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'settlement_payments_recorded_by_fkey';
            columns: ['recorded_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'settlement_payments_reverses_payment_id_fkey';
            columns: ['reverses_payment_id'];
            isOneToOne: false;
            referencedRelation: 'settlement_payments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'settlement_payments_settlement_id_fkey';
            columns: ['settlement_id'];
            isOneToOne: false;
            referencedRelation: 'settlements';
            referencedColumns: ['id'];
          },
        ];
      };
      settlements: {
        Row: {
          created_at: string;
          expected_poisha: number;
          id: string;
          month: string;
          note: string | null;
          overpayment_approved_amount_poisha: number | null;
          overpayment_approved_at: string | null;
          overpayment_approved_by: string | null;
          overpayment_reason: string | null;
          overpayment_review_status: string;
          paid_poisha: number;
          payable_id: string;
          status: string;
          updated_at: string;
          variance_poisha: number | null;
        };
        Insert: {
          created_at?: string;
          expected_poisha: number;
          id?: string;
          month: string;
          note?: string | null;
          overpayment_approved_amount_poisha?: number | null;
          overpayment_approved_at?: string | null;
          overpayment_approved_by?: string | null;
          overpayment_reason?: string | null;
          overpayment_review_status?: string;
          paid_poisha?: number;
          payable_id: string;
          status?: string;
          updated_at?: string;
          variance_poisha?: number | null;
        };
        Update: {
          created_at?: string;
          expected_poisha?: number;
          id?: string;
          month?: string;
          note?: string | null;
          overpayment_approved_amount_poisha?: number | null;
          overpayment_approved_at?: string | null;
          overpayment_approved_by?: string | null;
          overpayment_reason?: string | null;
          overpayment_review_status?: string;
          paid_poisha?: number;
          payable_id?: string;
          status?: string;
          updated_at?: string;
          variance_poisha?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'settlements_overpayment_approved_by_fkey';
            columns: ['overpayment_approved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'settlements_payable_id_fkey';
            columns: ['payable_id'];
            isOneToOne: false;
            referencedRelation: 'payables';
            referencedColumns: ['id'];
          },
        ];
      };
      statement_lines: {
        Row: {
          created_at: string;
          fee_poisha: number | null;
          gross_poisha: number | null;
          id: string;
          is_active_match: boolean;
          line_date: string | null;
          match_status: string;
          matched_entry_id: string | null;
          raw: Json | null;
          reference: string | null;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          statement_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          fee_poisha?: number | null;
          gross_poisha?: number | null;
          id?: string;
          is_active_match?: boolean;
          line_date?: string | null;
          match_status?: string;
          matched_entry_id?: string | null;
          raw?: Json | null;
          reference?: string | null;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          statement_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          fee_poisha?: number | null;
          gross_poisha?: number | null;
          id?: string;
          is_active_match?: boolean;
          line_date?: string | null;
          match_status?: string;
          matched_entry_id?: string | null;
          raw?: Json | null;
          reference?: string | null;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          statement_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'statement_lines_matched_entry_id_fkey';
            columns: ['matched_entry_id'];
            isOneToOne: false;
            referencedRelation: 'entries';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'statement_lines_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'statement_lines_statement_id_fkey';
            columns: ['statement_id'];
            isOneToOne: false;
            referencedRelation: 'statements';
            referencedColumns: ['id'];
          },
        ];
      };
      statement_payables: {
        Row: {
          month: string;
          payable_id: string;
          statement_id: string;
          status: string;
        };
        Insert: {
          month: string;
          payable_id: string;
          statement_id: string;
          status?: string;
        };
        Update: {
          month?: string;
          payable_id?: string;
          statement_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'statement_payables_payable_id_fkey';
            columns: ['payable_id'];
            isOneToOne: false;
            referencedRelation: 'payables';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'statement_payables_statement_id_month_fkey';
            columns: ['statement_id', 'month'];
            isOneToOne: false;
            referencedRelation: 'statements';
            referencedColumns: ['id', 'month'];
          },
        ];
      };
      statements: {
        Row: {
          created_at: string;
          created_by: string | null;
          expected_poisha: number;
          file_sha256: string | null;
          file_storage_path: string | null;
          id: string;
          kind: string;
          month: string;
          note: string | null;
          reconciled_at: string | null;
          reconciled_by: string | null;
          source: string;
          statement_total_poisha: number;
          status: string;
          superseded_by: string | null;
          updated_at: string;
          variance_poisha: number | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          expected_poisha: number;
          file_sha256?: string | null;
          file_storage_path?: string | null;
          id?: string;
          kind?: string;
          month: string;
          note?: string | null;
          reconciled_at?: string | null;
          reconciled_by?: string | null;
          source: string;
          statement_total_poisha: number;
          status?: string;
          superseded_by?: string | null;
          updated_at?: string;
          variance_poisha?: number | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          expected_poisha?: number;
          file_sha256?: string | null;
          file_storage_path?: string | null;
          id?: string;
          kind?: string;
          month?: string;
          note?: string | null;
          reconciled_at?: string | null;
          reconciled_by?: string | null;
          source?: string;
          statement_total_poisha?: number;
          status?: string;
          superseded_by?: string | null;
          updated_at?: string;
          variance_poisha?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'statements_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'statements_reconciled_by_fkey';
            columns: ['reconciled_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'statements_superseded_by_fkey';
            columns: ['superseded_by'];
            isOneToOne: false;
            referencedRelation: 'statements';
            referencedColumns: ['id'];
          },
        ];
      };
      sync_ops: {
        Row: {
          actor_id: string;
          client_created_at: string;
          created_at: string;
          device_id: string;
          entry_id: string | null;
          op_id: string;
          op_type: string;
          payload: Json;
          payload_hash: string;
          reason: string | null;
          resolution_status: string;
          result: string;
          supersedes_rejected_op_id: string | null;
        };
        Insert: {
          actor_id: string;
          client_created_at: string;
          created_at?: string;
          device_id: string;
          entry_id?: string | null;
          op_id: string;
          op_type: string;
          payload: Json;
          payload_hash: string;
          reason?: string | null;
          resolution_status?: string;
          result: string;
          supersedes_rejected_op_id?: string | null;
        };
        Update: {
          actor_id?: string;
          client_created_at?: string;
          created_at?: string;
          device_id?: string;
          entry_id?: string | null;
          op_id?: string;
          op_type?: string;
          payload?: Json;
          payload_hash?: string;
          reason?: string | null;
          resolution_status?: string;
          result?: string;
          supersedes_rejected_op_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sync_ops_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sync_ops_supersedes_rejected_op_id_fkey';
            columns: ['supersedes_rejected_op_id'];
            isOneToOne: false;
            referencedRelation: 'sync_ops';
            referencedColumns: ['op_id'];
          },
        ];
      };
    };
    Views: {
      v_monthly_method_charges: {
        Row: {
          business_charge: number | null;
          code: string | null;
          customer_charge: number | null;
          entries: number | null;
          month: string | null;
          total_charge: number | null;
        };
        Relationships: [];
      };
      v_monthly_totals: {
        Row: {
          business_charge: number | null;
          commission: number | null;
          customer_charge: number | null;
          entries: number | null;
          gross: number | null;
          month: string | null;
          net: number | null;
          total_charge: number | null;
          total_sub_qty: number | null;
          vat: number | null;
        };
        Relationships: [];
      };
      v_staff_personal_metrics: {
        Row: {
          entries_this_month: number | null;
          entries_today: number | null;
          gross_this_month: number | null;
          gross_today: number | null;
        };
        Relationships: [];
      };
      view_device_stale_rate_anomalies: {
        Row: {
          actor_id: string | null;
          device_id: string | null;
          latest_stale_op_at: string | null;
          stale_ops_last_hour: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sync_ops_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      accept_statement_line: {
        Args: {
          p_line_id: string;
          p_review_note: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      admin_invite_user: {
        Args: {
          p_email: string;
          p_role: Database['public']['Enums']['user_role'];
          p_full_name: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      admin_manage_device: {
        Args: {
          p_device_id: string;
          p_action: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      admin_manage_payable: {
        Args: {
          p_action: string;
          p_id: string;
          p_kind: string;
          p_method_id: string;
          p_code: string;
          p_name: string;
          p_due_day: number;
          p_remind_days_before: number;
          p_active: boolean;
          p_actor_id: string;
        };
        Returns: string;
      };
      admin_manage_payment_method: {
        Args: {
          p_action: string;
          p_id: string;
          p_code: string;
          p_name: string;
          p_sort_order: number;
          p_active: boolean;
          p_requires_txn_ref: boolean;
          p_actor_id: string;
        };
        Returns: string;
      };
      admin_manage_user: {
        Args: {
          p_action: string;
          p_user_id: string;
          p_role: string;
          p_active: boolean;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      admin_review_stale_entry: {
        Args: {
          p_entry_id: string;
          p_action: string;
          p_actor_id: string;
          p_reason?: string;
        };
        Returns: Json;
      };
      admin_update_settings: {
        Args: {
          p_settings: Json;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      approve_settlement_overpayment: {
        Args: {
          p_settlement_id: string;
          p_reason: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      calc_settlement_status: {
        Args: {
          p_expected: number;
          p_paid: number;
        };
        Returns: string;
      };
      close_month: {
        Args: {
          p_month: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      create_or_update_draft_rate_profile: {
        Args: {
          p_profile_id: string;
          p_effective_from: string;
          p_vat_mode: string;
          p_vat_bp: number;
          p_commission_base: string;
          p_commission_bp: number;
          p_method_rates: Json;
          p_actor_id: string;
        };
        Returns: string;
      };
      create_statement: {
        Args: {
          p_kind: string;
          p_month: string;
          p_source: string;
          p_file_storage_path: string;
          p_file_sha256: string;
          p_statement_total_poisha: number;
          p_payable_ids: string[];
          p_lines: Json;
          p_actor_id: string;
        };
        Returns: string;
      };
      generate_monthly_settlements: {
        Args: {
          p_month: string;
        };
        Returns: undefined;
      };
      log_audit_event: {
        Args: {
          p_actor_id: string;
          p_event_name: string;
          p_target_table: string;
          p_target_id: string;
          p_old_values?: Json;
          p_new_values?: Json;
        };
        Returns: undefined;
      };
      match_statement_line: {
        Args: {
          p_line_id: string;
          p_entry_id: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      mul_bp: {
        Args: {
          amount: number;
          bp: number;
        };
        Returns: number;
      };
      perform_statement_auto_match: {
        Args: {
          p_statement_id: string;
          p_month: string;
        };
        Returns: undefined;
      };
      publish_rate_profile: {
        Args: {
          p_profile_id: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      purge_expired_sync_ops: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      reconcile_statement: {
        Args: {
          p_statement_id: string;
          p_note: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      record_settlement_payment: {
        Args: {
          p_settlement_id: string;
          p_amount_poisha: number;
          p_paid_on: string;
          p_reference: string;
          p_receipt_path: string;
          p_note: string;
          p_is_reversal: boolean;
          p_reverses_id: string;
          p_actor_id: string;
        };
        Returns: string;
      };
      reopen_month: {
        Args: {
          p_month: string;
          p_reason: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      review_entry_reconciliation_exception: {
        Args: {
          p_entry_id: string;
          p_payable_id: string;
          p_action: string;
          p_reason: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      round_half_up: {
        Args: {
          num: number;
          div: number;
        };
        Returns: number;
      };
      rpc_push_sync_op: {
        Args: {
          p_device_id: string;
          p_caller_id: string;
          p_caller_role: Database['public']['Enums']['user_role'];
          p_ops: Json;
        };
        Returns: Json;
      };
      rpc_supersede_entry: {
        Args: {
          p_original_id: string;
          p_new_entry: Json;
          p_actor_id: string;
        };
        Returns: Json;
      };
      supersede_statement: {
        Args: {
          p_original_statement_id: string;
          p_file_storage_path: string;
          p_file_sha256: string;
          p_statement_total_poisha: number;
          p_note: string;
          p_lines: Json;
          p_actor_id: string;
        };
        Returns: string;
      };
      transfer_ownership: {
        Args: {
          p_new_owner_id: string;
          p_caller_id: string;
        };
        Returns: undefined;
      };
      unmatch_statement_line: {
        Args: {
          p_line_id: string;
          p_reason: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      upsert_device_sync_state: {
        Args: {
          p_device_id: string;
          p_user_id: string;
          p_rate_version?: number;
        };
        Returns: undefined;
      };
    };
    Enums: {
      entry_status: 'active' | 'voided' | 'superseded';
      user_role: 'owner' | 'admin' | 'staff';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null;
          avif_autodetection: boolean | null;
          created_at: string | null;
          file_size_limit: number | null;
          id: string;
          name: string;
          owner: string | null;
          owner_id: string | null;
          public: boolean | null;
          updated_at: string | null;
        };
        Insert: {
          allowed_mime_types?: string[] | null;
          avif_autodetection?: boolean | null;
          created_at?: string | null;
          file_size_limit?: number | null;
          id: string;
          name: string;
          owner?: string | null;
          owner_id?: string | null;
          public?: boolean | null;
          updated_at?: string | null;
        };
        Update: {
          allowed_mime_types?: string[] | null;
          avif_autodetection?: boolean | null;
          created_at?: string | null;
          file_size_limit?: number | null;
          id?: string;
          name?: string;
          owner?: string | null;
          owner_id?: string | null;
          public?: boolean | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      migrations: {
        Row: {
          executed_at: string | null;
          hash: string;
          id: number;
          name: string;
        };
        Insert: {
          executed_at?: string | null;
          hash: string;
          id: number;
          name: string;
        };
        Update: {
          executed_at?: string | null;
          hash?: string;
          id?: number;
          name?: string;
        };
        Relationships: [];
      };
      objects: {
        Row: {
          bucket_id: string | null;
          created_at: string | null;
          id: string;
          last_accessed_at: string | null;
          metadata: Json | null;
          name: string | null;
          owner: string | null;
          owner_id: string | null;
          path_tokens: string[] | null;
          updated_at: string | null;
          user_metadata: Json | null;
          version: string | null;
        };
        Insert: {
          bucket_id?: string | null;
          created_at?: string | null;
          id?: string;
          last_accessed_at?: string | null;
          metadata?: Json | null;
          name?: string | null;
          owner?: string | null;
          owner_id?: string | null;
          path_tokens?: string[] | null;
          updated_at?: string | null;
          user_metadata?: Json | null;
          version?: string | null;
        };
        Update: {
          bucket_id?: string | null;
          created_at?: string | null;
          id?: string;
          last_accessed_at?: string | null;
          metadata?: Json | null;
          name?: string | null;
          owner?: string | null;
          owner_id?: string | null;
          path_tokens?: string[] | null;
          updated_at?: string | null;
          user_metadata?: Json | null;
          version?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'objects_bucketId_fkey';
            columns: ['bucket_id'];
            isOneToOne: false;
            referencedRelation: 'buckets';
            referencedColumns: ['id'];
          },
        ];
      };
      s3_multipart_uploads: {
        Row: {
          bucket_id: string;
          created_at: string;
          id: string;
          in_progress_size: number;
          key: string;
          owner_id: string | null;
          upload_signature: string;
          user_metadata: Json | null;
          version: string;
        };
        Insert: {
          bucket_id: string;
          created_at?: string;
          id: string;
          in_progress_size?: number;
          key: string;
          owner_id?: string | null;
          upload_signature: string;
          user_metadata?: Json | null;
          version: string;
        };
        Update: {
          bucket_id?: string;
          created_at?: string;
          id?: string;
          in_progress_size?: number;
          key?: string;
          owner_id?: string | null;
          upload_signature?: string;
          user_metadata?: Json | null;
          version?: string;
        };
        Relationships: [
          {
            foreignKeyName: 's3_multipart_uploads_bucket_id_fkey';
            columns: ['bucket_id'];
            isOneToOne: false;
            referencedRelation: 'buckets';
            referencedColumns: ['id'];
          },
        ];
      };
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string;
          created_at: string;
          etag: string;
          id: string;
          key: string;
          owner_id: string | null;
          part_number: number;
          size: number;
          upload_id: string;
          version: string;
        };
        Insert: {
          bucket_id: string;
          created_at?: string;
          etag: string;
          id?: string;
          key: string;
          owner_id?: string | null;
          part_number: number;
          size?: number;
          upload_id: string;
          version: string;
        };
        Update: {
          bucket_id?: string;
          created_at?: string;
          etag?: string;
          id?: string;
          key?: string;
          owner_id?: string | null;
          part_number?: number;
          size?: number;
          upload_id?: string;
          version?: string;
        };
        Relationships: [
          {
            foreignKeyName: 's3_multipart_uploads_parts_bucket_id_fkey';
            columns: ['bucket_id'];
            isOneToOne: false;
            referencedRelation: 'buckets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 's3_multipart_uploads_parts_upload_id_fkey';
            columns: ['upload_id'];
            isOneToOne: false;
            referencedRelation: 's3_multipart_uploads';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      can_insert_object: {
        Args: {
          bucketid: string;
          name: string;
          owner: string;
          metadata: Json;
        };
        Returns: undefined;
      };
      extension: {
        Args: {
          name: string;
        };
        Returns: string;
      };
      filename: {
        Args: {
          name: string;
        };
        Returns: string;
      };
      foldername: {
        Args: {
          name: string;
        };
        Returns: string[];
      };
      get_size_by_bucket: {
        Args: Record<PropertyKey, never>;
        Returns: {
          size: number;
          bucket_id: string;
        }[];
      };
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string;
          prefix_param: string;
          delimiter_param: string;
          max_keys?: number;
          next_key_token?: string;
          next_upload_token?: string;
        };
        Returns: {
          key: string;
          id: string;
          created_at: string;
        }[];
      };
      list_objects_with_delimiter: {
        Args: {
          bucket_id: string;
          prefix_param: string;
          delimiter_param: string;
          max_keys?: number;
          start_after?: string;
          next_token?: string;
        };
        Returns: {
          name: string;
          id: string;
          metadata: Json;
          updated_at: string;
        }[];
      };
      operation: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      search: {
        Args: {
          prefix: string;
          bucketname: string;
          limits?: number;
          levels?: number;
          offsets?: number;
          search?: string;
          sortcolumn?: string;
          sortorder?: string;
        };
        Returns: {
          name: string;
          id: string;
          updated_at: string;
          created_at: string;
          last_accessed_at: string;
          metadata: Json;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database[Extract<keyof Database, 'public'>];

export type Tables<
  PublicTableNameOrOptions extends
    keyof (PublicSchema['Tables'] & PublicSchema['Views']) | { schema: keyof Database },
  TableName extends (PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions['schema']]['Tables'] &
        Database[PublicTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions['schema']]['Tables'] &
      Database[PublicTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema['Tables'] & PublicSchema['Views'])
    ? (PublicSchema['Tables'] & PublicSchema['Views'])[PublicTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  PublicTableNameOrOptions extends keyof PublicSchema['Tables'] | { schema: keyof Database },
  TableName extends (PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema['Tables']
    ? PublicSchema['Tables'][PublicTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  PublicTableNameOrOptions extends keyof PublicSchema['Tables'] | { schema: keyof Database },
  TableName extends (PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema['Tables']
    ? PublicSchema['Tables'][PublicTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  PublicEnumNameOrOptions extends keyof PublicSchema['Enums'] | { schema: keyof Database },
  EnumName extends (PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions['schema']]['Enums'][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema['Enums']
    ? PublicSchema['Enums'][PublicEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof PublicSchema['CompositeTypes'] | { schema: keyof Database },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database;
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema['CompositeTypes']
    ? PublicSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;
