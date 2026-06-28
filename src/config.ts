import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',
  isProd: process.env.NODE_ENV === 'production',

  // Database
  databaseUrl: process.env.DATABASE_URL || 'file:./data/fusion.db',

  // Security
  secretKey: process.env.FUSION_SECRET_KEY || '',

  // Telegram
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramWebhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '',

  // CORS (default '*' for local dev; set CORS_ORIGIN to a specific origin to lock down)
  corsOrigin: process.env.CORS_ORIGIN || '*',

  // Web Search
  tavilyApiKey: process.env.TAVILY_API_KEY || '',

  // Provider API Keys
  providerEnvKeys: {
    openrouter: process.env.OPENROUTER_API_KEY || '',
    groq: process.env.GROQ_API_KEY || '',
    gemini: process.env.GEMINI_API_KEY || '',
    cerebras: process.env.CEREBRAS_API_KEY || '',
    nvidia_nim: process.env.NVIDIA_NIM_API_KEY || '',
    together: process.env.TOGETHER_API_KEY || '',
    fireworks: process.env.FIREWORKS_API_KEY || '',
    deepinfra: process.env.DEEPINFRA_API_KEY || '',
    novita: process.env.NOVITA_API_KEY || '',
    hyperbolic: process.env.HYPERBOLIC_API_KEY || '',
    sambanova: process.env.SAMBANOVA_API_KEY || '',
    perplexity: process.env.PERPLEXITY_API_KEY || '',
    nebius: process.env.NEBIUS_API_KEY || '',
  } as Record<string, string>,

  // Fusion Settings
  defaultProfile: (process.env.FUSION_DEFAULT_PROFILE || 'balanced') as 'speed' | 'balanced' | 'quality' | 'custom',
  maxExperts: parseInt(process.env.FUSION_MAX_EXPERTS || '4', 10),
  maxExpertsPerProvider: parseInt(process.env.FUSION_MAX_EXPERTS_PER_PROVIDER || '2', 10),

  expertMaxTokens: parseInt(process.env.FUSION_EXPERT_MAX_TOKENS || '7500', 10),
  judgeMaxTokens: parseInt(process.env.FUSION_JUDGE_MAX_TOKENS || '5400', 10),
  synthesisMaxTokens: parseInt(process.env.FUSION_SYNTHESIS_MAX_TOKENS || '15000', 10),
  continuationMaxTokens: parseInt(process.env.FUSION_CONTINUATION_MAX_TOKENS || '7500', 10),
  enableContinuation: process.env.FUSION_ENABLE_CONTINUATION !== 'false',
  maxContinuations: parseInt(process.env.FUSION_MAX_CONTINUATIONS || '1', 10),

  historyMessages: parseInt(process.env.FUSION_HISTORY_MESSAGES || '12', 10),
  historyChars: parseInt(process.env.FUSION_HISTORY_CHARS || '12000', 10),
  webMaxResults: parseInt(process.env.FUSION_WEB_MAX_RESULTS || '5', 10),
  webContextChars: parseInt(process.env.FUSION_WEB_CONTEXT_CHARS || '8000', 10),
  telegramChunkSize: parseInt(process.env.TELEGRAM_CHUNK_SIZE || '3600', 10),
} as const;

export type Config = typeof config;
