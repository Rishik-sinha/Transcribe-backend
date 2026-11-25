# Translator Backend — design & API

Express API that backs the real product: Supabase (Postgres + Auth) for
storage/auth, and a **provider-agnostic AI layer** for transcription &
summarization of the audio users actually record.

```
frontend (Vite) ──Bearer token──▶ Express ──service role──▶ Supabase (Postgres + GoTrue auth)
                                       │
                                       └──▶ AI provider (AI_PROVIDER: groq | openai | deepgram | gemini)
```

## Layout

```
backend/
  server.js                     entry point (dotenv + listen)
  src/
    app.js                      middleware wiring, /api routes, 404 + error handler
    config/env.js               validated env access
    config/supabase.js          service-role Supabase client (lazy, backend-only)
    middleware/auth.js          requireAuth — verifies Bearer token via supabase.auth.getUser
    middleware/errorHandler.js  global error → { error } JSON
    utils/http.js               asyncHandler, HttpError, email/password/language validators
    services/data.service.js    ALL Supabase queries + snake_case↔camelCase mapping
    services/ai.service.js      provider-agnostic transcribe() / summarize()
    controllers/                auth, transcriptions, settings, ai
    routes/                     auth.routes, transcriptions.routes, settings.routes, ai.routes
```

## Auth model

Supabase Auth (email/password). `POST /api/auth/signup` and `/login` return a
Supabase **access token**; the frontend sends it as
`Authorization: Bearer <token>` on every protected route, and `requireAuth`
verifies it with `supabase.auth.getUser(token)`. The service-role key never
leaves the server.

## API

All protected routes need `Authorization: Bearer <token>`. Errors: `{ "error": "..." }`.

| Method | Path | Body / query | Returns |
| ------ | ---- | ------------ | ------- |
| GET | `/api/health` | — (public) | `{ status: 'ok' }` |
| POST | `/api/auth/signup` | `{ name, email, password }` | `201 { user, token }` |
| POST | `/api/auth/login` | `{ email, password }` | `{ user, token }` |
| POST | `/api/auth/logout` | — | `204` |
| GET | `/api/auth/me` | — | `{ user }` |
| PATCH | `/api/auth/me` | `{ name?, email? }` | `{ user }` |
| POST | `/api/auth/password` | `{ currentPassword, nextPassword }` | `{ ok: true }` |
| GET | `/api/transcriptions?q=` | `q` searches title + segment text | `{ sessions[] }` |
| POST | `/api/transcriptions` | `{ title, language, segments[], notes?, summary?, engine?, source? }` | `201 { session }` |
| GET | `/api/transcriptions/export` | — | `{ exportedAt, sessions[] }` |
| DELETE | `/api/transcriptions` | — (clear library) | `204` |
| GET | `/api/transcriptions/:id` | — | `{ session }` |
| PATCH | `/api/transcriptions/:id` | any of title/language/notes/summary/engine/source/status/segments | `{ session }` |
| DELETE | `/api/transcriptions/:id` | — | `204` |
| GET | `/api/settings` | — | `{ settings }` |
| PUT | `/api/settings` | `{ defaultLanguage?, autoScroll?, confirmDelete?, keepAudio?, narrationRate? }` | `{ settings }` |
| GET | `/api/ai/engine` | — | `{ provider, engine, configured }` |
| POST | `/api/ai/summarize` | `{ text }` or `{ sessionId, language? }` | `{ summary }` |
| POST | `/api/ai/transcribe` | `{ audioBase64, mimeType?, language? }` | `{ segments[], engine }` |

`session` shape (matches `src/lib/store.js` exactly):
`{ id, title, createdAt, updatedAt, language, durationSec, words, segments[], notes, summary, engine, sampleRate, source, status }`
with `segment = { id, speaker, start, end, text, lang }`.

## Environment (`backend/.env`, see `.env.example`)

| Var | Purpose |
| --- | ------- |
| `PORT`, `NODE_ENV`, `FRONTEND_URL` | server + CORS origin |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase project (service role is backend-only) |
| `AI_PROVIDER` | `groq` \| `openai` \| `deepgram` \| `gemini` (required) |
| `AI_API_KEY` | the key for whichever provider you choose |
| `AI_BASE_URL`, `AI_MODEL`, `AI_SUMMARIZE_MODEL` | optional overrides |

**Swapping an AI provider is one env var** — when you provide your API key, just
set `AI_PROVIDER` + `AI_API_KEY` (e.g. `AI_PROVIDER=groq`, or Deepgram, or
whatever you have). No code changes needed; `services/ai.service.js` isolates
each vendor.

## Run

```bash
cd backend
cp .env.example .env     # then fill in Supabase + AI values
npm install
npm run dev              # http://localhost:5000
```

Database: run `database/001_schema.sql` → `002_rls.sql` in the Supabase SQL
editor. If you used an earlier build, also run `003_remove_demo.sql` once to
remove demo data — see `database/README.md`.

## Frontend contract

`frontend/src/lib/store.js` already calls these endpoints through
`frontend/src/api/client.js` (with the Bearer token), and `lib/auth.js` uses the
`/api/auth/*` routes. No other frontend module knows about the backend.
