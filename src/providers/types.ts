// ─── Speed/Quality Classes ───────────────────────────────
export type SpeedClass = 'very_fast' | 'fast' | 'medium' | 'slow' | 'very_slow';
export type QualityClass = 'basic' | 'good' | 'strong' | 'frontier' | 'reasoning';
export type ModelRole = 'expert' | 'judge' | 'synthesis';

// ─── Provider Preset ─────────────────────────────────────
export interface ProviderPreset {
  id: string;
  label: string;
  endpoint: string;
  authType: string;
  apiFormat: string;
  enabled: boolean;
  aliases: string[];
  credentialRef: string;
  maxOutputTokens: number;
  speedClass: SpeedClass;
  qualityClass: QualityClass;
}

// ─── Model Preset ────────────────────────────────────────
export interface ModelPreset {
  id: string;
  providerId: string;
  title: string;
  model: string;
  useAs: ModelRole[];
  enabled: boolean;
  speedClass: SpeedClass;
  qualityClass: QualityClass;
  maxOutputTokens: number;
}

// ─── Registered Provider ─────────────────────────────────
export interface RegisteredProvider {
  id: string;
  label: string;
  endpoint: string;
  authType: string;
  apiFormat: string;
  enabled: boolean;
  aliases: string[];
  credentialRef: string;
  maxOutputTokens: number;
  speedClass: SpeedClass;
  qualityClass: QualityClass;
  hasCredential: boolean;
  isPreset: boolean;
}

// ─── Registered Model ────────────────────────────────────
export interface RegisteredModel {
  id: string;
  providerId: string;
  title: string;
  model: string;
  useAs: ModelRole[];
  enabled: boolean;
  speedClass: SpeedClass;
  qualityClass: QualityClass;
  maxOutputTokens: number;
  hasCredential: boolean;
  isPreset: boolean;
}

// ─── Chat Completion Request/Response ────────────────────
export interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices: Array<{
    index: number;
    message?: {
      role: string;
      content: string;
    };
    text?: string;
    finish_reason?: string;
  }>;
  candidates?: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
  output_text?: string;
}

// ─── Routing Profile ─────────────────────────────────────
export type RoutingProfile = 'speed' | 'balanced' | 'quality' | 'custom';

// ─── Reasoning Effort ────────────────────────────────────
/** How hard the model should try to reason before answering.
 *  - low: quick, surface-level answers
 *  - medium: balanced reasoning depth
 *  - high: thorough reasoning
 *  - xhigh: maximum reasoning (may increase latency significantly)
 */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

// ─── Web Search Result ───────────────────────────────────
export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

// ─── Fusion Result ───────────────────────────────────────
export interface FusionResult {
  answer: string;
  telegramHtml?: string;
  meta: {
    routing: {
      profile: RoutingProfile;
      expertsUsed: number;
      judgeUsed: boolean;
      synthesisUsed: boolean;
      continued: boolean;
      truncated: boolean;
    };
    models: {
      experts: string[];
      judge?: string;
      synthesis?: string;
    };
    web: {
      enabled: boolean;
      searched: boolean;
      resultsCount: number;
      warning?: string;
    };
    memory: {
      sessionId: string;
      messagesLoaded: number;
      messagesSaved: boolean;
    };
    tokens: {
      expert: number;
      judge: number;
      synthesis: number;
      continuation: number;
      totalEstimated: number;
    };
    errors?: Array<{
      provider: string;
      model: string;
      error: string;
    }>;
    /** Confidence scores (1-10) from the judge, keyed by model ID. */
    judgeScores?: Record<string, number>;
    /** Models that were started but discarded by race mode. */
    racedAhead?: number;
    /** Estimated cost in USD (based on model class). */
    estimatedCostUsd?: number;
    /** The reasoning effort used for this request. */
    reasoningEffort?: string;
  };
}
