// Provider-agnostic AI service.
//
// The app is NOT tied to Gemini. Pick a provider with AI_PROVIDER and drop its
// API key in AI_API_KEY — supported: groq | openai | deepgram | gemini.
// Each provider implements the same two operations:
//   - transcribe({ audioBase64, mimeType, language }) -> segments[]
//   - summarize({ text, language })                   -> summary string
// There is no mock/simulated provider: transcripts always come from the audio
// the user actually recorded.

const { env, requireEnv } = require('../config/env');

const PROVIDERS = ['groq', 'openai', 'deepgram', 'gemini'];
const PROVIDER_LABELS = {
  groq: 'Groq',
  openai: 'OpenAI',
  deepgram: 'Deepgram',
  gemini: 'Gemini',
};

const DEFAULTS = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3',
    chatModel: 'llama-3.3-70b-versatile',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1',
    chatModel: 'gpt-4o-mini',
  },
  deepgram: { baseUrl: 'https://api.deepgram.com/v1', model: 'nova-2' },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3.5-transcribe',
    chatModel: 'gemini-3.5-flash',
  },
};

function providerName() {
  const name = String(env.AI_PROVIDER || '').toLowerCase();
  if (!name) {
    throw new Error(
      `AI_PROVIDER is not configured. Set it to one of: ${PROVIDERS.join(', ')} in backend/.env.`
    );
  }
  if (!PROVIDERS.includes(name)) {
    throw new Error(`Unknown AI_PROVIDER "${name}". Expected one of: ${PROVIDERS.join(', ')}.`);
  }
  return name;
}

function providerConfig() {
  const name = providerName();
  const d = DEFAULTS[name] || {};
  return {
    name,
    baseUrl: env.AI_BASE_URL || d.baseUrl || '',
    model: env.AI_MODEL || d.model || '',
    chatModel: env.AI_SUMMARIZE_MODEL || d.chatModel || d.model || '',
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Same rule as frontend lib/format.js wordCount, so counts match the client. */
function toSegmentsFromText(text, language) {
  const sentences = String(text || '')
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const segments = [];
  let cursor = 0;
  sentences.forEach((sentence, index) => {
    const words = (sentence.match(/[\p{L}\p{N}'’]+/gu) || []).length;
    const duration = Math.max(2, Math.round(words / 2.6)); // ~2.6 words/sec speech
    segments.push({
      id: `seg_${index + 1}`,
      speaker: 'You',
      start: cursor,
      end: cursor + duration,
      text: sentence,
      lang: language,
    });
    cursor += duration + 1;
  });
  return segments;
}

/** Extractive summary for ASR-only providers (Deepgram has no chat model). */
function extractiveSummary(text, maxSentences = 2) {
  const sentences = String(text || '')
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const picked = sentences.slice(0, maxSentences).join(' ');
  return picked.length > 220 ? `${picked.slice(0, 217)}...` : picked;
}

async function postJson(url, body, headers = {}) {
  const payload = JSON.stringify(body);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: payload,
    });
    if (res.ok) return res.json();

    const detail = await res.text().catch(() => '');
    const error = new Error(`AI provider responded ${res.status}: ${detail.slice(0, 300)}`);
    // Model overload (503) and rate limits (429) are usually transient.
    if ((res.status === 503 || res.status === 429) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      continue;
    }
    throw error;
  }

  throw new Error('AI provider is unavailable. Try again in a moment.');
}

// ---------------------------------------------------------------------------
// Summarize
// ---------------------------------------------------------------------------

async function summarizeWithChatProvider(cfg, text, language) {
  const key = requireEnv('AI_API_KEY');
  const data = await postJson(
    `${cfg.baseUrl}/chat/completions`,
    {
      model: cfg.chatModel,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            'You summarize meeting transcripts in one short paragraph (max 60 words). ' +
            'Preserve Hindi/English code-mixing exactly as spoken. Output only the summary.',
        },
        { role: 'user', content: `Language hint: ${language || 'mixed'}\n\nTranscript:\n${text}` },
      ],
    },
    { Authorization: `Bearer ${key}` }
  );
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function summarizeWithGemini(cfg, text, language) {
  const key = requireEnv('AI_API_KEY');
  const data = await postJson(
    `${cfg.baseUrl}/models/${cfg.chatModel}:generateContent?key=${key}`,
    {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `Summarize this meeting transcript in one short paragraph (max 60 words). ` +
                `Preserve Hindi/English code-mixing exactly as spoken. Output only the summary. ` +
                `Language hint: ${language || 'mixed'}\n\nTranscript:\n${text}`,
            },
          ],
        },
      ],
    }
  );
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim() || '';
}

async function summarize({ text, language = 'mixed' }) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  const cfg = providerConfig();
  if (cfg.name === 'groq' || cfg.name === 'openai') {
    return summarizeWithChatProvider(cfg, clean, language);
  }
  if (cfg.name === 'gemini') return summarizeWithGemini(cfg, clean, language);
  // deepgram is ASR-only, so summarize locally.
  return extractiveSummary(clean);
}

// ---------------------------------------------------------------------------
// Transcribe
// ---------------------------------------------------------------------------

async function transcribeWithWhisperStyle(cfg, audioBase64, mimeType, language) {
  const key = requireEnv('AI_API_KEY');
  const bytes = Buffer.from(audioBase64, 'base64');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType || 'audio/webm' }), 'audio.webm');
  form.append('model', cfg.model);
  form.append('language', language === 'hi' ? 'hi' : 'en');
  form.append('response_format', 'verbose_json');

  const res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AI provider responded ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  if (Array.isArray(data?.segments) && data.segments.length) {
    return data.segments.map((s, i) => ({
      id: `seg_${i + 1}`,
      speaker: 'You',
      start: s.start ?? 0,
      end: s.end ?? 0,
      text: s.text?.trim() || '',
      lang: language,
    }));
  }
  return toSegmentsFromText(data?.text || '', language);
}

async function transcribeWithDeepgram(cfg, audioBase64, mimeType, language) {
  const key = requireEnv('AI_API_KEY');
  const bytes = Buffer.from(audioBase64, 'base64');
  const lang = language === 'hi' ? 'hi' : language === 'en' ? 'en' : 'multi';
  const res = await fetch(
    `${cfg.baseUrl}/listen?model=${cfg.model}&language=${lang}&smart_format=true&utterances=true`,
    {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': mimeType || 'audio/webm' },
      body: bytes,
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Deepgram responded ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const utterances = data?.results?.utterances || [];
  if (utterances.length) {
    return utterances.map((u, i) => ({
      id: `seg_${i + 1}`,
      speaker: u.speaker != null ? `Speaker ${u.speaker + 1}` : 'You',
      start: u.start ?? 0,
      end: u.end ?? 0,
      text: u.transcript || '',
      lang: language,
    }));
  }
  return toSegmentsFromText(data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '', language);
}

async function transcribeWithGemini(cfg, audioBase64, mimeType, language) {
  const key = requireEnv('AI_API_KEY');
  const data = await postJson(
    `${cfg.baseUrl}/models/${cfg.model}:generateContent?key=${key}`,
    {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                'Transcribe this audio verbatim, splitting it into individual sentences. ' +
                'Respond ONLY with a JSON array: ' +
                '[{"start": seconds, "end": seconds, "text": "..."}]. ' +
                `Language hint: ${language}. Preserve code-mixing. ` +
                'Do not translate, summarize, or invent speech that is not in the audio.',
            },
            { inlineData: { mimeType: mimeType || 'audio/webm', data: audioBase64 } },
          ],
        },
      ],
    }
  );
  const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';

  const match = raw.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      const segments = parsed
        .map((s, i) => ({
          id: `seg_${i + 1}`,
          speaker: 'You',
          start: Number(s.start) || 0,
          end: Number(s.end) || 0,
          text: String(s.text || '').trim(),
          lang: language,
        }))
        .filter((s) => s.text);
      if (segments.length) return segments;
    } catch {
      /* fall through to plain-text handling */
    }
  }

  // The model occasionally ignores the JSON instruction; the text is still a
  // real transcript of the audio, so keep it instead of returning nothing.
  return toSegmentsFromText(raw.replace(/```[a-z]*|```/gi, '').trim(), language);
}

async function transcribe({ audioBase64, mimeType = 'audio/webm', language = 'mixed' } = {}) {
  const cfg = providerConfig();
  if (!audioBase64) {
    throw new Error('audioBase64 is required for transcription.');
  }
  if (cfg.name === 'groq' || cfg.name === 'openai') {
    return transcribeWithWhisperStyle(cfg, audioBase64, mimeType, language);
  }
  if (cfg.name === 'deepgram') return transcribeWithDeepgram(cfg, audioBase64, mimeType, language);
  if (cfg.name === 'gemini') return transcribeWithGemini(cfg, audioBase64, mimeType, language);
  throw new Error(`Provider "${cfg.name}" is not supported for transcription.`);
}

/** Human-readable engine label stored on the session, e.g. "Gemini · gemini-2.5-flash". */
function engineLabel() {
  const cfg = providerConfig();
  return `${PROVIDER_LABELS[cfg.name] || cfg.name} · ${cfg.model}`;
}

module.exports = { summarize, transcribe, providerName, engineLabel };
