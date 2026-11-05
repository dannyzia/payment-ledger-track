import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import type { Database } from '$lib/database.types';

const supersedeSchema = z.object({
  originalStatementId: z.string().uuid(),
  statementTotalPoisha: z.string().regex(/^\d+$/),
  reason: z.string().min(1),
  note: z.string().optional(),
  fileStoragePath: z.string().optional().nullable(),
  fileSha256: z.string().length(64).optional().nullable(),
  lines: z.array(z.unknown()).optional().nullable(),
});

/**
 * POST /api/v1/reconcile/statements/supersede
 * Supersedes a statement via supersede_statement under service_role.
 */
export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized', reason: 'Admin or Owner required' }), { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json', message: 'Malformed JSON payload' }), { status: 400 });
  }

  const parsed = supersedeSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  // Postgres bigint param (generated types say `number`), CLT-D-018 convention (Plan 014): 15-digit
  // guard because Number stays exact below 2^53 (Rule 2: regex ^\d+$ already guarantees an integer string).
  const totalNumber = Number(parsed.data.statementTotalPoisha);
  if (parsed.data.statementTotalPoisha.length > 15 || !Number.isSafeInteger(totalNumber) || totalNumber < 0) {
    return new Response(JSON.stringify({ error: 'invalid_amount', message: 'statementTotalPoisha must be a non-negative integer poisha string' }), { status: 400 });
  }

  const supabase = getServiceSupabase();

  // Plan 005 supersede_statement has 7 parameters:
  // (p_original_statement_id, p_file_storage_path, p_file_sha256, p_statement_total_poisha, p_note, p_lines, p_actor_id)
  const rpcArgs = {
    p_original_statement_id: parsed.data.originalStatementId,
    p_file_storage_path: parsed.data.fileStoragePath ?? null,
    p_file_sha256: parsed.data.fileSha256 ?? null,
    p_statement_total_poisha: totalNumber,
    p_note: parsed.data.note ?? parsed.data.reason,
    p_lines: parsed.data.lines ?? null,
    p_actor_id: caller.userId,
  };
  const { data, error: rpcError } = await supabase.rpc('supersede_statement', rpcArgs as unknown as Database['public']['Functions']['supersede_statement']['Args']);

  if (rpcError) {
    return new Response(JSON.stringify({ error: rpcError.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true, newStatementId: data }), { status: 200 });
};
