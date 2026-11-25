// Auth endpoints backed by Supabase Auth (GoTrue email/password).
// The backend signs users up/in with the service-role client and returns the
// Supabase access token; the frontend sends it as `Authorization: Bearer`.

const { getSupabaseAdmin } = require('../config/supabase');
const {
  asyncHandler,
  httpError,
  EMAIL_PATTERN,
  MIN_PASSWORD,
  normalizeEmail,
} = require('../utils/http');
const { getProfile, updateProfile, toPublicUser } = require('../services/data.service');

function validateCredentials({ email, password }) {
  const cleanEmail = normalizeEmail(email);
  if (!EMAIL_PATTERN.test(cleanEmail)) return 'That email address does not look right.';
  if (!password || String(password).length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters for your password.`;
  }
  return null;
}

const signup = asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (name.length < 2) return res.status(400).json({ error: 'Please tell us your name.' });
  const credError = validateCredentials({ email, password });
  if (credError) return res.status(400).json({ error: credError });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip the email verification round-trip
    user_metadata: { name },
  });
  if (error) {
    const message = /already registered/i.test(error.message)
      ? 'An account already exists with this email. Sign in instead.'
      : error.message;
    return res.status(400).json({ error: message });
  }

  // Sign in to mint an access token for the fresh account.
  const { data: session, error: sessionError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (sessionError || !session?.session) {
    return res.status(201).json({ user: toPublicUser(null, data.user), token: null });
  }
  const profile = await getProfile(data.user.id);
  res.status(201).json({
    user: toPublicUser(profile, data.user),
    token: session.session.access_token,
  });
});

const login = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  if (!email || !password) {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data?.session) {
    return res.status(401).json({ error: 'That email and password do not match.' });
  }
  const profile = await getProfile(data.user.id);
  res.json({ user: toPublicUser(profile, data.user), token: data.session.access_token });
});

// Token-based auth is stateless: the client discards its token.
const logout = asyncHandler(async (req, res) => {
  res.status(204).end();
});

const me = asyncHandler(async (req, res) => {
  const profile = await getProfile(req.user.id);
  res.json({ user: toPublicUser(profile, req.user) });
});

const updateMe = asyncHandler(async (req, res) => {
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : undefined;
  const email = req.body?.email !== undefined ? normalizeEmail(req.body.email) : undefined;

  if (name !== undefined && name.length < 2) {
    return res.status(400).json({ error: 'Please use at least two characters for your name.' });
  }
  if (email !== undefined && !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'That email address does not look right.' });
  }

  if (email && email !== req.user.email) {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.auth.admin.updateUserById(req.user.id, { email });
    if (error) {
      return res.status(400).json({
        error: /already registered/i.test(error.message)
          ? 'Another account is already using this email.'
          : error.message,
      });
    }
  }

  const profile = await updateProfile(req.user.id, { name, email });
  res.json({ user: toPublicUser(profile, req.user) });
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, nextPassword } = req.body || {};
  if (!currentPassword || String(nextPassword || '').length < MIN_PASSWORD) {
    return res
      .status(400)
      .json({ error: `Use at least ${MIN_PASSWORD} characters for the new password.` });
  }

  const supabase = getSupabaseAdmin();
  // Verify the current password by attempting a sign-in.
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: req.user.email,
    password: currentPassword,
  });
  if (verifyError) {
    return res.status(401).json({ error: 'Your current password is not correct.' });
  }

  const { error } = await supabase.auth.admin.updateUserById(req.user.id, {
    password: nextPassword,
  });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = { signup, login, logout, me, updateMe, changePassword };
