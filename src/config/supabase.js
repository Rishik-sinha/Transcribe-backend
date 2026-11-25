const { createClient } = require('@supabase/supabase-js');
const { env, requireEnv } = require('./env');

let adminClient = null;

/**
 * Service-role Supabase client (server-side only).
 *
 * The service role bypasses Row Level Security, so:
 *  - it must NEVER be shipped to the browser (only the anon key goes client-side),
 *  - every query must be scoped to the authenticated user (req.user.id), which
 *    the controllers do explicitly — RLS still protects end users directly.
 */
function getSupabaseAdmin() {
  if (!adminClient) {
    const url = requireEnv('SUPABASE_URL');
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    adminClient = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}

module.exports = { getSupabaseAdmin };
