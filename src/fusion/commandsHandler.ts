import { parseCommand, type ParsedCommand } from './commands.js';
import { normalizeInput } from './normalizeInput.js';
import { getOrCreateSession, getSessionMessages, saveMessage, clearSessionMemory, updateSessionSettings } from './memory.js';
import { searchWeb, shouldAutoSearch, formatSearchResults } from './webSearch.js';
import { analyzeQueryComplexity } from './queryComplexity.js';
import { selectExperts } from './routing.js';
import { runExpertPanel } from './expertPanel.js';
import { runJudge } from './judge.js';
import { runSynthesis } from './synthesis.js';
import { continueResponse, isTruncated } from './continuation.js';
import { estimateCallCost, estimateTotalCost } from './costEstimate.js';
import { listSkills, findSkill, getActiveSkill, loadSkill, unloadSkill } from './skills.js';
import { computeConfidence, estimateSynthesisQuality } from './confidence.js';
import { getAllProviders, getAllModels, getProviderById, getModelById, findProviderByAlias } from '../providers/registry.js';
import { saveCredential, deleteCredential, listCredentials, hasCredential } from '../providers/credentials.js';
import { addCustomProvider, deleteCustomProvider, setProviderEnabled } from '../providers/registry.js';
import { config } from '../config.js';
import { convertToTelegramHtml } from '../format/telegramHtml.js';
import { saveSetting, getSetting } from '../db/settings.js';
import { logger } from '../utils/logger.js';
import { validateProviderUrl, sanitizeErrorMessage } from '../utils/validateUrl.js';
import { FusionError } from '../utils/errors.js';
import type { FusionResult, RoutingProfile } from '../providers/types.js';
import type { RegisteredModel } from '../providers/types.js';

// ─── Telegram Meta Footer ─────────────────────────────
// Appends routing and performance info below the formatted answer.
interface MetaFooterOpts {
  profile: string;
  expertsUsed: number;
  judgeUsed: boolean;
  webSearched: boolean;
  webWarning?: string;
  estimatedCost: number;
  modelsUsed: string[];
  judgeModel?: string;
  synthesisModel: string;
  racedAhead?: boolean;
}

export function appendTelegramMetaFooter(
  content: string,
  opts: MetaFooterOpts
): string {
  const parts: string[] = [content, ''];

  // Separator
  parts.push('━━━━━━━━━━━━');
  parts.push('');

  // Routing section
  parts.push('⚙️ <b>Routing</b>');
  parts.push('• Profile: <b>' + opts.profile + '</b>');
  parts.push('• Experts used: ' + opts.expertsUsed + '/' + opts.modelsUsed.length);
  if (opts.racedAhead) {
    parts.push('• ⚡ Raced ahead (speed mode)');
  }
  parts.push('• Judge: ' + (opts.judgeUsed ? '✅ Used' : '❌ Not used'));
  parts.push('');

  // Web search
  if (opts.webSearched) {
    parts.push('🌐 <b>Web Search</b>');
    parts.push('• Searched the web for fresh information');
    if (opts.webWarning) {
      parts.push('• ⚠️ Warning: ' + opts.webWarning);
    }
    parts.push('');
  }

  // Models used
  parts.push('🤖 <b>Models</b>');
  if (opts.modelsUsed.length > 0) {
    parts.push('• Experts: <code>' + opts.modelsUsed.join('</code>, <code>') + '</code>');
  }
  if (opts.judgeModel) {
    parts.push('• Judge: <code>' + opts.judgeModel + '</code>');
  }
  parts.push('• Synthesis: <code>' + opts.synthesisModel + '</code>');
  parts.push('');

  // Cost estimate (formatted nicely)
  if (opts.estimatedCost > 0) {
    const costStr = opts.estimatedCost < 0.0001
      ? '< $0.0001'
      : '$' + opts.estimatedCost.toFixed(4);
    parts.push('💰 <b>Cost</b>');
    parts.push('• Estimated: ' + costStr);
    parts.push('');
  }

  // Tip
  parts.push('💡 Use <code>/stats</code> for session details');

  return parts.join('\n');
}

// ─── Error Message Formatters (pure, testable) ──────────
export function formatAllExpertsFailed(
  errors: Array<{ provider: string; model: string; error: string }>
): string {
  const lines = errors.map((e) => `• ${e.provider} (${e.model}): ${e.error}`);
  return (
    'None of the available AI models responded successfully:\n\n' +
    lines.join('\n') +
    '\n\nWhat to try:\n' +
    '- Verify your API keys with /listkeys\n' +
    '- Enable more providers with /providers'
  );
}

export function formatNoExpertsConfigured(): string {
  return (
    'No AI models are available. You have not added any provider API keys yet.\n\n' +
    'Add a key to get started, for example:\n' +
    '/addkey groq gsk_your_key_here\n\n' +
    'Then send a message. See /providers for supported providers.'
  );
}

// ─── Handle Fusion Command ───────────────────────────────
export async function handleFusionCommand(
  message: string,
  options: {
    sessionId?: string;
    source?: 'telegram' | 'api' | 'webhook';
    profile?: RoutingProfile;
    web?: 'on' | 'off' | 'auto';
  } = {}
): Promise<FusionResult> {
  const normalized = normalizeInput(message, options);
  const parsed = parseCommand(normalized.cleaned);

  // Route to appropriate handler
  switch (parsed.type) {
    case 'message':
      return handleChatMessage(normalized.sessionId, parsed.text, normalized.source, parsed.profileOverride, normalized.web);

    // Profile commands
    case 'help':
      return handleHelp(parsed.args[0]);
    case 'profile':
      return handleProfile(normalized.sessionId, parsed.args);
    case 'speed':
    case 'balanced':
    case 'quality':
    case 'custom':
      if (parsed.text) {
        return handleChatMessage(normalized.sessionId, parsed.text, normalized.source, parsed.type as RoutingProfile, normalized.web);
      }
      return handleSetProfile(normalized.sessionId, parsed.type as RoutingProfile);

    // Providers/Models
    case 'models':
      return handleListModels();
    case 'providers':
      return handleListProviders();
    case 'addkey':
      return handleAddKey(parsed.args);
    case 'deletekey':
      return handleDeleteKey(parsed.args);
    case 'listkeys':
      return handleListKeys();
    case 'addprovider':
      return handleAddProvider(parsed.text);
    case 'deleteprovider':
      return handleDeleteProvider(parsed.args);
    case 'enableprovider':
    case 'disableprovider':
      return handleToggleProvider(parsed.type, parsed.args);
    case 'addmodel':
      return handleAddModel(parsed.text);
    case 'deletemodel':
      return handleDeleteModel(parsed.args);
    case 'usemodel':
      return handleUseModel(normalized.sessionId, parsed.args);
    case 'unusemodel':
      return handleUnuseModel(normalized.sessionId, parsed.args);
    case 'setjudge':
      return handleSetJudge(normalized.sessionId, parsed.args);
    case 'setsynthesis':
      return handleSetSynthesis(normalized.sessionId, parsed.args);

    // Web search
    case 'addsearchkey':
      return handleAddSearchKey(parsed.args);
    case 'web':
      return handleWeb(normalized.sessionId, parsed.args);
    case 'search':
      return handleSearchQuery(normalized.sessionId, parsed.text);

    // Memory
    case 'memory':
      return handleShowMemory(normalized.sessionId);
    case 'clearmemory':
      return handleClearMemory(normalized.sessionId, parsed.args);

    // Tokens
    case 'tokens':
      return handleShowTokens();
    case 'settokens':
      return handleSetTokens(parsed.args);
    case 'resettokens':
      return handleResetTokens(parsed.args);

    // Wizard
    case 'wizard':
      return handleWizard(normalized.sessionId, parsed.args);

    // New chat / stats
    case 'newchat':
      return handleNewChat(normalized.sessionId);
    case 'stats':
      return handleStats(normalized.sessionId);

    // Reasoning effort
    case 'reasoning':
      return handleReasoning(normalized.sessionId, parsed.args);

    // Skills
    case 'skills':
      return handleSkills(normalized.sessionId, parsed.args);

    // Registry reset
    case 'resetregistry':
      return handleResetRegistry(parsed.args);

    default:
      return {
        answer: `Unknown command: ${parsed.type}. Use /help to see available commands.`,
        telegramHtml: `Unknown command. Use /help to see available commands.`,
        meta: getEmptyMeta(normalized.sessionId),
      };
  }
}

// ─── Handle Chat Message (the main fusion flow) ─────────
async function handleChatMessage(
  sessionId: string,
  message: string,
  source: string,
  profileOverride?: RoutingProfile,
  webOverride?: 'on' | 'off' | 'auto'
): Promise<FusionResult> {
  const session = await getOrCreateSession(sessionId, source);
  const profile = profileOverride || session.profile as RoutingProfile || 'balanced';
  // Per-request web override takes precedence over the session's persisted mode.
  const webMode = (webOverride ?? session.webMode) as 'on' | 'off' | 'auto';
  // Reasoning effort from session settings
  const reasoningEffort = session.reasoningEffort;

  // Load history BEFORE saving the current message, so `history` contains only
  // prior turns. The current message is then appended once (as the final user
  // turn) by runExpertPanel/runSynthesis. Saving first would duplicate the
  // current message in the history AND as the final user message.
  const history = await getSessionMessages(sessionId);

  // Save user message
  await saveMessage(sessionId, 'user', message);

  // When there is prior conversation history, build a context-aware prompt
  // for the models. Unlike the old approach (which only quoted the last prior
  // user turn), we now include a summary of ALL prior user turns so that
  // cheap models have full context even in long conversations.
  // The original `message` is unchanged in the DB; only the in-call prompt is
  // augmented.
  const priorUserTurns = history.filter((m) => m.role === 'user');
  let effectiveMessage = message;
  if (priorUserTurns.length > 0) {
    // Summarize the last 3 prior user turns (or all if fewer) so the model
    // has full conversational context.
    const recentTurns = priorUserTurns.slice(-3);
    if (recentTurns.length === 1) {
      effectiveMessage = `In our prior conversation, the user previously asked: "${recentTurns[0].content}". Now they ask: ${message}`;
    } else {
      const summary = recentTurns
        .map((t, i) => `${i + 1}. "${t.content}"`)
        .join('\n');
      effectiveMessage =
        `In our prior conversation, the user asked:\n${summary}\n\nNow they ask: ${message}`;
    }
  }

  // Determine web search
  let webContext = '';
  let webSearched = false;
  let webWarning: string | undefined;

  const shouldSearch = webMode === 'on' || (webMode === 'auto' && shouldAutoSearch(message));

  if (shouldSearch) {
    try {
      const searchResult = await searchWeb(message);
      webContext = formatSearchResults(searchResult.results);
      webSearched = true;
    } catch (error) {
      webWarning = String(error);
      logger.warn('Web search failed, continuing without it', { error: webWarning });
    }
  }

  // ── Query complexity analysis ──────────────────────────
  // Lightweight classifier that auto-selects profile based on query type.
  // Only overrides for this single request; the session profile is preserved.
  let effectiveProfile: RoutingProfile = profile;
  const complexity = analyzeQueryComplexity(message);
  // Only auto-adjust when the session has no explicit profile (i.e. is on the
  // default 'balanced') AND the user didn't provide a per-request override.
  if (complexity && !profileOverride && profile === 'balanced') {
    const profileMap: Record<string, RoutingProfile> = {
      simple: 'speed',
      complex: 'quality',
      balanced: 'balanced',
    };
    effectiveProfile = profileMap[complexity] || profile;
    if (effectiveProfile !== profile) {
      logger.info(
        `Complexity analysis: "${complexity}" → ${effectiveProfile} (session profile: ${profile})`
      );
    }
  }

  // Select models (using effective profile)
  const routing = await selectExperts(
    effectiveProfile,
    {
      preferredExperts: session.preferredExperts,
      preferredJudge: session.preferredJudge,
      preferredSynthesis: session.preferredSynthesis,
    }
  );

  // ── Race mode ──────────────────────────────────────────
  // For speed/balanced, proceed to synthesis once 2 experts respond.
  // For quality (and custom), wait for all experts for maximum depth.
  const minResponsesForRace =
    effectiveProfile === 'speed' || effectiveProfile === 'balanced' ? 2 : 0;

  // Run expert panel
  const expertResult = await runExpertPanel(routing.experts, effectiveMessage, history, {
    minResponses: minResponsesForRace,
    reasoningEffort,
  });

  const responseErrors: Array<{ provider: string; model: string; error: string }> =
    expertResult.errors.map((e) => ({
      provider: e.provider,
      model: e.model,
      error: e.error,
    }));

  // If all experts fail
  if (expertResult.responses.length === 0) {
    const errorAnswer =
      routing.experts.length === 0
        ? formatNoExpertsConfigured()
        : formatAllExpertsFailed(responseErrors);

    const result: FusionResult = {
      answer: errorAnswer,
      telegramHtml: convertToTelegramHtml(errorAnswer),
      meta: {
        ...getEmptyMeta(sessionId),
        routing: {
          profile,
          expertsUsed: 0,
          judgeUsed: false,
          synthesisUsed: false,
          continued: false,
          truncated: false,
        },
        web: { enabled: shouldSearch, searched: webSearched, resultsCount: 0, warning: webWarning },
        errors: responseErrors,
      },
    };

    await saveMessage(sessionId, 'assistant', errorAnswer, { meta: result.meta });
    return result;
  }

  // Run judge
  let judgeResult: { evaluation: string; modelUsed: string; success: boolean; scores?: Record<string, number> } = { evaluation: '', modelUsed: '', success: false };
  let judgeUsed = false;
  if (routing.judge) {
    judgeResult = await runJudge(routing.judge, effectiveMessage, expertResult.responses, webContext, reasoningEffort);
    judgeUsed = true;
    if (judgeResult.scores && Object.keys(judgeResult.scores).length > 0) {
      logger.debug(`Judge confidence scores: ${JSON.stringify(judgeResult.scores)}`);
    }
  }

  // Run synthesis
  let synthesisResult = await runSynthesis(
    routing.synthesis || routing.experts[0],
    effectiveMessage,
    expertResult.responses,
    judgeResult.evaluation || 'Using expert responses directly.',
    webContext,
    history,
    reasoningEffort
  );

  if (!synthesisResult.success) {
    // Fallback: synthesis failed or returned empty content — use the first
    // successful expert response so the user always gets an answer when at
    // least one expert succeeded.
    if (expertResult.responses.length > 0) {
      synthesisResult = {
        content: expertResult.responses[0].content,
        modelUsed: (routing.synthesis || routing.experts[0]).id,
        success: true,
      };
    }
  }

  // Handle truncation
    let finalContent = synthesisResult.content;
    let continued = false;
    let truncated = false;

    if (synthesisResult.finishReason && isTruncated(synthesisResult.finishReason)) {
      truncated = true;
      const continuationResult = await continueResponse(
        synthesisResult.content,
        routing.synthesis || routing.experts[0],
        synthesisResult.finishReason,
        reasoningEffort
      );
      finalContent = continuationResult.fullContent;
      continued = continuationResult.continued;
    }

    // ── Confidence Scoring ──────────────────────────────────────
    // Compute confidence based on expert success rate, judge agreement,
    // synthesis quality, web search, and provider errors
    const synthesisQuality = estimateSynthesisQuality(
      finalContent,
      expertResult.responses,
      routing.synthesis || routing.experts[0]
    );

    const confidence = computeConfidence(
      {
        expertSuccessRate: routing.experts.length > 0 ? expertResult.responses.length / routing.experts.length : 0,
        judgeAgreement: judgeResult.scores ? 1 : 0,
        synthesisQuality,
        webSearchUsed: webSearched,
        providerErrors: expertResult.errors.length,
        complexity: analyzeQueryComplexity(effectiveMessage) || 'balanced',
      },
      expertResult.responses.length,
      routing.experts.length,
      judgeResult.scores
    );

    const totalExperts = routing.experts.length;
    const totalCalls = (judgeUsed ? 1 : 0) + 1 + (continued ? 1 : 0);

  // ── Cost estimate ───────────────────────────────────────
  // Rough per-call cost based on model speed/quality class.
  const expertCalls = routing.experts.map((m) => ({
    speedClass: m.speedClass,
    qualityClass: m.qualityClass,
  }));
  const judgeCall = routing.judge ? [{
    speedClass: routing.judge.speedClass,
    qualityClass: routing.judge.qualityClass,
  }] : [];
  const synthesisCall = [{
    speedClass: (routing.synthesis || routing.experts[0]).speedClass,
    qualityClass: (routing.synthesis || routing.experts[0]).qualityClass,
  }];

  const estimatedCostUsd =
    estimateTotalCost(expertCalls) +
    estimateTotalCost(judgeCall) +
    estimateTotalCost(synthesisCall) +
    (continued ? estimateTotalCost(synthesisCall) : 0);

  // Format response with enhanced meta footer (must be after cost estimate)
  const formattedContent = convertToTelegramHtml(finalContent);
  const telegramHtml = appendTelegramMetaFooter(formattedContent, {
    profile: effectiveProfile,
    expertsUsed: expertResult.responses.length,
    judgeUsed,
    webSearched,
    webWarning,
    estimatedCost: estimatedCostUsd,
    modelsUsed: routing.experts.map((m) => m.id),
    judgeModel: routing.judge?.id,
    synthesisModel: (routing.synthesis || routing.experts[0]).id,
    racedAhead: expertResult.racedAhead ? true : false,
  });

  // Build meta
    const result: FusionResult = {
      answer: finalContent,
      telegramHtml,
      meta: {
        routing: {
          profile,
          expertsUsed: expertResult.responses.length,
          judgeUsed,
          synthesisUsed: true,
          continued,
          truncated,
        },
        models: {
          experts: routing.experts.map((m) => m.id),
          judge: routing.judge?.id,
          synthesis: (routing.synthesis || routing.experts[0]).id,
        },
        web: {
          enabled: shouldSearch,
          searched: webSearched,
          resultsCount: webContext ? webContext.split('\n').length : 0,
          warning: webWarning,
        },
        memory: {
          sessionId,
          messagesLoaded: history.length,
          messagesSaved: true,
        },
        tokens: {
          expert: config.expertMaxTokens,
          judge: config.judgeMaxTokens,
          synthesis: config.synthesisMaxTokens,
          continuation: config.continuationMaxTokens,
          totalEstimated:
            config.expertMaxTokens * totalExperts +
            config.judgeMaxTokens * (judgeUsed ? 1 : 0) +
            config.synthesisMaxTokens +
            config.continuationMaxTokens * (continued ? 1 : 0),
        },
        errors: responseErrors.length > 0 ? responseErrors : undefined,
        judgeScores: judgeResult.scores,
        racedAhead: typeof expertResult.racedAhead === 'number' ? expertResult.racedAhead : 0,
        estimatedCostUsd,
        reasoningEffort,
        confidence: {
          score: confidence.score,
          level: confidence.level,
          reasons: confidence.reasons,
          factors: confidence.factors,
        },
      },
    };

  // Save assistant message
  await saveMessage(sessionId, 'assistant', finalContent, {
    meta: result.meta,
  });

  return result;
}

// ─── Empty Meta ──────────────────────────────────────────
function getEmptyMeta(sessionId: string) {
  return {
    routing: {
      profile: 'balanced' as const,
      expertsUsed: 0,
      judgeUsed: false,
      synthesisUsed: false,
      continued: false,
      truncated: false,
    },
    models: { experts: [] },
    web: { enabled: false, searched: false, resultsCount: 0 },
    memory: { sessionId, messagesLoaded: 0, messagesSaved: false },
    tokens: {
      expert: config.expertMaxTokens,
      judge: config.judgeMaxTokens,
      synthesis: config.synthesisMaxTokens,
      continuation: config.continuationMaxTokens,
      totalEstimated: 0,
    },
  };
}

// ─── Command: /help [command] ─────────────────────────────
async function handleHelp(command?: string): Promise<FusionResult> {
  if (command) {
    return showCommandHelp(command);
  }
  return showFullHelp();
}

export function showCommandHelp(cmd: string): FusionResult {
  const meta = getEmptyMeta('');
  const detail = COMMAND_HELP[cmd.toLowerCase()];
  if (detail) {
    const msg = `<b>/${cmd}</b>\n\n${detail}`;
    return { answer: msg, telegramHtml: msg, meta };
  }
  const msg = `Unknown command: <b>/${cmd}</b>\n\nUse /help to see all available commands.`;
  return { answer: msg, telegramHtml: msg, meta };
}

export const COMMAND_HELP: Record<string, string> = {
  profile: 'Change or view your current routing profile.\n\n' +
    'Usage: /profile [speed|balanced|quality|custom]\n\n' +
    'Profiles control which models are used for answering:\n' +
    '• <b>speed</b> — Fast, lightweight models for quick answers\n' +
    '• <b>balanced</b> — Good balance of speed and quality (default)\n' +
    '• <b>quality</b> — Deeper reasoning with stronger models\n' +
    '• <b>custom</b> — Manually select which models to use\n\n' +
    'Without arguments, shows the current profile.',

  speed: 'Switch to speed profile for quick answers.\n\n' +
    'Usage: /speed [question]\n\n' +
    'Without a question, sets the session profile to speed.\n' +
    'With a question, answers it using the speed profile without changing your session.',

  balanced: 'Switch to balanced profile (default).\n\n' +
    'Usage: /balanced [question]\n\n' +
    'Works the same as /speed but uses the balanced routing profile.',

  quality: 'Switch to quality profile for deeper reasoning.\n\n' +
    'Usage: /quality [question]\n\n' +
    'Works the same as /speed but uses the quality routing profile with stronger models.',

  custom: 'Switch to custom profile for manual model selection.\n\n' +
    'Usage: /custom [question]\n\n' +
    'When you switch to custom profile, you\'ll see a list of available models.\n' +
    'Use <code>/add &lt;modelKey&gt;</code> to pick which models participate in your custom set.\n' +
    'Use <code>/remove &lt;modelKey&gt;</code> to remove models.',

  models: 'List all available AI models across all providers.\n\n' +
    'Usage: /models\n\n' +
    'Shows each model with status, credential status, speed/quality ratings, and roles.',

  providers: 'List all configured AI providers.\n\n' +
    'Usage: /providers\n\n' +
    'Shows each provider with endpoint, speed/quality ratings, token limits, and key status.',

  addkey: 'Add an API key for a provider.\n\n' +
    'Usage: /addkey &lt;providerId&gt; &lt;apiKey&gt;\n\n' +
    'Example: /addkey groq gsk_abc123...\n\n' +
    'Use /providers to see available provider IDs.',

  deletekey: 'Delete a stored API key for a provider.\n\n' +
    'Usage: /deletekey &lt;providerId&gt;\n\n' +
    'Note: Only removes keys added via /addkey. Environment variable keys cannot be deleted.',

  listkeys: 'Show all configured API keys (masked).\n\n' +
    'Usage: /listkeys\n\n' +
    'Shows which providers have keys configured and whether they were set via /addkey or env vars.',

  addprovider: 'Add a custom API provider.\n\n' +
    'Usage: /addprovider {\"id\":\"name\",\"endpoint\":\"https://...\"}\n\n' +
    'Optional fields: label, speedClass, qualityClass, maxOutputTokens\n\n' +
    'Example: /addprovider {\"id\":\"my-provider\",\"endpoint\":\"https://api.example.com/v1\"}\n\n' +
    'Then add an API key and add models.',

  deleteprovider: 'Remove a custom provider.\n\n' +
    'Usage: /deleteprovider &lt;providerId&gt;\n\n' +
    'Note: Built-in preset providers cannot be deleted.',

  enableprovider: 'Enable a provider so its models can be used.\n\n' +
    'Usage: /enableprovider &lt;providerId&gt;\n\n' +
    'See /providers for available provider IDs.',

  disableprovider: 'Disable a provider.\n\n' +
    'Usage: /disableprovider &lt;providerId&gt;\n\n' +
    'Note: Built-in preset providers cannot be disabled via this command.',

  addmodel: 'Add a custom model to a provider.\n\n' +
    'Usage: /addmodel {\"provider\":\"p\",\"key\":\"my_model\",\"model\":\"model-id\"}\n\n' +
    'Required fields: provider, key, model\n' +
    'Optional: title, useAs, speedClass, qualityClass, maxOutputTokens',

  deletemodel: 'Remove a custom model.\n\n' +
    'Usage: /deletemodel &lt;modelKey&gt;\n\n' +
    'Note: Built-in preset models cannot be deleted.',

  enablemodel: 'Alias for /usemodel.\n\n' +
    'Usage: /enablemodel &lt;modelKey&gt;\n\n' +
    'See /help usemodel for details.',

  disablemodel: 'Alias for /unusemodel.\n\n' +
    'Usage: /disablemodel &lt;modelKey&gt;\n\n' +
    'See /help unusemodel for details.',

  usemodel: 'Add a model to your custom expert set.\n\n' +
    'Usage: /usemodel &lt;modelKey&gt;\n\n' +
    'Aliases: /add, /enablemodel\n' +
    'Sets profile to custom. Use /models to see available model keys.',

  add: 'Alias for /usemodel.\n\n' +
    'Usage: /add &lt;modelKey&gt;\n\n' +
    'See /help usemodel for details.',

  unusemodel: 'Remove a model from your custom expert set.\n\n' +
    'Usage: /unusemodel &lt;modelKey&gt;\n\n' +
    'Aliases: /remove, /disablemodel',

  remove: 'Alias for /unusemodel.\n\n' +
    'Usage: /remove &lt;modelKey&gt;\n\n' +
    'See /help unusemodel for details.',

  setjudge: 'Set a specific model as the judge.\n\n' +
    'Usage: /setjudge &lt;modelKey&gt;\n\n' +
    'The judge evaluates expert responses and selects the best ones.',

  setsynthesis: 'Set a specific model as the synthesis model.\n\n' +
    'Usage: /setsynthesis &lt;modelKey&gt;\n\n' +
    'The synthesis model produces the final answer from expert responses.',

  reasoning: 'Control model reasoning effort for deeper thinking.\n\n' +
    'Usage: /reasoning [low|medium|high|xhigh]\n\n' +
    'Levels:\n' +
    '• <b>low</b> — Fast responses, minimal reasoning\n' +
    '• <b>medium</b> — Balanced reasoning (default)\n' +
    '• <b>high</b> — Deeper reasoning for complex tasks\n' +
    '• <b>xhigh</b> — Maximum reasoning depth (may be slow)\n\n' +
    'Without arguments, shows the current reasoning effort level.',

  skills: 'Load, unload, or search for AI skills\n' +
    'that adapt the fusion pipeline to specific tasks.\n\n' +
    'Usage: /skills [load &lt;name&gt;|unload|search &lt;query&gt;]\n\n' +
    'Sub-commands:\n' +
    '• <b>/skills</b> — List all available skills\n' +
    '• <b>/skills load &lt;name&gt;</b> — Load and activate a skill\n' +
    '• <b>/skills unload</b> — Unload the current skill\n' +
    '• <b>/skills search &lt;query&gt;</b> — Find relevant skills\n\n' +
    'Skills are reusable prompt fragments that guide model behavior.\n' +
    'Built-in skills include Code Review, Web Design, Debugging,\n' +
    'Backend Development, Concise, and Educational.',

  addsearchkey: 'Add a Tavily API key for web search.\n\n' +
    'Usage: /addsearchkey tavily &lt;apikey&gt;\n\n' +
    'Get a free key at: https://tavily.com\n\n' +
    'Then enable web search with: /web on or /web auto',

  web: 'Control web search mode.\n\n' +
    'Usage: /web [on|off|auto]\n\n' +
    'Modes:\n' +
    '• <b>on</b> — Always search the web before answering\n' +
    '• <b>off</b> — Never search the web\n' +
    '• <b>auto</b> — Automatically search for time-sensitive questions\n\n' +
    'Requires a Tavily API key (see /help addsearchkey).',

  search: 'Perform a raw web search and display results.\n\n' +
    'Usage: /search &lt;query&gt;\n\n' +
    'Example: /search latest AI news 2026\n\n' +
    'Shows summary, results, and source URLs without using AI models.',

  memory: 'Show recent conversation history for the current session.\n\n' +
    'Usage: /memory\n\n' +
    'Displays last messages with profile, web mode, and session info.',

  clearmemory: 'Clear the current session\'s conversation history.\n\n' +
    'Usage: /clearmemory confirm\n\n' +
    '⚠️ Requires confirmation. This cannot be undone.\n\n' +
    'Preserves session ID, profile, and web mode settings.',

  newchat: 'Clear current session memory for a fresh start.\n\n' +
    'Usage: /newchat\n\n' +
    'Same as /clearmemory confirm but without the confirmation prompt.',

  stats: 'Show session statistics and configuration.\n\n' +
    'Usage: /stats\n\n' +
    'Displays session ID, profile, web mode, message count, custom experts, and token budgets.',

  tokens: 'Show current token budget settings.\n\n' +
    'Usage: /tokens\n\n' +
    'Shows expert, judge, synthesis, and continuation token limits.',

  settokens: 'Set token budgets for the fusion pipeline.\n\n' +
    'Usage: /settokens &lt;expert&gt; &lt;judge&gt; &lt;synthesis&gt;\n\n' +
    'Example: /settokens 2000 1500 4000\n\n' +
    'These control how many tokens each stage can use.',

  resettokens: 'Reset token budgets to default values.\n\n' +
    'Usage: /resettokens confirm\n\n' +
    'Defaults: expert=22500, judge=16200, synthesis=45000',

  resetregistry: 'Delete all custom providers and models.\n\n' +
    'Usage: /resetregistry confirm\n\n' +
    '⚠️ Requires confirmation. Preserves built-in presets.',

  wizard: 'Quick setup wizard for new users.\n\n' +
    'Guides you through adding an API key, choosing a profile, and configuring web search.\n\n' +
    'Usage: /wizard\n' +
    'Sub-commands:\n' +
    '• <code>/wizard</code> — Show current step and instructions\n' +
    '• <code>/wizard key &lt;provider&gt; &lt;apikey&gt;</code> — Add API key and advance\n' +
    '• <code>/wizard profile &lt;speed|balanced|quality&gt;</code> — Set profile\n' +
    '• <code>/wizard web &lt;tavily_key&gt;</code> — Set up web search\n' +
    '• <code>/wizard skip</code> — Skip current step\n' +
    '• <code>/wizard status</code> — Show progress\n' +
    '• <code>/wizard start</code> — Reset wizard\n' +
    '• <code>/wizard done</code> — Mark setup complete',

  help: 'Get detailed help for any command.\n\n' +
    'Usage: /help <command>\n\n' +
    'Examples:\n' +
    '/help web\n' +
    '/help addkey\n' +
    '/help usemodel\n\n' +
    'Without arguments, shows the full command list.',
};

export function showFullHelp(): FusionResult {
  const help = `🤖 <b>Free Model Fusion</b>\n\n` +
    `Turn your free AI API keys into a smarter multi-model assistant.\n\n` +
    `<b>Commands:</b>\n\n` +
    `<b>Profiles:</b>\n` +
    `/profile [speed|balanced|quality|custom]\n` +
    `/speed [question] - Speed mode (quick answers)\n` +
    `/balanced [question] - Balanced mode (default)\n` +
    `/quality [question] - Quality mode (deeper reasoning)\n` +
    `/custom - Custom expert selection\n\n` +
    `<b>Models & Providers:</b>\n` +
    `/models - List all available models\n` +
    `/providers - List all providers\n` +
    `/addkey <provider> <apikey> - Add API key\n` +
    `/deletekey <provider> - Remove a key\n` +
    `/listkeys - Show configured keys\n` +
    `/addprovider {...} - Custom provider\n` +
    `/deleteprovider <id> - Remove custom provider\n` +
    `/enableprovider <id> - Enable a provider\n` +
    `/disableprovider <id> - Disable a provider\n` +
    `/addmodel {...} - Custom model\n` +
    `/deletemodel <key> - Remove custom model\n` +
    `/usemodel <key> (alias: /add) - Pick a model\n` +
    `/unusemodel <key> (alias: /remove) - Remove model\n` +
    `/setjudge <key> - Choose judge model\n` +
    `/setsynthesis <key> - Choose synthesis model\n` +
    `/reasoning [low|medium|high|xhigh] - Set reasoning effort\n\n` +
    `<b>Web Search:</b>\n` +
    `/addsearchkey tavily <apikey>\n` +
    `/web [on|off|auto]\n` +
    `/search <query> - Show raw search results\n\n` +
    `<b>Memory:</b>\n` +
    `/memory - Show recent conversation\n` +
    `/clearmemory confirm - Clear session memory\n` +
    `/newchat - Start fresh\n\n` +
    `<b>Setup & Wizard:</b>\n` +
    `/wizard - Guided setup (key / profile / web)\n` +
    `/wizard status - Check progress\n\n` +
    `<b>Session & Stats:</b>\n` +
    `/stats - Session statistics\n` +
    `/tokens - Show token budgets\n` +
    `/settokens <expert> <judge> <synthesis>\n` +
    `/resettokens confirm\n\n` +
    `<b>Examples:</b>\n` +
    `/addkey groq gsk_abc...\n` +
    `/quality Explain quantum computing\n` +
    `/speed What is 2+2?\n` +
    `/web auto\n` +
    `/search latest AI news 2026\n` +
    `/add llama3-8b\n\n` +
    `Get detailed help: /help <command>`;
  return { answer: help, telegramHtml: help, meta: getEmptyMeta('') };
}

// ─── Command: /profile ───────────────────────────────────
async function handleProfile(sessionId: string, args: string[]): Promise<FusionResult> {
  if (args.length === 0) {
    const session = await getOrCreateSession(sessionId);
    const msg = `Current profile: <b>${session.profile}</b>\n\nUse /profile speed|balanced|quality|custom to change.`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
  }

  const profile = args[0].toLowerCase();
  if (!['speed', 'balanced', 'quality', 'custom'].includes(profile)) {
    const msg = `Invalid profile: ${profile}. Use: speed, balanced, quality, or custom.`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
  }

  await updateSessionSettings(sessionId, { profile });

  if (profile === 'custom') {
    return showCustomModelPicker(sessionId);
  }

  const msg = `Profile changed to <b>${profile}</b>.`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
}

// ─── Command: /speed|/balanced|/quality|/custom (persistent set) ──
async function handleSetProfile(sessionId: string, profile: RoutingProfile): Promise<FusionResult> {
  await updateSessionSettings(sessionId, { profile });

  if (profile === 'custom') {
    return showCustomModelPicker(sessionId);
  }

  const msg = `Profile changed to <b>${profile}</b>.`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
}

// ─── Custom Model Picker (shared by /profile custom + /custom) ──
async function showCustomModelPicker(sessionId: string): Promise<FusionResult> {
  const session = await getOrCreateSession(sessionId);
  const models = await getAllModels();

  // Only show models that have a credential AND are enabled
  const available = models.filter(m => m.enabled && m.hasCredential);
  const current = (session.preferredExperts || []).filter(id => models.some(m => m.id === id));

  const lines: string[] = [
    '✅ <b>Profile set to custom</b> — you pick which models participate.\n',
  ];

  if (current.length > 0) {
    lines.push('<b>Currently selected:</b>');
    for (const id of current) {
      const m = models.find(x => x.id === id);
      if (m) {
        lines.push(`  ✅ <code>${id}</code> (${m.providerId})`);
      }
    }
    lines.push('');
  } else {
    lines.push('<b>No models selected yet.</b> Add some with:');
    lines.push('<code>/add &lt;modelKey&gt;</code>');
    lines.push('');
  }

  if (available.length > 0) {
    lines.push('<b>Available models (add any of these):</b>');
    for (const m of available) {
      const already = current.includes(m.id) ? ' ✅ <i>(selected)</i>' : '';
      lines.push(`  • <code>${m.id}</code> — ${m.title} (${m.providerId})${already}`);
    }
    lines.push('');
  } else {
    lines.push('<b>No available models.</b> Add an API key first with:');
    lines.push('<code>/addkey &lt;provider&gt; &lt;key&gt;</code>');
    lines.push('');
  }

  lines.push('<b>Usage:</b>');
  lines.push('• <code>/add &lt;modelKey&gt;</code> — add a model (aliases: /usemodel, /enablemodel)');
  lines.push('• <code>/remove &lt;modelKey&gt;</code> — remove a model (aliases: /unusemodel, /disablemodel)');
  lines.push('• <code>/models</code> — see all available models');

  const msg = lines.join('\n');
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
}

// ─── Command: /models ────────────────────────────────────
async function handleListModels(): Promise<FusionResult> {
  const models = await getAllModels();
  if (models.length === 0) {
    const msg = 'No models configured. Use /addmodel to add custom models.';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const lines = ['<b>Available Models:</b>\n'];
  for (const m of models) {
    const status = m.enabled ? '✅' : '❌';
    const cred = m.hasCredential ? '🔑' : '❌';
    const useAs = m.useAs.join(', ');
    lines.push(
      `${status} <code>${m.id}</code>`
    );
    lines.push(`   ${m.title} (${m.providerId})`);
    lines.push(`   Model: <code>${m.model}</code>`);
    lines.push(`   Use: ${useAs} | Speed: ${m.speedClass} | Quality: ${m.qualityClass} | Key: ${cred}`);
    lines.push('');
  }

  const msg = lines.join('\n');
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /providers ─────────────────────────────────
async function handleListProviders(): Promise<FusionResult> {
  const providers = await getAllProviders();
  if (providers.length === 0) {
    const msg = 'No providers configured.';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const lines = ['<b>Available Providers:</b>\n'];
  for (const p of providers) {
    const status = p.enabled ? '✅' : '❌';
    const cred = p.hasCredential ? '🔑' : '❌';
    const type = p.isPreset ? 'built-in' : 'custom';
    lines.push(
      `${status} <b>${p.label}</b> <code>${p.id}</code> (${type})`
    );
    lines.push(`   Endpoint: <code>${p.endpoint}</code>`);
    lines.push(`   Speed: ${p.speedClass} | Quality: ${p.qualityClass} | Max: ${p.maxOutputTokens} | Key: ${cred}`);
    lines.push('');
  }

  const msg = lines.join('\n');
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /addkey ────────────────────────────────────
async function handleAddKey(args: string[]): Promise<FusionResult> {
  if (args.length < 2) {
    const msg = 'Usage: /addkey &lt;providerId&gt; &lt;apiKey&gt;\nExample: /addkey groq gsk_abc123...';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const providerId = args[0].toLowerCase();
  const apiKey = args.slice(1).join('');

  await saveCredential(providerId, apiKey);
  const msg = `✅ API key saved for <b>${providerId}</b>.`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /deletekey ─────────────────────────────────
async function handleDeleteKey(args: string[]): Promise<FusionResult> {
  if (args.length < 1) {
    const msg = 'Usage: /deletekey &lt;providerId&gt;';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const providerId = args[0].toLowerCase();
  const success = await deleteCredential(providerId);
  const msg = success
    ? `🗑️ API key deleted for <b>${providerId}</b>.`
    : `No stored key found for <b>${providerId}</b>. (Note: env var keys cannot be deleted via this command.)`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /listkeys ──────────────────────────────────
async function handleListKeys(): Promise<FusionResult> {
  const creds = await listCredentials();
  if (creds.length === 0) {
    const msg = 'No API keys configured. Use /addkey &lt;provider&gt; &lt;key&gt; or set env vars.';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const lines = ['<b>Configured API Keys:</b>\n'];
  for (const c of creds) {
    lines.push(`• <b>${c.providerId}:</b> <code>${c.maskedKey}</code> (${c.source})`);
  }
  const msg = lines.join('\n');
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /addprovider ───────────────────────────────
async function handleAddProvider(text: string): Promise<FusionResult> {
  try {
    const data = JSON.parse(text);
    if (!data.id || !data.endpoint) {
      throw new Error('Missing required fields: id and endpoint');
    }
    // Validate URL for SSRF prevention
    validateProviderUrl(data.endpoint);
    await addCustomProvider({
      id: data.id,
      label: data.label || data.id,
      endpoint: data.endpoint,
      speedClass: data.speedClass,
      qualityClass: data.qualityClass,
      maxOutputTokens: data.maxOutputTokens,
    });
    const msg = `✅ Custom provider added: <b>${data.label || data.id}</b>\nEndpoint: <code>${data.endpoint}</code>\n\nAdd an API key: /addkey ${data.id} &lt;key&gt;\nAdd models: /addmodel {...}`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  } catch (error) {
    const sanitized = sanitizeErrorMessage(String(error));
    const msg = `Failed to add provider: ${sanitized}\n\nUsage: /addprovider {"id":"name","endpoint":"https://...","label":"Name"}`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }
}

// ─── Command: /deleteprovider ────────────────────────────
async function handleDeleteProvider(args: string[]): Promise<FusionResult> {
  if (args.length < 1) {
    const msg = 'Usage: /deleteprovider &lt;providerId&gt;';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const success = await deleteCustomProvider(args[0]);
  const msg = success
    ? `🗑️ Custom provider deleted: <b>${args[0]}</b>`
    : `Provider <b>${args[0]}</b> not found or is a built-in preset. Built-in providers cannot be deleted.`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /enableprovider / /disableprovider ─────────
async function handleToggleProvider(type: string, args: string[]): Promise<FusionResult> {
  if (args.length < 1) {
    const msg = `Usage: /${type} &lt;providerId&gt;`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const enabled = type === 'enableprovider';
  const success = await setProviderEnabled(args[0], enabled);
  const action = enabled ? 'Enabled' : 'Disabled';
  const msg = success
    ? `${action} provider: <b>${args[0]}</b>`
    : `Provider <b>${args[0]}</b> not found or is a built-in preset. Built-in providers cannot be disabled via this command.`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /addmodel ──────────────────────────────────
async function handleAddModel(text: string): Promise<FusionResult> {
  try {
    const data = JSON.parse(text);
    if (!data.provider || !data.key || !data.model) {
      throw new Error('Missing required fields: provider, key, and model');
    }

    const { db } = await import('../db/client.js');
    const { customModels } = await import('../db/schema.js');

    await db.insert(customModels).values({
      id: data.key,
      providerId: data.provider,
      title: data.title || data.key,
      model: data.model,
      useAs: JSON.stringify(data.useAs || ['expert']),
      enabled: true,
      speedClass: data.speedClass || 'medium',
      qualityClass: data.qualityClass || 'good',
      maxOutputTokens: data.maxOutputTokens || 8192,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const msg = `✅ Custom model added: <b>${data.key}</b>\nProvider: ${data.provider}\nModel: <code>${data.model}</code>\nUse: ${(data.useAs || ['expert']).join(', ')}`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  } catch (error) {
    const msg = `Failed to add model: ${String(error)}\n\nUsage: /addmodel {"provider":"p","key":"my_model","model":"model-id","useAs":["expert"]}`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }
}

// ─── Command: /deletemodel ───────────────────────────────
async function handleDeleteModel(args: string[]): Promise<FusionResult> {
  if (args.length < 1) {
    const msg = 'Usage: /deletemodel &lt;modelKey&gt;';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const { db } = await import('../db/client.js');
  const { customModels } = await import('../db/schema.js');
  const { eq } = await import('drizzle-orm');

  const result = await db
    .delete(customModels)
    .where(eq(customModels.id, args[0]))
    .returning();

  const msg = result.length > 0
    ? `🗑️ Custom model deleted: <b>${args[0]}</b>`
    : `Model <b>${args[0]}</b> not found or is a built-in preset.`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /usemodel ──────────────────────────────────
async function handleUseModel(sessionId: string, args: string[]): Promise<FusionResult> {
  if (args.length < 1) {
    const msg = 'Usage: /usemodel &lt;modelKey&gt;';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const model = await getModelById(args[0]);
  if (!model) {
    const msg = `Model <b>${args[0]}</b> not found. Use /models to see available models.`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const session = await getOrCreateSession(sessionId);
  const experts = session.preferredExperts.filter((e) => e !== args[0]);
  experts.push(args[0]);

  await updateSessionSettings(sessionId, { preferredExperts: experts, profile: 'custom' });
  const msg = `✅ Model <b>${args[0]}</b> added to preferred experts. Profile set to <b>custom</b>.`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /unusemodel ────────────────────────────────
async function handleUnuseModel(sessionId: string, args: string[]): Promise<FusionResult> {
  if (args.length < 1) {
    const msg = 'Usage: /unusemodel &lt;modelKey&gt;';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const session = await getOrCreateSession(sessionId);
  const experts = session.preferredExperts.filter((e) => e !== args[0]);

  await updateSessionSettings(sessionId, { preferredExperts: experts });
  const msg = `✅ Model <b>${args[0]}</b> removed from preferred experts.`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /setjudge ──────────────────────────────────
async function handleSetJudge(sessionId: string, args: string[]): Promise<FusionResult> {
  if (args.length < 1) {
    const msg = 'Usage: /setjudge &lt;modelKey&gt;';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const model = await getModelById(args[0]);
  if (!model) {
    const msg = `Model <b>${args[0]}</b> not found.`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  await updateSessionSettings(sessionId, { preferredJudge: args[0] });
  const msg = `✅ Judge set to: <b>${args[0]}</b>`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /setsynthesis ──────────────────────────────
async function handleSetSynthesis(sessionId: string, args: string[]): Promise<FusionResult> {
  if (args.length < 1) {
    const msg = 'Usage: /setsynthesis &lt;modelKey&gt;';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const model = await getModelById(args[0]);
  if (!model) {
    const msg = `Model <b>${args[0]}</b> not found.`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  await updateSessionSettings(sessionId, { preferredSynthesis: args[0] });
  const msg = `✅ Synthesis set to: <b>${args[0]}</b>`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /addsearchkey ──────────────────────────────
async function handleAddSearchKey(args: string[]): Promise<FusionResult> {
  if (args.length < 2) {
    const msg = 'Usage: /addsearchkey tavily &lt;apikey&gt;\nGet a key at: https://tavily.com';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const provider = args[0].toLowerCase();
  if (provider !== 'tavily') {
    const msg = 'Currently only <b>Tavily</b> is supported as a search provider.\nUsage: /addsearchkey tavily &lt;apikey&gt;';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const apiKey = args.slice(1).join('');
  // Store as a credential for tavily
  await saveCredential('tavily', apiKey);
  // Also set it in env so it's accessible
  Object.assign(config, { tavilyApiKey: apiKey });

  const msg = '✅ Tavily search API key saved. Web search is now available.\nUse /web on to enable auto-search.';
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /web ───────────────────────────────────────
async function handleWeb(sessionId: string, args: string[]): Promise<FusionResult> {
  if (args.length === 0) {
    const session = await getOrCreateSession(sessionId);
    const modes = ['off', 'auto', 'on'];
    const current = session.webMode;
    const lines = [
      `<b>Web Search Mode</b>`,
      `Current: <b>${current}</b>\n`,
      'Available modes:',
      ...modes.map((m) => `• <code>${m}</code>${m === current ? ' ← current' : ''}`),
      '',
      'Usage: /web on|off|auto',
    ];
    const msg = lines.join('\n');
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const mode = args[0].toLowerCase();
  if (!['on', 'off', 'auto'].includes(mode)) {
    const msg = 'Invalid mode. Use: on, off, or auto.';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  await updateSessionSettings(sessionId, { webMode: mode });
  let msg = `Web search mode changed to <b>${mode}</b>.${mode === 'auto' ? ' Will search automatically for current/research queries.' : ''}${mode === 'on' ? ' Will search the web for every query.' : ''}`;

  if ((mode === 'on' || mode === 'auto') && !config.tavilyApiKey) {
    msg += '\n\n⚠️ <b>Tavily API key is not configured.</b> Web search will fail until you set one.\nUse /addsearchkey tavily &lt;key&gt; or set the TAVILY_API_KEY env var.';
  }

  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
}

// ─── Command: /search ────────────────────────────────────
async function handleSearchQuery(sessionId: string, query: string): Promise<FusionResult> {
  if (!query) {
    const msg = 'Usage: /search &lt;query&gt;\nExample: /search latest AI news 2026';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  try {
    const result = await searchWeb(query);
    const lines = [
      `<b>🔍 Web Search Results</b>\n`,
      `Query: <code>${query}</code>\n`,
    ];

    if (result.answer) {
      lines.push(`<b>Summary:</b>\n${result.answer}\n`);
    }

    if (result.results.length > 0) {
      lines.push(`<b>Results:</b>\n`);
      for (const r of result.results) {
        lines.push(`• <b>${r.title}</b>`);
        lines.push(`  ${r.url}`);
        lines.push(`  ${r.content.slice(0, 300)}...`);
        lines.push('');
      }
    }

    const msg = lines.join('\n');
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  } catch (error) {
    const msg = `Search failed: ${String(error)}`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }
}

// ─── Command: /memory ────────────────────────────────────
async function handleShowMemory(sessionId: string): Promise<FusionResult> {
  const messages = await getSessionMessages(sessionId);
  const session = await getOrCreateSession(sessionId);

  if (messages.length === 0) {
    const msg = 'No conversation history for this session.';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const lines = [
    `<b>Conversation Memory</b>`,
    `Session: <code>${sessionId}</code>`,
    `Profile: ${session.profile}`,
    `Web mode: ${session.webMode}`,
    `Messages: ${messages.length}\n`,
  ];

  for (const msg of messages) {
    const role = msg.role === 'user' ? '👤' : '🤖';
    const content = msg.content.slice(0, 300);
    lines.push(`${role} <b>${msg.role.toUpperCase()}:</b>\n${content}\n`);
  }

  const msg = lines.join('\n');
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /clearmemory ───────────────────────────────
async function handleClearMemory(sessionId: string, args: string[]): Promise<FusionResult> {
  if (args.length === 0 || args[0].toLowerCase() !== 'confirm') {
    const msg = 'Are you sure? This cannot be undone.\n/clearmemory confirm';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  await clearSessionMemory(sessionId);
  const msg = '🗑️ Session memory cleared.';
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /tokens ────────────────────────────────────
async function handleShowTokens(): Promise<FusionResult> {
  const lines = [
    '<b>Token Settings</b>\n',
    `Expert: <code>${config.expertMaxTokens}</code>`,
    `Judge: <code>${config.judgeMaxTokens}</code>`,
    `Synthesis: <code>${config.synthesisMaxTokens}</code>`,
    `Continuation: <code>${config.continuationMaxTokens}</code>`,
    `Continuation enabled: ${config.enableContinuation}`,
    `Max continuations: ${config.maxContinuations}\n`,
    'To change: /settokens &lt;expert&gt; &lt;judge&gt; &lt;synthesis&gt;',
    'To reset: /resettokens confirm',
  ];
  const msg = lines.join('\n');
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /settokens ─────────────────────────────────
async function handleSetTokens(args: string[]): Promise<FusionResult> {
  if (args.length < 3) {
    const msg = 'Usage: /settokens &lt;expert&gt; &lt;judge&gt; &lt;synthesis&gt;\nExample: /settokens 2000 1500 4000';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const expert = parseInt(args[0], 10);
  const judge = parseInt(args[1], 10);
  const synthesis = parseInt(args[2], 10);

  if (isNaN(expert) || isNaN(judge) || isNaN(synthesis)) {
    const msg = 'All values must be numbers.';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  // Save to settings table
  await saveSetting('expertMaxTokens', String(expert));
  await saveSetting('judgeMaxTokens', String(judge));
  await saveSetting('synthesisMaxTokens', String(synthesis));

  // Update config
  (config as Record<string, unknown>).expertMaxTokens = expert;
  (config as Record<string, unknown>).judgeMaxTokens = judge;
  (config as Record<string, unknown>).synthesisMaxTokens = synthesis;

  const msg = `✅ Token settings updated:\nExpert: <code>${expert}</code>\nJudge: <code>${judge}</code>\nSynthesis: <code>${synthesis}</code>`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /resettokens ───────────────────────────────
async function handleResetTokens(args: string[]): Promise<FusionResult> {
  if (args.length === 0 || args[0].toLowerCase() !== 'confirm') {
    const msg = 'Reset token settings to defaults?\n/resettokens confirm';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  // Reset to env/defaults
  // Re-read from env
  const resetConfig = {
    expertMaxTokens: parseInt(process.env.FUSION_EXPERT_MAX_TOKENS || '22500', 10),
    judgeMaxTokens: parseInt(process.env.FUSION_JUDGE_MAX_TOKENS || '16200', 10),
    synthesisMaxTokens: parseInt(process.env.FUSION_SYNTHESIS_MAX_TOKENS || '45000', 10),
  };

  (config as Record<string, unknown>).expertMaxTokens = resetConfig.expertMaxTokens;
  (config as Record<string, unknown>).judgeMaxTokens = resetConfig.judgeMaxTokens;
  (config as Record<string, unknown>).synthesisMaxTokens = resetConfig.synthesisMaxTokens;

  const msg = `✅ Token settings reset to defaults:\nExpert: <code>${resetConfig.expertMaxTokens}</code>\nJudge: <code>${resetConfig.judgeMaxTokens}</code>\nSynthesis: <code>${resetConfig.synthesisMaxTokens}</code>`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /reasoning ────────────────────────────────
async function handleReasoning(
  sessionId: string,
  args: string[]
): Promise<FusionResult> {
  const validLevels = ['low', 'medium', 'high', 'xhigh'] as const;
  if (args.length === 0) {
    const session = await getOrCreateSession(sessionId);
    const current = session.reasoningEffort || 'medium';
    const msg = `Reasoning effort: <b>${current}</b>\n\nUsage: /reasoning low|medium|high|xhigh`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
  }

  const level = args[0].toLowerCase();
  if (!validLevels.includes(level as typeof validLevels[number])) {
    const msg = `Invalid level: ${level}. Use: low, medium, high, or xhigh.`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  // Ensure session exists before updating settings
  await getOrCreateSession(sessionId);
  await updateSessionSettings(sessionId, { reasoningEffort: level });
  const msg = `Reasoning effort set to <b>${level}</b>.`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
}

// ─── Command: /skills ────────────────────────────────────
async function handleSkills(
  sessionId: string,
  args: string[]
): Promise<FusionResult> {
  if (args.length === 0) {
    const skills = await listSkills();
    const active = await getActiveSkill();
    const activeName = active?.name ?? null;
    if (skills.length === 0) {
      const msg = 'No skills loaded. Use /skills load <name> to load a skill.';
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
    }
    const lines = [
      '<b>Available Skills:</b>\n',
      ...skills.map(s => {
        const isActive = s.name === activeName ? ' ✅ <b>(active)</b>' : '';
        return `• <code>${s.name}</code>${isActive}`;
      }),
      '',
      'Usage:',
      '• /skills load <name> — Load and activate a skill',
      '• /skills unload — Unload the current skill',
      '• /skills search <query> — Find relevant skills',
    ];
    const msg = lines.join('\n');
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
  }

  const sub = args[0].toLowerCase();

  if (sub === 'load' && args.length >= 2) {
    const skillName = args[1];
    const skill = await findSkill(skillName);
    if (!skill) {
      const msg = `Skill <b>${skillName}</b> not found. Use /skills to see available skills.`;
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
    }
    await loadSkill(skillName);
    const msg = `✅ Skill <b>${skillName}</b> loaded and activated.`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
  }

  if (sub === 'unload') {
    await unloadSkill();
    const msg = '🗑️ Current skill unloaded.';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
  }

  if (sub === 'search' && args.length >= 2) {
    const query = args.slice(1).join(' ');
    // findSkill does exact name matching
    const results = await findSkill(query);
    if (!results) {
      // List all skills so the user can see what's available
      const skills = await listSkills();
      if (skills.length > 0) {
        const names = skills.map(s => `• <code>${s.name}</code>`).join('\n');
        const msg = `No skill found matching <b>${query}</b>.\n\nAvailable skills:\n${names}`;
        return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
      }
      const msg = `No skill found matching <b>${query}</b>. No skills are currently loaded.`;
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
    }
    const msg = `Found skill: <b>${results.name}</b>\n\nTo load: /skills load ${results.name}`;
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
  }

  const msg = 'Usage: /skills [load <name>|unload|search <query>]';
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}

// ─── Command: /newchat ───────────────────────────────────
async function handleNewChat(sessionId: string): Promise<FusionResult> {
  await clearSessionMemory(sessionId);
  const msg = '🗑️ Session memory cleared. Your conversation starts fresh.\n\nPrevious messages in this session have been erased. The session ID, profile, and web mode are preserved.';
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
}

// ─── Command: /stats ─────────────────────────────────────
async function handleStats(sessionId: string): Promise<FusionResult> {
  const session = await getOrCreateSession(sessionId);
  const messages = await getSessionMessages(sessionId);
  const lines = [
    '<b>📊 Session Statistics</b>\n',
    `Session: <code>${sessionId}</code>`,
    `Profile: <b>${session.profile}</b>`,
    `Web search: <b>${session.webMode}</b>`,
    `Messages: <b>${messages.length}</b>`,
    `Custom experts: ${(session.preferredExperts || []).length > 0 ? session.preferredExperts.join(', ') : '(none — using profile defaults)'}`,
    `Judge: ${session.preferredJudge || '(auto-selected)'}`,
    `Synthesis: ${session.preferredSynthesis || '(auto-selected)'}`,
    '',
    'Token budgets:',
    `• Expert: <code>${config.expertMaxTokens}</code>`,
    `• Judge: <code>${config.judgeMaxTokens}</code>`,
    `• Synthesis: <code>${config.synthesisMaxTokens}</code>`,
  ];
  const msg = lines.join('\n');
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
}

// ─── Command: /wizard ───────────────────────────────────────
// Terminal onboarding wizard — guides new users through setup step by step.
// State is stored in the settings table as 'wizardState' (JSON).
// Steps: 0=Welcome, 1=Add API key, 2=Choose profile, 3=Web search, 4=Done

async function handleWizard(sessionId: string, args: string[]): Promise<FusionResult> {
  const { saveSetting, getSetting } = await import('../db/settings.js');

  // ── Sub-commands ────────────────────────────────────────
  if (args.length > 0) {
    const sub = args[0].toLowerCase();

    // /wizard start — reset wizard state to step 0
    if (sub === 'start' || sub === 'reset') {
      await saveSetting('wizardState', JSON.stringify({ step: 0, profile: 'balanced', key: false, web: false }));
      const msg = '🔄 Wizard reset. Type <code>/wizard</code> to begin.';
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
    }

    // /wizard status — show current progress
    if (sub === 'status') {
      const stateRaw = await getSetting('wizardState');
      const state = stateRaw ? JSON.parse(stateRaw) : { step: 0, profile: 'balanced', key: false, web: false };
      const keys = await listCredentials();
      const models = await getAllModels();
      const hasModels = models.some(m => m.enabled && m.hasCredential);
      const hasKey = keys.length > 0;

      const lines = [
        '<b>📋 Wizard Status</b>\n',
        `Step: <b>${state.step + 1}</b> / 5`,
        `API Key: ${hasKey || state.key ? '✅' : '⬜'} ${hasKey ? keys.length + ' key(s) configured' : 'Not yet configured'}`,
        `Profile: <b>${state.profile || 'balanced'}</b>`,
        `Web Search: ${state.web ? '✅' : '⬜'} ${state.web ? 'Configured' : 'Not configured'}`,
        `Models ready: ${hasModels ? '✅ Yes' : '⬜ Need API key first'}`,
        '',
        'Run <code>/wizard</code> to continue where you left off.',
        'Run <code>/wizard start</code> to reset.',
      ];
      const msg = lines.join('\n');
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
    }

    // /wizard key <provider> <key> — save API key and advance
    if (sub === 'key' && args.length >= 3) {
      const provider = args[1].toLowerCase();
      const apiKey = args.slice(2).join('');

      // Check if credential already exists
      const alreadyHasKey = await hasCredential(provider);

      await saveCredential(provider, apiKey);
      const stateRaw = await getSetting('wizardState');
      const state = stateRaw ? JSON.parse(stateRaw) : { step: 1, profile: 'balanced', key: false, web: false };
      state.key = true;
      if (state.step < 2) state.step = 2;
      await saveSetting('wizardState', JSON.stringify(state));

      const warning = alreadyHasKey ? '⚠️ <b>This credential is already registered.</b> It has been overwritten with the new key.\n\n' : '';
      const msg = `${warning}✅ Key saved for <b>${provider}</b>!\n\nType <code>/wizard</code> to continue to the next step.`;
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
    }

    // /wizard profile <speed|balanced|quality> — set profile and advance
    if (sub === 'profile' && args.length >= 2) {
      const profile = args[1].toLowerCase();
      if (!['speed', 'balanced', 'quality', 'custom'].includes(profile)) {
        const msg = 'Invalid profile. Use: speed, balanced, quality, or custom.';
        return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
      }
      await saveSetting('profile', profile);
      (config as Record<string, unknown>).defaultProfile = profile;
      await updateSessionSettings(sessionId, { profile });
      const stateRaw = await getSetting('wizardState');
      const state = stateRaw ? JSON.parse(stateRaw) : { step: 2, profile: 'balanced', key: false, web: false };
      state.profile = profile;
      if (state.step < 3) state.step = 3;
      await saveSetting('wizardState', JSON.stringify(state));
      const msg = `✅ Profile set to <b>${profile}</b>!\n\nType <code>/wizard</code> to continue to the next step.`;
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
    }

    // /wizard web <tavily_key> — save web search key and advance
    if (sub === 'web' && args.length >= 2) {
      const key = args.slice(1).join('');
      await saveCredential('tavily', key);
      Object.assign(config, { tavilyApiKey: key });
      await saveSetting('webMode', 'auto');
      await updateSessionSettings(sessionId, { webMode: 'auto' });
      const stateRaw = await getSetting('wizardState');
      const state = stateRaw ? JSON.parse(stateRaw) : { step: 3, profile: 'balanced', key: false, web: false };
      state.web = true;
      state.step = 4;
      await saveSetting('wizardState', JSON.stringify(state));
      const msg = `✅ Web search configured! Mode set to <b>auto</b>.\n\nType <code>/wizard</code> to finish setup.`;
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
    }

    // /wizard skip — advance to next step without completing
    if (sub === 'skip') {
      const stateRaw = await getSetting('wizardState');
      const state = stateRaw ? JSON.parse(stateRaw) : { step: 0, profile: 'balanced', key: false, web: false };
      if (state.step < 4) state.step++;
      await saveSetting('wizardState', JSON.stringify(state));
      const msg = `⏭️ Skipped to step ${state.step + 1}.\n\nType <code>/wizard</code> to see what's next.`;
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
    }

    // /wizard done — mark wizard complete
    if (sub === 'done') {
      await saveSetting('wizardState', JSON.stringify({ step: 4, profile: 'balanced', key: true, web: true, done: true }));
      const msg = '🎉 <b>Setup complete!</b> You\'re ready to use Free Model Fusion.\n\nTry sending a message or use <code>/help</code> to see all commands.';
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
    }

    return { answer: 'Unknown wizard command. Try: <code>/wizard</code>, <code>/wizard status</code>, <code>/wizard start</code>.', telegramHtml: '', meta: getEmptyMeta('') };
  }

  // ── No args: show current step ───────────────────────────
  const stateRaw = await getSetting('wizardState');
  let state: { step: number; profile: string; key: boolean; web: boolean } = { step: 0, profile: 'balanced', key: false, web: false };
  if (stateRaw) {
    try { state = JSON.parse(stateRaw); } catch { /* use defaults */ }
  }
  let step = state.step;
  if (step < 0) step = 0;
  if (step > 4) step = 4;

  switch (step) {
    case 0: {
      const lines = [
        '🚀 <b>Welcome to Free Model Fusion</b>\n',
        'I\'ll help you set up your multi-model AI assistant in a few quick steps.\n',
        '<b>Step 1: Add an API Key</b>',
        'To start, add an API key from a supported provider.',
        '',
        'Supported providers: groq, gemini, openrouter, cerebras, together, fireworks, deepinfra, and more.',
        '',
        'Run: <code>/wizard key &lt;provider&gt; &lt;your_api_key&gt;</code>',
        '',
        'Example: <code>/wizard key groq gsk_your_key_here</code>',
        '',
        'Or skip: <code>/wizard skip</code>',
        'Check progress: <code>/wizard status</code>',
        'Restart: <code>/wizard start</code>',
      ];
      const msg = lines.join('\n');
      // Initialize state
      if (!stateRaw) {
        await saveSetting('wizardState', JSON.stringify({ step: 0, profile: 'balanced', key: false, web: false }));
      }
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
    }

    case 1: {
      const lines = [
        '🔑 <b>Step 1: Add an API Key</b>\n',
        'Add a key from a supported provider:',
        '',
        'Run: <code>/wizard key &lt;provider&gt; &lt;your_api_key&gt;</code>',
        '',
        'Example: <code>/wizard key groq gsk_your_key_here</code>',
        '',
        'Supported providers:',
        '• <b>groq</b> — https://console.groq.com/keys',
        '• <b>gemini</b> — https://aistudio.google.com/app/apikey',
        '• <b>openrouter</b> — https://openrouter.ai/keys',
        '• <b>cerebras</b> — https://console.cerebras.net/api-keys',
        '• <b>together</b> — https://api.together.ai/settings/api-keys',
        '• <b>fireworks</b> — https://fireworks.ai/account/api-keys',
        '',
        'Or skip: <code>/wizard skip</code>',
      ];
      const msg = lines.join('\n');
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
    }

    case 2: {
      const lines = [
        '⚡ <b>Step 2: Choose Your Profile</b>\n',
        'Profiles control how AI models are selected:',
        '',
        '• <b>speed</b> — Fastest responses, lightweight models',
        '• <b>balanced</b> — Good mix of speed and quality (default)',
        '• <b>quality</b> — Deep reasoning with stronger models',
        '',
        'Run: <code>/wizard profile &lt;speed|balanced|quality&gt;</code>',
        '',
        'Example: <code>/wizard profile balanced</code>',
        '',
        'You can change this anytime with <code>/profile</code>.',
      ];
      const msg = lines.join('\n');
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
    }

    case 3: {
      const lines = [
        '🌐 <b>Step 3: Web Search (Optional)</b>\n',
        'Enable real-time web search for current events, news, and fresh data.',
        '',
        'You\'ll need a free Tavily API key:',
        'https://tavily.com',
        '',
        'Run: <code>/wizard web &lt;your_tavily_key&gt;</code>',
        '',
        'Example: <code>/wizard web tvly-your-key-here</code>',
        '',
        'This also sets web mode to <b>auto</b>.',
        'Or skip: <code>/wizard skip</code>',
      ];
      const msg = lines.join('\n');
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
    }

    case 4:
    default: {
      // Show completion + summary
      const keys = await listCredentials();
      const models = await getAllModels();
      const hasModels = models.some(m => m.enabled && m.hasCredential);
      const lines = [
        '🎉 <b>Setup Complete!</b>\n',
        'Your Free Model Fusion instance is ready to use.\n',
        '<b>Summary:</b>',
        `• API Keys: ${keys.length > 0 ? keys.map(k => k.providerId).join(', ') : '(none — add later with /addkey)'}`,
        `• Profile: <b>${state.profile || 'balanced'}</b>`,
        `• Web Search: ${state.web ? '✅ On (auto mode)' : '⬜ Not configured'}`,
        `• Models ready: ${hasModels ? '✅ Yes' : '⬜ Add an API key first'}`,
        '',
        '<b>Next steps:</b>',
        '• Send a message to start chatting!',
        '• Use <code>/help</code> to see all commands',
        '• Use <code>/models</code> to see available models',
        '• Use <code>/web auto</code> to enable automatic web search',
        '• Visit the Dashboard at http://localhost:3000',
        '',
        'Run <code>/wizard done</code> to mark setup as complete.',
      ];
      const msg = lines.join('\n');
      return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
    }
  }
}

// ─── Command: /resetregistry ─────────────────────────────
async function handleResetRegistry(args: string[]): Promise<FusionResult> {
  if (args.length === 0 || args[0].toLowerCase() !== 'confirm') {
    const msg = 'Reset custom providers and models?\nThis deletes all custom entries but preserves built-in presets.\n/resetregistry confirm';
    return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
  }

  const { db } = await import('../db/client.js');
  const { customProviders, customModels } = await import('../db/schema.js');

  await db.delete(customProviders);
  await db.delete(customModels);

  const msg = '🗑️ Custom providers and models have been reset. Built-in presets remain.';
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
}
