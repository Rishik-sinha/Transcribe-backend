// AI endpoints. Provider-agnostic: AI_PROVIDER + AI_API_KEY in .env decide
// which vendor serves these calls (groq | openai | deepgram | gemini).

const { asyncHandler, httpError, LANGUAGES } = require('../utils/http');
const ai = require('../services/ai.service');
const { getTranscription } = require('../services/data.service');

// POST /api/ai/summarize  { text }  OR  { sessionId }
const summarize = asyncHandler(async (req, res) => {
  const { text, sessionId, language = 'mixed' } = req.body || {};
  let transcript = String(text || '').trim();

  if (!transcript && sessionId) {
    const session = await getTranscription(req.user.id, sessionId);
    if (!session) throw httpError(404, 'Session not found');
    transcript = session.segments.map((s) => s.text).join(' ');
  }
  if (!transcript) throw httpError(400, 'Provide text or a sessionId to summarize.');

  const summary = await ai.summarize({
    text: transcript,
    language: LANGUAGES.includes(language) ? language : 'mixed',
  });
  res.json({ summary });
});

// GET /api/ai/engine  -> the provider/model actually serving transcription
const engine = asyncHandler(async (req, res) => {
  try {
    res.json({ provider: ai.providerName(), engine: ai.engineLabel(), configured: true });
  } catch {
    res.json({ provider: null, engine: '', configured: false });
  }
});

// POST /api/ai/transcribe  { audioBase64, mimeType?, language? }
const transcribe = asyncHandler(async (req, res) => {
  const { audioBase64, mimeType, language = 'mixed' } = req.body || {};

  if (!audioBase64 || typeof audioBase64 !== 'string') {
    throw httpError(400, 'audioBase64 is required for transcription.');
  }

  try {
    const segments = await ai.transcribe({
      audioBase64,
      mimeType: mimeType || 'audio/webm',
      language: LANGUAGES.includes(language) ? language : 'mixed',
    });
    res.json({ segments, engine: ai.engineLabel() });
  } catch (error) {
    // Keep provider details in the server log; give the client a retryable error.
    console.error('Transcription failed:', error.message);
    return res.status(502).json({ error: 'Transcription failed. Please try again.' });
  }
});

module.exports = { summarize, transcribe, engine };
