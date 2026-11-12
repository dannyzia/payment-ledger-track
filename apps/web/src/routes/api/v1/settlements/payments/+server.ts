import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import type { Database } from '$lib/database.types';

const paymentSchema = z.object({
  settlementId: z.string().uuid(),
  amountPoisha: z.string().regex(/^\d+$/),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reference: z.string().optional().nullable(),
  receiptPath: z.string().optional().nullable(),
  receiptStoragePath: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  isReversal: z.boolean().optional(),
  reversesId: z.string().uuid().optional().nullable(),
  reversesPaymentId: z.string().uuid().optional().nullable(),
});

/**
 * POST /api/v1/settlements/payments
 * Records a settlement payment or reversal row under service_role.
 */
export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(
      JSON.stringify({ error: 'unauthorized', reason: 'Admin or Owner required' }),
      { status: 403 },
    );
  }

  const centerId = caller.centerId;
  if (!centerId) {
    return new Response(JSON.stringify({ error: 'missing_center_id' }), { status: 400 });
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

  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
    });
  }

  const effectiveReceiptPath = parsed.data.receiptPath ?? parsed.data.receiptStoragePath ?? null;
  const effectiveReversesId = parsed.data.reversesId ?? parsed.data.reversesPaymentId ?? null;

  // Postgres bigint param (generated types say `number`). Serialized decimal string is converted
  // with a 15-digit guard because Number stays exact below 2^53 (Rule 2: never floats; the
  // the regex ^\d+$ already guarantees an integer string). CLT-D-018.
  const amountNumber = Number(parsed.data.amountPoisha);
  if (
    parsed.data.amountPoisha.length > 15 ||
    !Number.isSafeInteger(amountNumber) ||
    amountNumber <= 0
  ) {
    return new Response(
      JSON.stringify({
        error: 'invalid_amount',
        message: 'amountPoisha must be a positive integer poisha string',
      }),
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();
  // Generated Supabase types type the text/uuid params as non-nullable `string`, but the Postgres
  // function params accept SQL NULL at runtime (no STRICT). Postgres validates the actual values.
  const rpcArgs = {
    p_center_id: centerId,
    p_settlement_id: parsed.data.settlementId,
    p_amount_poisha: amountNumber,
    p_paid_on: parsed.data.paidOn,
    p_reference: parsed.data.reference ?? null,
    p_receipt_path: effectiveReceiptPath,
    p_note: parsed.data.note ?? null,
    p_is_reversal: parsed.data.isReversal ?? false,
    p_reverses_id: effectiveReversesId,
    p_actor_id: caller.userId,
  };
  const { data, error } = await supabase.rpc(
    'record_settlement_payment',
    rpcArgs as unknown as Database['public']['Functions']['record_settlement_payment']['Args'],
  );

  if (error) {
    if (error.message?.includes('month_closed')) {
      return new Response(
        JSON.stringify({
          error: 'month_closed',
          message: 'Month is closed. Payments and reversals are locked.',
        }),
        { status: 422 },
      );
    }
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  // Fetch updated settlement and created payment for instant reactive client sync
  const { data: updatedSettlement } = await supabase
    .from('settlements')
    .select('*')
    .eq('id', parsed.data.settlementId)
    .eq('center_id', centerId)
    .single();

  const { data: createdPayment } = await supabase
    .from('settlement_payments')
    .select(
      'id, settlement_id, amount_poisha, paid_on, reference, receipt_storage_path, note, is_reversal, reverses_payment_id, recorded_by, created_at',
    )
    .eq('id', data)
    .eq('center_id', centerId)
    .single();

  return new Response(
    JSON.stringify({
      success: true,
      paymentId: data,
      payment: createdPayment,
      settlement: updatedSettlement,
    }),
    { status: 200 },
  );
};

/**
 * GET /api/v1/settlements/payments?settlement_id=<UUID>
 * Fetches official payment rows and settlement entity for a settlement. Restricted to Admin and Owner.
 */
export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(
      JSON.stringify({ error: 'unauthorized', reason: 'Admin or Owner required' }),
      { status: 403 },
    );
  }

  const settlementId = event.url.searchParams.get('settlement_id');
  if (
    !settlementId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(settlementId)
  ) {
    return new Response(
      JSON.stringify({ error: 'invalid_parameter', message: 'settlement_id UUID required' }),
      { status: 400 },
    );
  }

  const centerId = caller.centerId;
  if (!centerId) {
    return new Response(JSON.stringify({ error: 'missing_center_id' }), { status: 400 });
  }

  const supabase = getServiceSupabase();

  const { data: settlement } = await supabase
    .from('settlements')
    .select('*')
    .eq('id', settlementId)
    .eq('center_id', centerId)
    .single();

  const { data: payments, error } = await supabase
    .from('settlement_payments')
    .select(
      'id, settlement_id, amount_poisha, paid_on, reference, receipt_storage_path, note, is_reversal, reverses_payment_id, recorded_by, created_at',
    )
    .eq('settlement_id', settlementId)
    .eq('center_id', centerId)
    .order('paid_on', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ settlement: settlement ?? null, payments: payments ?? [] }),
    { status: 200 },
  );
};
