import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const STORAGE_PATH_REGEX = /^statements\/\d{4}-\d{2}(-01)?\/[0-9a-f]{64}$/;

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    throw error(403, 'unauthorized: Admin or Owner role required');
  }

  const path = event.url.searchParams.get('path');
  if (!path || !STORAGE_PATH_REGEX.test(path)) {
    throw error(400, 'invalid_storage_path: Path must match statements/<month>/<sha256>');
  }

  const supabase = getServiceSupabase();

  // Signed URL expires in 900 seconds (15 minutes) per PRD §11.3
  const { data, error: signedErr } = await supabase.storage
    .from('statements')
    .createSignedUrl(path, 900);

  if (signedErr || !data?.signedUrl) {
    throw error(500, `signed_url_generation_failed: ${signedErr?.message || 'Unknown storage error'}`);
  }

  return json({
    signedUrl: data.signedUrl,
    expiresIn: 900,
  });
};
