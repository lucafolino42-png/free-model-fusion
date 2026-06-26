// Hermetic test environment.
// These MUST run before any source module (config.ts) is imported, because
// config.ts reads process.env at load time and dotenv.config() does NOT
// override already-set env vars — so the values here win over a developer's
// real .env. This keeps the suite deterministic on any machine.

process.env.DATABASE_URL = ':memory:';
process.env.NODE_ENV = 'test';
process.env.FUSION_SECRET_KEY = 'test-secret-key-at-least-32-chars-long';

// Controlled provider keys for credential / env-priority tests (deterministic).
process.env.GROQ_API_KEY = 'gsk_test_groq_key_for_tests_only_abcdef';

// Clear the rest so tests never depend on a developer's .env.
process.env.OPENROUTER_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.CEREBRAS_API_KEY = '';
process.env.NVIDIA_NIM_API_KEY = '';
process.env.TOGETHER_API_KEY = '';
process.env.FIREWORKS_API_KEY = '';
process.env.DEEPINFRA_API_KEY = '';
process.env.NOVITA_API_KEY = '';
process.env.HYPERBOLIC_API_KEY = '';
process.env.SAMBANOVA_API_KEY = '';
process.env.PERPLEXITY_API_KEY = '';
process.env.NEBIUS_API_KEY = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.TELEGRAM_WEBHOOK_URL = '';
process.env.TAVILY_API_KEY = '';
