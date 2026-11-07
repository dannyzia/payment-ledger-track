<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase/client';
  import { authFetch } from '$lib/api/client';
  import { formatPoishaToBdt } from '@clt/shared';
  import Button from '$lib/ui/Button.svelte';
  import Card from '$lib/ui/Card.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import { db, type CachedPayable } from '$lib/db';
  import { currentDhakaMonth } from '$lib/reconcile/tolerance';
  import type {
    StatementLineItem,
    CandidateEntry,
    ParsedPreviewSummary,
    ParsedLinePreview,
  } from '$lib/reconcile/types';

  interface ActiveStatement {
    id: string;
    month: string;
    status: string;
file_storage_path?: string;
    file_sha256?: string;
    statement_total_poisha: string;
    payable_ids: string[];
  }

  // --- State ---
  let loading = $state(false);
  let actionLoading = $state(false);
  let errorMessage = $state<string | null>(null);
  let successMessage = $state<string | null>(null);

  // Payables & Month Selection
  let payables = $state<CachedPayable[]>([]);
  let selectedPayableIds = $state<string[]>([]);
  let selectedMonthInput = $state<string>(currentDhakaMonth()); // YYYY-MM
  let selectedMonth = $derived(`${selectedMonthInput}-01`); // Normalized YYYY-MM-01

  // Tolerance from app settings (PRD default 100 poisha)
  let tolerancePoisha = $state(100n);

  // Step 1: Upload & Preview State
  let statementFile = $state<File | null>(null);
  let uploadPreview = $state<{
    path: string;
    fileSha256: string;
    linesCount: number;
    parsedLines: ParsedLinePreview[];
    detectedAdapter: string;
    previewSummary: ParsedPreviewSummary;
  } | null>(null);

  // Existing Statement for Month (blocks confirmation until superseded)
  let existingStatement = $state<ActiveStatement | null>(null);

  // Step 2: Active Reconciling Statement
  let activeStatement = $state<ActiveStatement | null>(null);
  let statementLines = $state<StatementLineItem[]>([]);
  let coveredEntries = $state<CandidateEntry[]>([]);
  let lineFilter = $state<'all' | 'unmatched' | 'matched' | 'accepted'>('all');

  // Modals State
  let candidateModalOpen = $state(false);
  let selectedLineForMatch = $state<StatementLineItem | null>(null);
  let candidateSearchQuery = $state('');

  let unmatchModalOpen = $state(false);
  let selectedLineForUnmatch = $state<StatementLineItem | null>(null);
  let unmatchReason = $state('');

  let acceptModalOpen = $state(false);
  let selectedLineForAccept = $state<StatementLineItem | null>(null);
  let acceptReviewNote = $state('');

  let exceptionModalOpen = $state(false);
  let selectedEntryForException = $state<CandidateEntry | null>(null);
  let exceptionReason = $state('');

  let supersedeModalOpen = $state(false);
  let supersedeReason = $state('');

  // Reconcile Finalize State
  let reconcileNote = $state('');

  // --- Derived Calculations ---
  let unmatchedLinesCount = $derived(statementLines.filter(l => l.match_status === 'unmatched').length);
  let matchedLinesCount = $derived(statementLines.filter(l => l.match_status === 'matched').length);
  let acceptedLinesCount = $derived(statementLines.filter(l => l.match_status === 'accepted').length);

  let filteredStatementLines = $derived(
    lineFilter === 'all'
      ? statementLines
      : statementLines.filter(l => l.match_status === lineFilter)
  );

  let statementTotalFeePoisha = $derived(
    statementLines.reduce((acc, l) => acc + BigInt(l.fee_poisha || '0'), 0n)
  );

  let coveredEntriesTotalLiabilityPoisha = $derived(
    coveredEntries.reduce((acc, e) => acc + BigInt(e.liability_poisha || '0'), 0n)
  );

  let variancePoisha = $derived(
    statementTotalFeePoisha > coveredEntriesTotalLiabilityPoisha
      ? statementTotalFeePoisha - coveredEntriesTotalLiabilityPoisha
      : coveredEntriesTotalLiabilityPoisha - statementTotalFeePoisha
  );

  let varianceWithinTolerance = $derived(variancePoisha <= tolerancePoisha);

  let unmatchedCoveredEntriesCount = $derived(
    coveredEntries.filter(e => !e.is_matched && !e.has_exception).length
  );

  let canFinalizeReconciliation = $derived(
    activeStatement !== null &&
    activeStatement.status === 'open' &&
    statementLines.length > 0 &&
    unmatchedLinesCount === 0 &&
    unmatchedCoveredEntriesCount === 0 &&
    (varianceWithinTolerance || reconcileNote.trim().length > 0)
  );

  let filteredCandidates = $derived(
    coveredEntries.filter(e => {
      if (e.is_matched) return false;
      const q = candidateSearchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        e.entry_number.toLowerCase().includes(q) ||
        (e.txn_ref && e.txn_ref.toLowerCase().includes(q)) ||
        (e.customer_name && e.customer_name.toLowerCase().includes(q))
      );
    })
  );

  // --- Lifecycle ---
  onMount(async () => {
    loading = true;
    try {
      const settings = await db.appSettings.toCollection().first();
      if (settings?.reconcile_tolerance_poisha) {
        tolerancePoisha = BigInt(settings.reconcile_tolerance_poisha);
      }
      await fetchPayables();
      await checkExistingStatement();
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Failed to initialize reconciliation upload';
    } finally {
      loading = false;
    }
  });

  async function fetchPayables() {
    // PRD §8.3: payables come from the admin panel, cached locally
    payables = (await db.payables.toArray()).filter(p => p.active);
    if (payables.length > 0 && selectedPayableIds.length === 0) {
      selectedPayableIds = [payables[0].id];
    }
  }

  async function checkExistingStatement() {
    existingStatement = null;
    const { data: stmts, error: sErr } = await supabase
      .from('statements')
      .select('id, month, status, file_storage_path, file_sha256, statement_total_poisha')
      .eq('month', selectedMonth)
      .eq('source', 'file')
      .in('status', ['open', 'reconciled'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (sErr) throw sErr;
    const stmt = stmts?.[0];
    if (!stmt) return;

    const { data: pData } = await supabase
      .from('statement_payables')
      .select('payable_id')
      .eq('statement_id', stmt.id);

    existingStatement = {
      id: stmt.id,
      // Postgres bigint values arrive as JSON numbers over REST; preserve as exact
      // poisha strings (Hard Rule 2), never through float arithmetic.
      month: stmt.month,
      status: stmt.status,
      file_storage_path: stmt.file_storage_path ?? undefined,
      file_sha256: stmt.file_sha256 ?? undefined,
      statement_total_poisha: String(stmt.statement_total_poisha),
      payable_ids: (pData || []).map(p => p.payable_id),
    };
  }

  function handleMonthChange() {
    void checkExistingStatement();
    uploadPreview = null;
    activeStatement = null;
    statementLines = [];
    coveredEntries = [];
  }

  // --- Step 1: Upload & Parse Preview ---
  function handleFileSelected(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      statementFile = target.files[0];
      errorMessage = null;
    }
  }

  async function handleUploadAndPreview() {
    if (!statementFile) {
      errorMessage = 'Please select a statement file to upload.';
      return;
    }
    if (selectedPayableIds.length === 0) {
      errorMessage = 'Please select at least one covered payable.';
      return;
    }
    if (statementFile.size > 10 * 1024 * 1024) {
      errorMessage = 'File exceeds the 10 MB statement size limit.';
      return;
    }

    actionLoading = true;
    errorMessage = null;
    try {
      const formData = new FormData();
      formData.append('file', statementFile);
      formData.append('month', selectedMonth);

      const res = await authFetch('/api/v1/reconcile/statements/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload.message || errPayload.error || `Upload failed with HTTP ${res.status}`);
      }

      uploadPreview = await res.json();
      successMessage = `Statement parsed successfully (${uploadPreview?.linesCount} lines detected). Review preview and confirm.`;
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Error uploading statement file';
    } finally {
      actionLoading = false;
    }
  }

  /**
   * Maps preview lines to the create_statement / supersede_statement line shape.
   * Plan 005's SQL reads v_line->>'lineDate' / 'reference' / 'grossPoisha' / 'feePoisha'
   * and stores the entire line object as the line's raw payload (PRD §11.3 parity).
   */
  function buildLinePayload(): Array<Record<string, unknown>> {
    if (!uploadPreview) return [];
    return uploadPreview.parsedLines.map(l => ({
      lineDate: l.lineDate,
      reference: l.reference,
      grossPoisha: l.grossPoisha,
      feePoisha: l.feePoisha,
      ...l.raw,
    }));
  }

  // --- Step 2: Confirm & Create Statement ---
  async function handleConfirmStatementCreation() {
    if (!uploadPreview) return;
    actionLoading = true;
    errorMessage = null;
    try {
      const kind = selectedPayableIds.length === 1 ? 'single_payable' : 'combined_card';
      // Merchant settlement total for a provider statement is the fee/MDR sum; it is
      // the amount reconcile_statement compares against entry liability (PRD §11.3).
      const statementTotal = uploadPreview.previewSummary.totalFeePoisha;

      const res = await authFetch('/api/v1/reconcile/statements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          month: selectedMonth,
          source: 'file',
          statementTotalPoisha: statementTotal,
          payableIds: selectedPayableIds,
          fileStoragePath: uploadPreview.path,
          fileSha256: uploadPreview.fileSha256,
          lines: buildLinePayload(),
        }),
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload.message || errPayload.error || `HTTP ${res.status}`);
      }

      const { statementId } = await res.json();
      successMessage = 'Statement registered in ledger. Loading lines and covered entries...';
      uploadPreview = null;
      statementFile = null;

      await loadActiveStatement(statementId);
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Error confirming statement creation';
    } finally {
      actionLoading = false;
    }
  }

  // --- Supersede Existing Statement with a Replacement Upload ---
  async function handleConfirmSupersede() {
    if (!existingStatement || !uploadPreview || supersedeReason.trim().length === 0) return;
    actionLoading = true;
    errorMessage = null;
    try {
      // supersede_statement takes the replacement file's data in a single
      // transaction (PRD §7.3 lines 1178-1192): it archives the original and
      // creates the new statement from the uploaded preview.
      const res = await authFetch('/api/v1/reconcile/statements/supersede', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalStatementId: existingStatement.id,
          statementTotalPoisha: uploadPreview.previewSummary.totalFeePoisha,
          reason: supersedeReason.trim(),
          note: supersedeReason.trim(),
          fileStoragePath: uploadPreview.path,
          fileSha256: uploadPreview.fileSha256,
          lines: buildLinePayload(),
        }),
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload.message || errPayload.error || `HTTP ${res.status}`);
      }

      const { newStatementId } = await res.json();
      supersedeModalOpen = false;
      supersedeReason = '';
      uploadPreview = null;
      statementFile = null;
      successMessage = 'Existing statement superseded; replacement statement created.';

      await loadActiveStatement(newStatementId);
      await checkExistingStatement();
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Error superseding statement';
    } finally {
      actionLoading = false;
    }
  }

  async function loadActiveStatement(statementId: string) {
    loading = true;
    try {
      const { data: stmt, error: sErr } = await supabase
        .from('statements')
        .select('id, month, status, file_storage_path, file_sha256, statement_total_poisha')
        .eq('id', statementId)
        .single();
      if (sErr) throw sErr;

      const { data: pData } = await supabase
        .from('statement_payables')
        .select('payable_id')
        .eq('statement_id', statementId);

      activeStatement = {
        id: stmt.id,
        month: stmt.month,
        status: stmt.status,
        file_storage_path: stmt.file_storage_path ?? undefined,
        file_sha256: stmt.file_sha256 ?? undefined,
        statement_total_poisha: String(stmt.statement_total_poisha),
        payable_ids: (pData || []).map(p => p.payable_id),
      };

      await fetchStatementLines(statementId);
      await fetchCoveredEntries();
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Failed loading active statement details';
    } finally {
      loading = false;
    }
  }

  async function fetchStatementLines(statementId: string) {
    const { data: lines, error: lErr } = await supabase
      .from('statement_lines')
      .select('id, statement_id, line_date, reference, gross_poisha, fee_poisha, match_status, matched_entry_id, review_note')
      .eq('statement_id', statementId)
      .order('created_at');
    if (lErr) throw lErr;
    statementLines = (lines || []).map(l => ({
      id: l.id,
      statement_id: l.statement_id,
      line_date: l.line_date ?? undefined,
      reference: l.reference ?? undefined,
      gross_poisha: String(l.gross_poisha ?? 0),
      fee_poisha: String(l.fee_poisha ?? 0),
      match_status: l.match_status as StatementLineItem['match_status'],
      matched_entry_id: l.matched_entry_id,
      review_note: l.review_note ?? null,
    }));
  }

  /**
   * Timezone-safe Asia/Dhaka month range query preventing last-day-of-month truncation (P0.3).
   * Queries .gte('entry_date', month).lt('entry_date', nextMonth).
   * Coverage liability mirrors perform_statement_auto_match exactly: a vat-kind payable
   * covers vat_poisha, a method_charge payable covers business_charge_poisha on entries
   * whose method_id matches the payable's method_id (PRD §11.3).
   */
  async function fetchCoveredEntries() {
    if (!activeStatement || activeStatement.payable_ids.length === 0) return;

    const [yearStr, monthStr] = activeStatement.month.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const nextYear = month === 12 ? year + 1 : year;
    const nextMonthNum = month === 12 ? 1 : month + 1;
    const nextMonth = `${nextYear}-${String(nextMonthNum).padStart(2, '0')}-01`;

    const { data: entries, error: eErr } = await supabase
      .from('entries')
      .select(`
        id,
        entry_number,
        entry_date,
        customer_name,
        gross_poisha,
        method_id,
        vat_poisha,
        business_charge_poisha,
        txn_ref,
        entry_reconciliation_exceptions (
          id,
          status,
          payable_id
        )
      `)
      .gte('entry_date', activeStatement.month)
      .lt('entry_date', nextMonth)
      .eq('status', 'active')
      .order('entry_date');

    if (eErr) throw eErr;

    // Map matched status against current statement lines
    const matchedEntryIds = new Set(
      statementLines
        .filter(l => l.match_status === 'matched' && l.matched_entry_id)
        .map(l => l.matched_entry_id as string)
    );

    // Resolve covered payables from the local admin cache (id, kind, method_id)
    const payableMap = new Map((await db.payables.toArray()).map(p => [p.id, p]));

    const rows: CandidateEntry[] = [];
    for (const e of entries || []) {
      const exceptions = ((e.entry_reconciliation_exceptions as Array<{ status: string; payable_id: string }> | null) || []);
      for (const payableId of activeStatement.payable_ids) {
        const payable = payableMap.get(payableId);
        if (!payable) continue;
        const liability =
          payable.kind === 'vat'
            ? BigInt(String(e.vat_poisha || 0))
            : payable.method_id && e.method_id === payable.method_id
              ? BigInt(String(e.business_charge_poisha || 0))
              : 0n;
        if (liability <= 0n) continue; // Zero-liability entries are exempt (PRD §11.3)

        const hasApprovedException = exceptions.some(
          ex => ex.status === 'approved' && ex.payable_id === payableId
        );

        rows.push({
          id: e.id,
          entry_number: String(e.entry_number ?? 0),
          entry_date: e.entry_date,
          customer_name: e.customer_name || 'Walk-in',
          gross_poisha: String(e.gross_poisha || 0),
          liability_poisha: liability.toString(),
          applicable_payable_id: payableId,
          txn_ref: e.txn_ref,
          is_matched: matchedEntryIds.has(e.id),
          has_exception: hasApprovedException,
          exception_status: hasApprovedException ? 'approved' : null,
        });
      }
    }
    coveredEntries = rows;
  }

  // --- Manual Matching ---
  function openCandidateModal(line: StatementLineItem) {
    selectedLineForMatch = line;
    candidateSearchQuery = line.reference || '';
    candidateModalOpen = true;
  }

  async function handleSelectEntryMatch(entry: CandidateEntry) {
    if (!selectedLineForMatch) return;
    actionLoading = true;
    errorMessage = null;
    try {
      const res = await authFetch('/api/v1/reconcile/match-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineId: selectedLineForMatch.id,
          entryId: entry.id,
        }),
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload.error || 'Failed to match statement line');
      }

      candidateModalOpen = false;
      selectedLineForMatch = null;
      successMessage = 'Statement line matched successfully.';
      if (activeStatement) {
        await fetchStatementLines(activeStatement.id);
        await fetchCoveredEntries();
      }
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Error matching statement line';
    } finally {
      actionLoading = false;
    }
  }

  // --- Unmatch Modal & Action (No Browser prompt) ---
  function openUnmatchModal(line: StatementLineItem) {
    selectedLineForUnmatch = line;
    unmatchReason = '';
    unmatchModalOpen = true;
  }

  async function handleConfirmUnmatch() {
    if (!selectedLineForUnmatch || unmatchReason.trim().length === 0) return;
    actionLoading = true;
    errorMessage = null;
    try {
      const res = await authFetch('/api/v1/reconcile/unmatch-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineId: selectedLineForUnmatch.id,
          reason: unmatchReason.trim(),
        }),
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload.error || 'Failed to unmatch statement line');
      }

      unmatchModalOpen = false;
      selectedLineForUnmatch = null;
      successMessage = 'Statement line unmatched and reverted to open status.';
      if (activeStatement) {
        await fetchStatementLines(activeStatement.id);
        await fetchCoveredEntries();
      }
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Error unmatching statement line';
    } finally {
      actionLoading = false;
    }
  }

  // --- Accept Unmatched Line Modal & Action ---
  function openAcceptModal(line: StatementLineItem) {
    selectedLineForAccept = line;
    acceptReviewNote = '';
    acceptModalOpen = true;
  }

  async function handleConfirmAccept() {
    if (!selectedLineForAccept || acceptReviewNote.trim().length === 0) return;
    actionLoading = true;
    errorMessage = null;
    try {
      const res = await authFetch('/api/v1/reconcile/accept-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineId: selectedLineForAccept.id,
          reviewNote: acceptReviewNote.trim(),
        }),
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload.error || 'Failed to accept statement line');
      }

      acceptModalOpen = false;
      selectedLineForAccept = null;
      successMessage = 'Statement line accepted into audit log.';
      if (activeStatement) {
        await fetchStatementLines(activeStatement.id);
      }
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Error accepting statement line';
    } finally {
      actionLoading = false;
    }
  }

  // --- Entry Exception Modal & Action ---
  function openExceptionModal(entry: CandidateEntry) {
    selectedEntryForException = entry;
    exceptionReason = '';
    exceptionModalOpen = true;
  }

  async function handleConfirmException() {
    if (!selectedEntryForException) return;
    const targetPayableId = selectedEntryForException.applicable_payable_id || activeStatement?.payable_ids[0];
    if (!targetPayableId || exceptionReason.trim().length === 0) return;
    actionLoading = true;
    errorMessage = null;
    try {
      const res = await authFetch('/api/v1/reconcile/exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryId: selectedEntryForException.id,
          payableId: targetPayableId,
          action: 'approved',
          reason: exceptionReason.trim(),
        }),
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload.error || 'Failed to approve entry reconciliation exception');
      }

      exceptionModalOpen = false;
      selectedEntryForException = null;
      successMessage = 'Reconciliation exception approved for entry.';
      await fetchCoveredEntries();
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Error approving entry reconciliation exception';
    } finally {
      actionLoading = false;
    }
  }

  // --- Finalize Statement Reconciliation ---
  async function handleFinalizeReconcile() {
    if (!activeStatement || !canFinalizeReconciliation) return;
    actionLoading = true;
    errorMessage = null;
    try {
      const res = await authFetch('/api/v1/reconcile/statements/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statementId: activeStatement.id,
          // Omit the key when blank: the route's schema is `z.string().optional()`
          // and rejects an explicit null with 400 invalid_payload.
          ...(reconcileNote.trim() ? { note: reconcileNote.trim() } : {}),
        }),
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload.error || errPayload.message || 'Failed to reconcile statement');
      }

      successMessage = 'Statement reconciled successfully!';
      activeStatement = { ...activeStatement, status: 'reconciled' };
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Failed to reconcile statement';
    } finally {
      actionLoading = false;
    }
  }
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
  <!-- Header & Navigation -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-black/10 dark:border-white/10 pb-4">
    <div>
      <div class="flex items-center gap-2 text-xs text-[var(--c-muted,#6b7280)] mb-1">
        <a href="/reconcile" class="hover:underline">Reconciliation</a>
        <span>/</span>
        <span class="text-[var(--c-ink,#111827)]">Mode B Upload</span>
      </div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--c-ink,#111827)]">File-Based Reconciliation (Mode B)</h1>
      <p class="text-xs text-[var(--c-muted,#6b7280)] mt-1">
        Upload bank or gateway CSV statements, auto-match against ledger entries, and resolve discrepancies.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <Button variant="default" class="min-h-[44px]" onclick={() => goto('/reconcile')}>
        &larr; Back to Overview
      </Button>
    </div>
  </div>

  <!-- Global Alert Banners -->
  {#if errorMessage}
    <div role="alert" class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm flex items-start gap-3">
      <span class="font-bold">Error:</span>
      <span class="flex-1">{errorMessage}</span>
      <button type="button" class="text-xs underline" onclick={() => { errorMessage = null; }}>Dismiss</button>
    </div>
  {/if}

  {#if successMessage}
    <div role="status" class="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-sm flex items-start gap-3">
      <span class="font-bold">Success:</span>
      <span class="flex-1">{successMessage}</span>
      <button type="button" class="text-xs underline" onclick={() => { successMessage = null; }}>Dismiss</button>
    </div>
  {/if}

  {#if loading}
    <Card class="p-8 text-center text-[var(--c-muted,#6b7280)] text-sm">Loading...</Card>
  {:else if !activeStatement}
    <!-- Section: Step 1 Upload Statement File -->
    <Card class="p-5 sm:p-6 space-y-5">
      <div class="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-3">
        <h2 class="text-lg font-semibold text-[var(--c-ink,#111827)]">1. Select Statement File &amp; Coverage</h2>
        <span class="text-xs font-mono px-2 py-1 bg-black/5 dark:bg-white/10 rounded text-[var(--c-muted,#6b7280)]">Step 1 of 2</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <!-- Month Picker -->
        <div>
          <label for="month-select" class="block text-xs font-semibold text-[var(--c-ink,#111827)] uppercase tracking-wider mb-1">
            Statement Month
          </label>
          <input
            id="month-select"
            type="month"
            bind:value={selectedMonthInput}
            onchange={handleMonthChange}
            class="w-full min-h-[44px] px-3 text-sm rounded-xl border border-black/10 bg-white/70 text-[var(--c-ink,#111827)]"
          />
          <p class="text-[11px] text-[var(--c-muted,#6b7280)] mt-1">Normalized to {selectedMonth}</p>
        </div>

        <!-- Covered Payables Multi-Select -->
        <div>
          <label for="payables-select" class="block text-xs font-semibold text-[var(--c-ink,#111827)] uppercase tracking-wider mb-1">
            Covered Payables
          </label>
          <select
            id="payables-select"
            multiple
            bind:value={selectedPayableIds}
            class="w-full h-24 p-2 text-sm rounded-xl border border-black/10 bg-white/70 text-[var(--c-ink,#111827)]"
          >
            {#each payables as p (p.id)}
              <option value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>
            {/each}
          </select>
          <p class="text-[11px] text-[var(--c-muted,#6b7280)] mt-1">Hold Ctrl/Cmd to select multiple payables for combined card statements.</p>
        </div>
      </div>

      <!-- Existing Statement Alert -->
      {#if existingStatement && !uploadPreview}
        <div class="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between gap-4">
          <div>
            <p class="font-semibold">An existing {existingStatement.status} statement already exists for {selectedMonth}.</p>
            <p class="mt-0.5 opacity-80">
              To replace it, upload the replacement file first, then confirm supersede with the new file's parsed data.
            </p>
          </div>
        </div>
      {/if}

      <!-- File Upload Input -->
      <input
        id="file-upload-input"
        type="file"
        accept=".csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
        onchange={handleFileSelected}
        class="hidden"
      />
      <label for="file-upload-input" class="cursor-pointer block border-2 border-dashed border-black/15 rounded-2xl p-6 text-center space-y-2 hover:border-[var(--brand,#3b82f6)] transition-colors">
        <div class="text-3xl text-[var(--c-muted,#6b7280)]">&uarr;</div>
        <div class="text-sm font-medium text-[var(--c-ink,#111827)]">
          {#if statementFile}
            <span class="font-semibold">{statementFile.name}</span> ({(statementFile.size / 1024).toFixed(1)} KB)
          {:else}
            Click to browse or drop statement CSV file here
          {/if}
        </div>
        <p class="text-xs text-[var(--c-muted,#6b7280)]">Supports bKash Merchant CSV and Combined Card Settlement CSV up to 10 MB</p>
      </label>

      <div class="flex justify-end pt-2">
        <Button
          variant="commission"
          class="min-h-[44px]"
          onclick={handleUploadAndPreview}
          disabled={!statementFile || actionLoading || selectedPayableIds.length === 0}
          loading={actionLoading}
        >
          {actionLoading ? 'Uploading & Parsing...' : 'Upload & Preview Statement'}
        </Button>
      </div>
    </Card>

    <!-- Upload Preview Summary & Confirmation Card -->
    {#if uploadPreview}
      <Card class="p-5 sm:p-6 space-y-5">
        <div class="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-3">
          <div>
            <h2 class="text-lg font-semibold text-[var(--c-ink,#111827)]">2. Preview &amp; Confirm Ingestion</h2>
            <p class="text-xs text-[var(--c-muted,#6b7280)] mt-0.5">
              Adapter detected: <span class="font-mono font-medium text-[var(--c-ink,#111827)]">{uploadPreview.detectedAdapter}</span>
            </p>
          </div>
          <span class="text-xs font-mono px-2 py-1 bg-blue-500/10 text-blue-600 rounded font-semibold">
            Preview Ready
          </span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div class="p-3 rounded-xl">
            <span class="block text-[11px] uppercase tracking-wider text-[var(--c-muted,#6b7280)]">Total Lines</span>
            <span class="text-lg font-bold font-mono text-[var(--c-ink,#111827)]">{uploadPreview.linesCount}</span>
          </div>
          <div class="p-3 rounded-xl">
            <span class="block text-[11px] uppercase tracking-wider text-[var(--c-muted,#6b7280)]">Total Gross</span>
            <span class="text-lg font-bold font-mono text-[var(--c-ink,#111827)]">
              ৳{formatPoishaToBdt(BigInt(uploadPreview.previewSummary.totalGrossPoisha || '0'))}
            </span>
          </div>
          <div class="p-3 rounded-xl">
            <span class="block text-[11px] uppercase tracking-wider text-[var(--c-muted,#6b7280)]">Total Fee / MDR</span>
            <span class="text-lg font-bold font-mono text-[var(--c-ink,#111827)]">
              ৳{formatPoishaToBdt(BigInt(uploadPreview.previewSummary.totalFeePoisha || '0'))}
            </span>
          </div>
          <div class="p-3 rounded-xl">
            <span class="block text-[11px] uppercase tracking-wider text-[var(--c-muted,#6b7280)]">Date Span</span>
            <span class="text-xs font-mono text-[var(--c-ink,#111827)] mt-1 block">
              {uploadPreview.previewSummary.minDate || '—'} to {uploadPreview.previewSummary.maxDate || '—'}
            </span>
          </div>
        </div>

        <!-- Sample Lines Table -->
        <div>
          <h3 class="text-xs font-semibold text-[var(--c-muted,#6b7280)] uppercase tracking-wider mb-2">First 5 Sample Lines</h3>
          <div class="overflow-x-auto border border-black/10 rounded-xl">
            <table class="w-full text-left text-xs">
              <thead class="bg-black/5 dark:bg-white/10 text-[var(--c-muted,#6b7280)] uppercase font-semibold">
                <tr>
                  <th class="p-2.5">Line #</th>
                  <th class="p-2.5">Date</th>
                  <th class="p-2.5">Reference</th>
                  <th class="p-2.5 text-right">Gross (BDT)</th>
                  <th class="p-2.5 text-right">Fee (BDT)</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-black/10 font-mono text-[var(--c-ink,#111827)]">
                {#each uploadPreview.parsedLines.slice(0, 5) as line (line.lineIndex)}
                  <tr>
                    <td class="p-2.5">{line.lineIndex}</td>
                    <td class="p-2.5">{line.lineDate || '—'}</td>
                    <td class="p-2.5">{line.reference || '—'}</td>
                    <td class="p-2.5 text-right">৳{formatPoishaToBdt(BigInt(line.grossPoisha || '0'))}</td>
                    <td class="p-2.5 text-right">৳{formatPoishaToBdt(BigInt(line.feePoisha || '0'))}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>

        {#if existingStatement}
          <div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs">
            Confirming this upload will <strong>supersede</strong> the existing {existingStatement.status} statement
            and create the replacement from these parsed lines (single audited transaction).
          </div>
        {/if}

        <div class="flex items-center justify-end gap-3 pt-3 border-t border-black/10 dark:border-white/10">
          <Button variant="default" class="min-h-[44px]" onclick={() => { uploadPreview = null; }}>
            Discard &amp; Re-upload
          </Button>
          {#if existingStatement}
            <Button
              variant="mastercard"
              class="min-h-[44px]"
              id="btn-supersede"
              onclick={() => { supersedeReason = ''; supersedeModalOpen = true; }}
              disabled={actionLoading}
              loading={actionLoading}
            >
              Supersede &amp; Create Statement
            </Button>
          {:else}
            <Button
              variant="commission"
              class="min-h-[44px]"
              id="btn-confirm-upload-statement"
              onclick={handleConfirmStatementCreation}
              disabled={actionLoading}
              loading={actionLoading}
            >
              Confirm &amp; Save Statement
            </Button>
          {/if}
        </div>
      </Card>
    {/if}
  {:else}
    <!-- Active Statement Working Area -->
    <div class="space-y-6">
      <!-- Summary Bar -->
      <Card class="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs uppercase font-semibold tracking-wider text-[var(--c-muted,#6b7280)]">Statement Month:</span>
            <span class="font-mono font-bold text-sm text-[var(--c-ink,#111827)]">{activeStatement.month}</span>
            <span class="px-2 py-0.5 text-[11px] rounded font-semibold uppercase font-mono bg-blue-500/10 text-blue-600">
              {activeStatement.status}
            </span>
          </div>
          <div class="text-xs text-[var(--c-muted,#6b7280)] mt-1 flex items-center gap-3">
            <span>Lines: <strong class="text-[var(--c-ink,#111827)] font-mono">{statementLines.length}</strong></span>
            <span>Matched: <strong class="text-emerald-600 font-mono">{matchedLinesCount}</strong></span>
            <span>Accepted: <strong class="text-blue-600 font-mono">{acceptedLinesCount}</strong></span>
            <span>Unmatched: <strong class="text-amber-600 font-mono">{unmatchedLinesCount}</strong></span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <Button variant="default" class="min-h-[44px]" onclick={() => { activeStatement = null; }}>
            Switch Statement
          </Button>
        </div>
      </Card>

      <!-- Section: Statement Lines Review & Matching Table -->
      <Card class="p-5 sm:p-6 space-y-4">
        <div class="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-3">
          <div>
            <h2 class="text-lg font-semibold text-[var(--c-ink,#111827)]">Statement Lines Review</h2>
            <p class="text-xs text-[var(--c-muted,#6b7280)] mt-0.5">
              Match each line to an active ledger entry or mark as accepted with a review note.
            </p>
          </div>
          <div class="flex gap-1.5" role="group" aria-label="Filter statement lines by status">
            {#each ['all', 'unmatched', 'matched', 'accepted'] as f (f)}
              <button
                type="button"
                aria-pressed={lineFilter === f}
                onclick={() => { lineFilter = f as 'all' | 'unmatched' | 'matched' | 'accepted'; }}
                class="px-2.5 py-1 text-[11px] uppercase font-semibold rounded-lg min-h-[36px] {lineFilter === f
                  ? 'bg-[var(--brand,#3b82f6)] text-white'
                  : 'bg-black/5 dark:bg-white/10 text-[var(--c-muted,#6b7280)]'}"
              >
                {f}
              </button>
            {/each}
          </div>
        </div>

        <div class="overflow-x-auto border border-black/10 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-black/5 dark:bg-white/10 text-[var(--c-muted,#6b7280)] uppercase font-semibold">
              <tr>
                <th class="p-2.5">Line #</th>
                <th class="p-2.5">Date</th>
                <th class="p-2.5">Reference</th>
                <th class="p-2.5 text-right">Gross (BDT)</th>
                <th class="p-2.5 text-right">Fee (BDT)</th>
                <th class="p-2.5">Status</th>
                <th class="p-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-black/10 font-mono text-[var(--c-ink,#111827)]">
              {#each filteredStatementLines as line, idx (line.id)}
                <tr class="hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors">
                  <td class="p-2.5">{idx + 1}</td>
                  <td class="p-2.5">{line.line_date || '—'}</td>
                  <td class="p-2.5 font-bold">{line.reference || '—'}</td>
                  <td class="p-2.5 text-right font-medium">৳{formatPoishaToBdt(BigInt(line.gross_poisha || '0'))}</td>
                  <td class="p-2.5 text-right font-medium">৳{formatPoishaToBdt(BigInt(line.fee_poisha || '0'))}</td>
                  <td class="p-2.5">
                    {#if line.match_status === 'matched'}
                      <span class="px-2 py-0.5 text-[10px] rounded bg-emerald-500/10 text-emerald-700 font-bold uppercase">Matched</span>
                    {:else if line.match_status === 'accepted'}
                      <span class="px-2 py-0.5 text-[10px] rounded bg-blue-500/10 text-blue-600 font-bold uppercase">Accepted</span>
                    {:else}
                      <span class="px-2 py-0.5 text-[10px] rounded bg-amber-500/10 text-amber-600 font-bold uppercase">Unmatched</span>
                    {/if}
                  </td>
                  <td class="p-2.5 text-right">
                    <div class="flex items-center justify-end gap-1.5 font-sans">
                      {#if line.match_status === 'unmatched'}
                        <Button
                          variant="default"
                          class="text-xs py-1 min-h-[36px]"
                          onclick={() => openCandidateModal(line)}
                          disabled={actionLoading}
                        >
                          Match
                        </Button>
                        <Button
                          variant="default"
                          class="text-xs py-1 min-h-[36px]"
                          onclick={() => openAcceptModal(line)}
                          disabled={actionLoading}
                        >
                          Accept
                        </Button>
                      {:else if line.match_status === 'matched'}
                        <Button
                          variant="mastercard"
                          class="text-xs py-1 min-h-[36px]"
                          onclick={() => openUnmatchModal(line)}
                          disabled={actionLoading}
                        >
                          Unmatch
                        </Button>
                      {/if}
                    </div>
                  </td>
                </tr>
              {:else}
                <tr><td colspan="7" class="p-4 text-center text-[var(--c-muted,#6b7280)] font-sans">No lines for this filter.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </Card>

      <!-- Section: Entry-Side Review Table (PRD §11.3 Item 5) -->
      <Card class="p-5 sm:p-6 space-y-4">
        <div class="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-3">
          <div>
            <h2 class="text-lg font-semibold text-[var(--c-ink,#111827)]">Covered Ledger Entries Review (PRD §11.3)</h2>
            <p class="text-xs text-[var(--c-muted,#6b7280)] mt-0.5">
              All active entries generating liability for covered payables must be matched or have approved reconciliation exceptions.
            </p>
          </div>
          <span class="text-xs font-mono text-[var(--c-muted,#6b7280)]">
            {coveredEntries.length} covered
          </span>
        </div>

        <div class="overflow-x-auto border border-black/10 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-black/5 dark:bg-white/10 text-[var(--c-muted,#6b7280)] uppercase font-semibold">
              <tr>
                <th class="p-2.5">Entry #</th>
                <th class="p-2.5">Date</th>
                <th class="p-2.5">Customer</th>
                <th class="p-2.5 text-right">Gross (BDT)</th>
                <th class="p-2.5 text-right">Liability (BDT)</th>
                <th class="p-2.5">Status</th>
                <th class="p-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-black/10 font-mono text-[var(--c-ink,#111827)]">
              {#each coveredEntries as entry (entry.id + (entry.applicable_payable_id || ''))}
                <tr class="hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors">
                  <td class="p-2.5 font-bold">{entry.entry_number}</td>
                  <td class="p-2.5">{entry.entry_date}</td>
                  <td class="p-2.5 font-sans">{entry.customer_name}</td>
                  <td class="p-2.5 text-right">৳{formatPoishaToBdt(BigInt(entry.gross_poisha || '0'))}</td>
                  <td class="p-2.5 text-right">৳{formatPoishaToBdt(BigInt(entry.liability_poisha || '0'))}</td>
                  <td class="p-2.5">
                    {#if entry.is_matched}
                      <span class="px-2 py-0.5 text-[10px] rounded bg-emerald-500/10 text-emerald-700 font-bold uppercase">Matched</span>
                    {:else if entry.has_exception}
                      <span class="px-2 py-0.5 text-[10px] rounded bg-blue-500/10 text-blue-600 font-bold uppercase">Exception Approved</span>
                    {:else}
                      <span class="px-2 py-0.5 text-[10px] rounded bg-red-500/10 text-red-600 font-bold uppercase">Unmatched</span>
                    {/if}
                  </td>
                  <td class="p-2.5 text-right font-sans">
                    {#if !entry.is_matched && !entry.has_exception}
                      <Button
                        variant="default"
                        class="text-xs py-1 min-h-[36px]"
                        onclick={() => openExceptionModal(entry)}
                        disabled={actionLoading}
                      >
                        Approve Exception
                      </Button>
                    {/if}
                  </td>
                </tr>
              {:else}
                <tr><td colspan="7" class="p-4 text-center text-[var(--c-muted,#6b7280)] font-sans">No covered entries for the selected payables in this month.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </Card>

      <!-- Section: Finalize Reconciliation Card -->
      <Card class="p-5 sm:p-6 space-y-4">
        <div class="border-b border-black/10 dark:border-white/10 pb-3">
          <h2 class="text-lg font-semibold text-[var(--c-ink,#111827)]">Finalize Statement Reconciliation</h2>
          <p class="text-xs text-[var(--c-muted,#6b7280)] mt-0.5">
            Verify totals, inspect tolerance variance, and close the reconciliation.
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="p-3 rounded-xl">
            <span class="block text-[11px] uppercase tracking-wider text-[var(--c-muted,#6b7280)]">Statement Total Fee</span>
            <span class="text-lg font-bold font-mono text-[var(--c-ink,#111827)]">
              ৳{formatPoishaToBdt(statementTotalFeePoisha)}
            </span>
          </div>
          <div class="p-3 rounded-xl">
            <span class="block text-[11px] uppercase tracking-wider text-[var(--c-muted,#6b7280)]">Total Entry Liability</span>
            <span class="text-lg font-bold font-mono text-[var(--c-ink,#111827)]">
              ৳{formatPoishaToBdt(coveredEntriesTotalLiabilityPoisha)}
            </span>
          </div>
          <div class="p-3 rounded-xl">
            <span class="block text-[11px] uppercase tracking-wider text-[var(--c-muted,#6b7280)]">Variance</span>
            <span class="text-lg font-bold font-mono {varianceWithinTolerance ? 'text-emerald-600' : 'text-amber-600'}">
              ৳{formatPoishaToBdt(variancePoisha)}
              <span class="text-xs font-normal font-sans ml-1">
                ({varianceWithinTolerance ? 'within tolerance' : 'exceeds tolerance'})
              </span>
            </span>
          </div>
        </div>

        {#if !varianceWithinTolerance}
          <div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs">
            <p class="font-semibold">Variance exceeds tolerance ({formatPoishaToBdt(tolerancePoisha)}).</p>
            <p class="mt-0.5">
              A mandatory reconciliation note is required explaining the variance before closing this statement.
            </p>
          </div>
          <div>
            <label for="reconcile-note" class="block text-xs font-semibold text-[var(--c-ink,#111827)] uppercase tracking-wider mb-1">
              Reconciliation Note (Mandatory)
            </label>
            <textarea
              id="reconcile-note"
              bind:value={reconcileNote}
              rows="2"
              placeholder="Enter justification for fee variance..."
              class="w-full p-2.5 text-xs rounded-xl border border-black/10 bg-white/70 text-[var(--c-ink,#111827)]"
            ></textarea>
          </div>
        {/if}

        <div class="flex items-center justify-between pt-3 border-t border-black/10 dark:border-white/10">
          <div class="text-xs text-[var(--c-muted,#6b7280)] font-sans">
            {#if activeStatement.status !== 'open'}
              Statement already {activeStatement.status}.
            {:else if unmatchedLinesCount > 0}
              <span class="text-amber-600 font-semibold">{unmatchedLinesCount} statement lines</span> still unmatched.
            {:else if unmatchedCoveredEntriesCount > 0}
              <span class="text-amber-600 font-semibold">{unmatchedCoveredEntriesCount} covered entries</span> still unmatched.
            {:else}
              <span class="text-emerald-600 font-semibold">All completion criteria satisfied.</span>
            {/if}
          </div>

          <Button
            variant="commission"
            class="min-h-[44px]"
            id="btn-finalize-reconcile"
            onclick={handleFinalizeReconcile}
            disabled={!canFinalizeReconciliation || actionLoading || activeStatement.status !== 'open'}
            loading={actionLoading}
          >
            Reconcile Statement
          </Button>
        </div>
      </Card>
    </div>
  {/if}
</div>

<!-- Modal: Candidate Entry Picker for Line Matching -->
<Modal bind:open={candidateModalOpen} title="Match Statement Line to Ledger Entry" onclose={() => { candidateModalOpen = false; }}>
  {#if selectedLineForMatch}
    <div class="p-1 space-y-4">
      <div class="p-3 rounded-xl text-xs">
        <p><span class="text-[var(--c-muted,#6b7280)]">Line Reference:</span> <strong class="font-mono text-[var(--c-ink,#111827)]">{selectedLineForMatch.reference || 'None'}</strong></p>
        <p class="mt-1"><span class="text-[var(--c-muted,#6b7280)]">Line Gross:</span> <strong class="font-mono text-[var(--c-ink,#111827)]">৳{formatPoishaToBdt(BigInt(selectedLineForMatch.gross_poisha || '0'))}</strong></p>
      </div>

      <div>
        <label for="candidate-search" class="block text-xs font-semibold text-[var(--c-ink,#111827)] uppercase tracking-wider mb-1">
          Search Candidate Entries
        </label>
        <input
          id="candidate-search"
          type="text"
          bind:value={candidateSearchQuery}
          placeholder="Filter by entry number, ref, or customer..."
          class="w-full min-h-[44px] px-3 text-xs rounded-xl border border-black/10 bg-white/70 text-[var(--c-ink,#111827)]"
        />
      </div>

      <div class="max-h-60 overflow-y-auto border border-black/10 rounded-xl divide-y divide-black/10">
        {#if filteredCandidates.length === 0}
          <div class="p-4 text-center text-xs text-[var(--c-muted,#6b7280)]">No candidate entries found matching query.</div>
        {:else}
          {#each filteredCandidates as cand (cand.id + (cand.applicable_payable_id || ''))}
            <div class="p-3 flex items-center justify-between hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors">
              <div class="text-xs">
                <div class="font-mono font-bold text-[var(--c-ink,#111827)]">{cand.entry_number}</div>
                <div class="text-[var(--c-muted,#6b7280)]">{cand.entry_date} &bull; {cand.customer_name}</div>
                <div class="font-mono text-[11px] text-[var(--brand,#3b82f6)]">৳{formatPoishaToBdt(BigInt(cand.gross_poisha || '0'))}</div>
              </div>
              <Button
                variant="commission"
                class="text-xs py-1 min-h-[36px]"
                onclick={() => handleSelectEntryMatch(cand)}
                disabled={actionLoading}
              >
                Select
              </Button>
            </div>
          {/each}
        {/if}
      </div>

      <div class="flex justify-end pt-2">
        <Button variant="default" class="min-h-[44px]" onclick={() => { candidateModalOpen = false; }}>
          Cancel
        </Button>
      </div>
    </div>
  {/if}
</Modal>

<!-- Modal: Unmatch Reason (Eliminating browser prompt) -->
<Modal bind:open={unmatchModalOpen} title="Unmatch Statement Line" onclose={() => { unmatchModalOpen = false; }}>
  <div class="p-1 space-y-4">
    <p class="text-xs text-[var(--c-muted,#6b7280)]">
      Unmatching this statement line will sever its link to the ledger entry and revert the statement status to open.
    </p>
    <div>
      <label for="unmatch-reason-input" class="block text-xs font-semibold text-[var(--c-ink,#111827)] uppercase tracking-wider mb-1">
        Reason for Unmatching (Mandatory)
      </label>
      <input
        id="unmatch-reason-input"
        type="text"
        bind:value={unmatchReason}
        placeholder="e.g. Inadvertent match, duplicate line reference..."
        class="w-full min-h-[44px] px-3 text-xs rounded-xl border border-black/10 bg-white/70 text-[var(--c-ink,#111827)]"
      />
    </div>
    <div class="flex justify-end gap-2 pt-2">
      <Button variant="default" class="min-h-[44px]" onclick={() => { unmatchModalOpen = false; }}>
        Cancel
      </Button>
      <Button
        variant="mastercard"
        class="min-h-[44px]"
        id="btn-confirm-unmatch"
        onclick={handleConfirmUnmatch}
        disabled={actionLoading || unmatchReason.trim().length === 0}
        loading={actionLoading}
      >
        Confirm Unmatch
      </Button>
    </div>
  </div>
</Modal>

<!-- Modal: Accept Unmatched Line Review Note -->
<Modal bind:open={acceptModalOpen} title="Accept Unmatched Statement Line" onclose={() => { acceptModalOpen = false; }}>
  <div class="p-1 space-y-4">
    <p class="text-xs text-[var(--c-muted,#6b7280)]">
      Accepting an unmatched statement line logs the line into the audit trail as recognized without a corresponding ledger entry (e.g. gateway annual charge, fee adjustment).
    </p>
    <div>
      <label for="accept-note-input" class="block text-xs font-semibold text-[var(--c-ink,#111827)] uppercase tracking-wider mb-1">
        Review Note (Mandatory)
      </label>
      <textarea
        id="accept-note-input"
        bind:value={acceptReviewNote}
        rows="3"
        placeholder="e.g. Bank monthly account maintenance fee per statement..."
        class="w-full p-2.5 text-xs rounded-xl border border-black/10 bg-white/70 text-[var(--c-ink,#111827)]"
      ></textarea>
    </div>
    <div class="flex justify-end gap-2 pt-2">
      <Button variant="default" class="min-h-[44px]" onclick={() => { acceptModalOpen = false; }}>
        Cancel
      </Button>
      <Button
        variant="commission"
        class="min-h-[44px]"
        id="btn-confirm-accept"
        onclick={handleConfirmAccept}
        disabled={actionLoading || acceptReviewNote.trim().length === 0}
        loading={actionLoading}
      >
        Accept Line
      </Button>
    </div>
  </div>
</Modal>

<!-- Modal: Approve Entry Exception -->
<Modal bind:open={exceptionModalOpen} title="Approve Reconciliation Exception" onclose={() => { exceptionModalOpen = false; }}>
  {#if selectedEntryForException}
    <div class="p-1 space-y-4">
      <div class="p-3 rounded-xl text-xs font-mono">
        <p><span class="text-[var(--c-muted,#6b7280)]">Entry:</span> <strong>{selectedEntryForException.entry_number}</strong></p>
        <p class="mt-1"><span class="text-[var(--c-muted,#6b7280)]">Gross:</span> ৳{formatPoishaToBdt(BigInt(selectedEntryForException.gross_poisha || '0'))}</p>
      </div>
      <div>
        <label for="exception-reason-input" class="block text-xs font-semibold text-[var(--c-ink,#111827)] uppercase tracking-wider mb-1">
          Exception Reason (Mandatory)
        </label>
        <textarea
          id="exception-reason-input"
          bind:value={exceptionReason}
          rows="3"
          placeholder="e.g. Transaction settled outside reporting window, verified manually..."
          class="w-full p-2.5 text-xs rounded-xl border border-black/10 bg-white/70 text-[var(--c-ink,#111827)]"
        ></textarea>
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <Button variant="default" class="min-h-[44px]" onclick={() => { exceptionModalOpen = false; }}>
          Cancel
        </Button>
        <Button
          variant="commission"
          class="min-h-[44px]"
          id="btn-confirm-exception"
          onclick={handleConfirmException}
          disabled={actionLoading || exceptionReason.trim().length === 0}
          loading={actionLoading}
        >
          Approve Exception
        </Button>
      </div>
    </div>
  {/if}
</Modal>

<!-- Modal: Supersede Statement -->
<Modal bind:open={supersedeModalOpen} title="Supersede Existing Statement" onclose={() => { supersedeModalOpen = false; }}>
  <div class="p-1 space-y-4">
    <p class="text-xs text-[var(--c-muted,#6b7280)]">
      Superseding archives the current statement in the audit log and creates the replacement statement from the uploaded preview's parsed lines (single audited transaction).
    </p>
    <div>
      <label for="supersede-reason-input" class="block text-xs font-semibold text-[var(--c-ink,#111827)] uppercase tracking-wider mb-1">
        Reason for Superseding (Mandatory)
      </label>
      <input
        id="supersede-reason-input"
        type="text"
        bind:value={supersedeReason}
        placeholder="e.g. Corrupt CSV export, wrong date filter applied..."
        class="w-full min-h-[44px] px-3 text-xs rounded-xl border border-black/10 bg-white/70 text-[var(--c-ink,#111827)]"
      />
    </div>
    <div class="flex justify-end gap-2 pt-2">
      <Button variant="default" class="min-h-[44px]" onclick={() => { supersedeModalOpen = false; }}>
        Cancel
      </Button>
      <Button
        variant="mastercard"
        class="min-h-[44px]"
        id="btn-confirm-supersede"
        onclick={handleConfirmSupersede}
        disabled={actionLoading || supersedeReason.trim().length === 0 || !uploadPreview}
        loading={actionLoading}
      >
        Confirm Supersede
      </Button>
    </div>
  </div>
</Modal>
