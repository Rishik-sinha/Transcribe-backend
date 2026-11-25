// Data access layer — every Supabase query lives here.
// Rows are stored snake_case in Postgres; the API speaks the camelCase shape
// the frontend store already uses (createdAt, durationSec, segments, ...).

const { getSupabaseAdmin } = require('../config/supabase');
const { LANGUAGES } = require('../utils/http');

// Same rule as frontend lib/format.js so word counts match the client exactly.
const WORD_RE = /[\p{L}\p{N}'’]+/gu;
function wordCount(text = '') {
  const matches = String(text).match(WORD_RE);
  return matches ? matches.length : 0;
}
function countWords(segments = []) {
  return segments.reduce((total, s) => total + wordCount(s.text), 0);
}

function throwIf(error, fallback = 'Database request failed.') {
  if (error) {
    const err = new Error(error.message || fallback);
    err.status = 500;
    throw err;
  }
}

// ----- row mappers ---------------------------------------------------------

function toSegment(row) {
  return {
    id: row.id,
    speaker: row.speaker,
    start: row.start_sec,
    end: row.end_sec,
    text: row.text,
    lang: row.lang,
  };
}

function toSession(row, segments = []) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    language: row.language,
    durationSec: row.duration_sec,
    words: row.words,
    segments,
    notes: row.notes,
    summary: row.summary,
    engine: row.engine,
    sampleRate: row.sample_rate,
    source: row.source,
    status: row.status,
  };
}

function toPublicUser(profile, authUser) {
  return {
    id: profile?.id || authUser.id,
    name: profile?.name || authUser.user_metadata?.name || 'User',
    email: profile?.email || authUser.email,
    createdAt: profile?.created_at || authUser.created_at,
    plan: profile?.plan || 'personal',
  };
}

async function attachSegments(sessions) {
  if (!sessions.length) return sessions;
  const supabase = getSupabaseAdmin();
  const ids = sessions.map((s) => s.id);
  const { data, error } = await supabase
    .from('transcription_segments')
    .select('*')
    .in('transcription_id', ids)
    .order('position', { ascending: true });
  throwIf(error);
  const bySession = new Map();
  (data || []).forEach((seg) => {
    if (!bySession.has(seg.transcription_id)) bySession.set(seg.transcription_id, []);
    bySession.get(seg.transcription_id).push(toSegment(seg));
  });
  return sessions.map((s) => toSession(s, bySession.get(s.id) || []));
}

// ----- profiles ------------------------------------------------------------

async function getProfile(userId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  throwIf(error);
  return data;
}

async function updateProfile(userId, { name, email }) {
  const supabase = getSupabaseAdmin();
  const patch = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (email !== undefined) patch.email = email;
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .single();
  throwIf(error);
  return data;
}

// ----- transcriptions: list / get / create ---------------------------------

async function listTranscriptions(userId, { q } = {}) {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('transcriptions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (q) {
    // Match on title OR on any segment text belonging to this user.
    const { data: segHits, error: segErr } = await supabase
      .from('transcription_segments')
      .select('transcription_id, transcriptions!inner(user_id)')
      .eq('transcriptions.user_id', userId)
      .ilike('text', `%${q}%`);
    throwIf(segErr);
    const ids = [...new Set((segHits || []).map((s) => s.transcription_id))];
    query = query.or(`title.ilike.%${q}%,id.in.(${ids.join(',') || "''"})`);
  }

  const { data, error } = await query;
  throwIf(error);
  return attachSegments(data || []);
}

async function getTranscription(userId, id) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('transcriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  throwIf(error);
  if (!data) return null;
  const [withSegments] = await attachSegments([data]);
  return withSegments;
}

function normalizeSegments(segments = [], language) {
  return segments.map((segment, index) => ({
    id: segment.id || `seg_${index + 1}_${Math.random().toString(36).slice(2, 6)}`,
    speaker: segment.speaker || 'You',
    start: Number(segment.start) || 0,
    end: Number(segment.end) || 0,
    text: String(segment.text || ''),
    lang: segment.lang || language,
  }));
}

async function createTranscription(userId, draft) {
  const supabase = getSupabaseAdmin();
  const language = LANGUAGES.includes(draft.language) ? draft.language : 'mixed';
  const segments = normalizeSegments(draft.segments || [], language);
  const now = new Date().toISOString();

  const row = {
    user_id: userId,
    title: String(draft.title || 'Untitled session').trim() || 'Untitled session',
    language,
    duration_sec: Math.max(
      Number(draft.durationSec) || 0,
      segments.length ? Math.ceil(segments[segments.length - 1].end) : 0
    ),
    words: countWords(segments),
    notes: String(draft.notes || ''),
    summary: String(draft.summary || ''),
    engine: String(draft.engine || 'Server transcription'),
    sample_rate: Number(draft.sampleRate) || 48000,
    source: ['live', 'upload'].includes(draft.source) ? draft.source : 'live',
    status: 'saved',
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase.from('transcriptions').insert(row).select().single();
  throwIf(error);

  if (segments.length) {
    const { error: segErr } = await supabase.from('transcription_segments').insert(
      segments.map((s, i) => ({
        id: s.id,
        transcription_id: data.id,
        position: i,
        speaker: s.speaker,
        start_sec: s.start,
        end_sec: s.end,
        text: s.text,
        lang: s.lang,
      }))
    );
    throwIf(segErr);
  }
  return toSession(data, segments);
}

// ----- transcriptions: update / delete -------------------------------------

const PATCHABLE = ['title', 'language', 'notes', 'summary', 'engine', 'source', 'status'];

async function replaceSegments(transcriptionId, segments) {
  const supabase = getSupabaseAdmin();
  const { error: delErr } = await supabase
    .from('transcription_segments')
    .delete()
    .eq('transcription_id', transcriptionId);
  throwIf(delErr);
  if (!segments.length) return;
  const { error: insErr } = await supabase.from('transcription_segments').insert(
    segments.map((s, i) => ({
      id: s.id,
      transcription_id: transcriptionId,
      position: i,
      speaker: s.speaker,
      start_sec: s.start,
      end_sec: s.end,
      text: s.text,
      lang: s.lang,
    }))
  );
  throwIf(insErr);
}

async function updateTranscription(userId, id, patch) {
  const existing = await getTranscription(userId, id);
  if (!existing) return null;

  const supabase = getSupabaseAdmin();
  const next = { updated_at: new Date().toISOString() };

  for (const key of PATCHABLE) {
    if (patch[key] === undefined) continue;
    if (key === 'language' && !LANGUAGES.includes(patch.language)) {
      const err = new Error(`language must be one of: ${LANGUAGES.join(', ')}`);
      err.status = 400;
      throw err;
    }
    next[key] = patch[key];
  }

  let segments = existing.segments;
  if (patch.segments) {
    segments = normalizeSegments(patch.segments, next.language || existing.language);
    next.words = countWords(segments);
    next.duration_sec = segments.length ? Math.ceil(segments[segments.length - 1].end) : 0;
    await replaceSegments(id, segments);
  }

  const { data, error } = await supabase
    .from('transcriptions')
    .update(next)
    .eq('user_id', userId)
    .eq('id', id)
    .select()
    .single();
  throwIf(error);
  return toSession(data, segments);
}

async function deleteTranscription(userId, id) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('transcriptions')
    .delete()
    .eq('user_id', userId)
    .eq('id', id);
  throwIf(error);
  return true;
}

async function deleteAllTranscriptions(userId) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('transcriptions').delete().eq('user_id', userId);
  throwIf(error);
  return true;
}

// ----- settings -------------------------------------------------------------

const DEFAULT_SETTINGS = {
  defaultLanguage: 'mixed',
  autoScroll: true,
  confirmDelete: true,
  keepAudio: false,
  narrationRate: 1,
};

async function getSettings(userId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  throwIf(error);
  if (!data) return { ...DEFAULT_SETTINGS };
  return {
    defaultLanguage: data.default_language,
    autoScroll: data.auto_scroll,
    confirmDelete: data.confirm_delete,
    keepAudio: data.keep_audio,
    narrationRate: data.narration_rate,
  };
}

async function upsertSettings(userId, patch) {
  const current = await getSettings(userId);
  const next = { ...current };
  if (patch.defaultLanguage !== undefined) {
    if (!LANGUAGES.includes(patch.defaultLanguage)) {
      const err = new Error(`defaultLanguage must be one of: ${LANGUAGES.join(', ')}`);
      err.status = 400;
      throw err;
    }
    next.defaultLanguage = patch.defaultLanguage;
  }
  if (patch.autoScroll !== undefined) next.autoScroll = Boolean(patch.autoScroll);
  if (patch.confirmDelete !== undefined) next.confirmDelete = Boolean(patch.confirmDelete);
  if (patch.keepAudio !== undefined) next.keepAudio = Boolean(patch.keepAudio);
  if (patch.narrationRate !== undefined) {
    const rate = Number(patch.narrationRate);
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) {
      const err = new Error('narrationRate must be between 0.5 and 2.');
      err.status = 400;
      throw err;
    }
    next.narrationRate = rate;
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('user_settings').upsert(
    {
      user_id: userId,
      default_language: next.defaultLanguage,
      auto_scroll: next.autoScroll,
      confirm_delete: next.confirmDelete,
      keep_audio: next.keepAudio,
      narration_rate: next.narrationRate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  throwIf(error);
  return next;
}

module.exports = {
  wordCount,
  countWords,
  toPublicUser,
  getProfile,
  updateProfile,
  listTranscriptions,
  getTranscription,
  createTranscription,
  updateTranscription,
  deleteTranscription,
  deleteAllTranscriptions,
  getSettings,
  upsertSettings,
  DEFAULT_SETTINGS,
};
