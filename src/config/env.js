require('dotenv').config();

// Central, validated access to environment variables.
// Values are read once at boot; requireEnv() throws a clear error only when a
// feature that actually needs the variable is used, so `node -e "require('./src/app')"`
// and /api/health still work before Supabase/AI keys are configured.
const env = {
  PORT: Number(process.env.PORT) || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',

  // Supabase (project URL + keys — supplied by the user later)
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // AI provider (provider-agnostic — NOT tied to Gemini; see services/ai.service.js)
  AI_PROVIDER: (process.env.AI_PROVIDER || '').toLowerCase(), // groq | openai | deepgram | gemini
  AI_API_KEY: process.env.AI_API_KEY || '',
  AI_BASE_URL: process.env.AI_BASE_URL || '', // optional override, defaults per provider
  AI_MODEL: process.env.AI_MODEL || '', // transcription model, defaults per provider
  AI_SUMMARIZE_MODEL: process.env.AI_SUMMARIZE_MODEL || '', // chat model, defaults per provider
};

function requireEnv(name) {
  const value = env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Add it to backend/.env (see .env.example).`
    );
  }
  return value;
}

module.exports = { env, requireEnv };
