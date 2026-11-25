const { getSupabaseAdmin } = require('../config/supabase');

/**
 * Verifies the Supabase access token sent as `Authorization: Bearer <token>`
 * and attaches the auth user to req.user ({ id, email, ... }).
 * All workspace routes sit behind this.
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token. Sign in first.' });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token. Sign in again.' });
    }

    req.user = data.user;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
