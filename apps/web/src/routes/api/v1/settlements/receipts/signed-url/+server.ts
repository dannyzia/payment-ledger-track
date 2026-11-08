import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import { validateReceiptPath } from '$lib/settlements/receipt-validation';

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(
      JSON.stringify({ error: 'unauthorized', reason: 'Admin or Owner required' }),
      { status: 403 },
    );
  }

  const path = event.url.searchParams.get('path');
  if (!path || !validateReceiptPath(path)) {
    return new Response(
      JSON.stringify({
        error: 'invalid_path',
        message: 'Path traversal or malformed path rejected',
      }),
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 900); // 15 minutes TTL (PRD §8.4, §13)

  if (error || !data?.signedUrl) {
    return new Response(JSON.stringify({ error: error?.message || 'Signed URL creation failed' }), {
      status: 500,
    });
  }

  return new Response(JSON.stringify({ signedUrl: data.signedUrl }), { status: 200 });
};
