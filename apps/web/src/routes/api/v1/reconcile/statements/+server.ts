import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import type { Database } from '$lib/database.types';

const createStatementSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  kind: z.enum(['single_payable', 'combined_card']),
  source: z.enum(['manual_total', 'file']),
  statementTotalPoisha: z.string().regex(/^\d+$/),
  payableIds: z.array(z.string().uuid()).min(1),
  fileStoragePath: z.string().optional().nullable(),
  fileSha256: z.string().length(64).optional().nullable(),
  lines: z.array(z.unknown()).optional().nullable(),
});

/**
 * POST /api/v1/reconcile/statements
 * Creates a statement row via create_statement under service_role.
 */
export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(
      JSON.stringify({ error: 'unauthorized', reason: 'Admin or Owner required' }),
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_json', message: 'Malformed JSON payload' }),
      { status: 400 },
    );
  }

  const parsed = createStatementSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
    });
  }

  // Postgres bigint param (generated types say `number`), CLT-D-018 convention (Plan 014): 15-digit
  // guard because Number stays exact below 2^53 (Rule 2: regex ^\d+$ already guarantees an integer string).
  const totalNumber = Number(parsed.data.statementTotalPoisha);
  if (
    parsed.data.statementTotalPoisha.length > 15 ||
    !Number.isSafeInteger(totalNumber) ||
    totalNumber < 0
  ) {
    return new Response(
      JSON.stringify({
        error: 'invalid_amount',
        message: 'statementTotalPoisha must be a non-negative integer poisha string',
      }),
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();

  // Plan 005 create_statement has 9 parameters:
  // (p_kind, p_month, p_source, p_file_storage_path, p_file_sha256, p_statement_total_poisha, p_payable_ids, p_lines, p_actor_id)
  const rpcArgs = {
    p_kind: parsed.data.kind,
    p_month: parsed.data.month,
    p_source: parsed.data.source,
    p_file_storage_path: parsed.data.fileStoragePath ?? null,
    p_file_sha256: parsed.data.fileSha256 ?? null,
    p_statement_total_poisha: totalNumber,
    p_payable_ids: parsed.data.payableIds,
    p_lines: parsed.data.lines ?? null,
    p_actor_id: caller.userId,
  };
  const { data, error: rpcError } = await supabase.rpc(
    'create_statement',
    rpcArgs as unknown as Database['public']['Functions']['create_statement']['Args'],
  );

  if (rpcError) {
    return new Response(JSON.stringify({ error: rpcError.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true, statementId: data }), { status: 200 });
};
