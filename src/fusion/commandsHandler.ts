import { parseCommand, type ParsedCommand } from './commands.js';
import { normalizeInput } from './normalizeInput.js';
import { getOrCreateSession, getSessionMessages, saveMessage, clearSessionMemory, updateSessionSettings } from './memory.js';
import { searchWeb, shouldAutoSearch, formatSearchResults } from './webSearch.js';
import { selectExperts } from './routing.js';
import { runExpertPanel } from './expertPanel.js';
import { runJudge } from './judge.js';
import { runSynthesis } from './synthesis.js';
import { continueResponse, isTruncated } from './continuation.js';
import { getAllProviders, getAllModels, getProviderById, getModelById, findProviderByAlias } from '../providers/registry.js';
import { saveCredential, deleteCredential, listCredentials } from '../providers/credentials.js';
import { addCustomProvider, deleteCustomProvider, setProviderEnabled } from '../providers/registry.js';
import { config } from '../config.js';
import { convertToTelegramHtml } from '../format/telegramHtml.js';
import { saveSetting, getSetting } from '../db/settings.js';
import { logger } from '../utils/logger.js';
import { validateProviderUrl, sanitizeErrorMessage } from '../utils/validateUrl.js';
import { FusionError } from '../utils/errors.js';
import type { FusionResult, RoutingProfile } from '../providers/types.js';
import type { RegisteredModel } from '../providers/types.js';

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
      return handleChatMessage(normalized.sessionId, parsed.text, normalized.source, parsed.profileOverride);

    // Profile commands
    case 'help':
      return handleHelp();
    case 'profile':
      return handleProfile(normalized.sessionId, parsed.args);
    case 'speed':
    case 'balanced':
    case 'quality':
    case 'custom':
      if (parsed.text) {
        return handleChatMessage(normalized.sessionId, parsed.text, normalized.source, parsed.type as RoutingProfile);
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
  profileOverride?: RoutingProfile
): Promise<FusionResult> {
  const session = await getOrCreateSession(sessionId, source);
  const profile = profileOverride || session.profile as RoutingProfile || 'balanced';
  const webMode = session.webMode as 'on' | 'off' | 'auto';

  // Save user message
  await saveMessage(sessionId, 'user', message);

  // Load history
  const history = await getSessionMessages(sessionId);

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

  // Select models
  const routing = await selectExperts(
    profile,
    {
      preferredExperts: session.preferredExperts,
      preferredJudge: session.preferredJudge,
      preferredSynthesis: session.preferredSynthesis,
    }
  );

  // Run expert panel
  const expertResult = await runExpertPanel(routing.experts, message);

  const responseErrors: Array<{ provider: string; model: string; error: string }> =
    expertResult.errors.map((e) => ({
      provider: e.provider,
      model: e.model,
      error: e.error,
    }));

  // If all experts fail
  if (expertResult.responses.length === 0) {
    const errorAnswer = 'All AI models failed to respond. This could be due to:\n' +
      '- Missing or invalid API keys\n' +
      '- Provider rate limits or downtime\n' +
      '- Network issues\n\n' +
      'Check your credentials with /listkeys and ensure providers are enabled with /providers.';

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
  let judgeResult = { evaluation: '', modelUsed: '', success: false };
  let judgeUsed = false;
  if (routing.judge) {
    judgeResult = await runJudge(routing.judge, message, expertResult.responses, webContext);
    judgeUsed = true;
  }

  // Run synthesis
  let synthesisResult = await runSynthesis(
    routing.synthesis || routing.experts[0],
    message,
    expertResult.responses,
    judgeResult.evaluation || 'Using expert responses directly.',
    webContext
  );

  if (!synthesisResult.success && routing.synthesis) {
    // Fallback: use first expert response
    synthesisResult = {
      content: expertResult.responses[0].content,
      modelUsed: routing.synthesis.id,
      success: true,
    };
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
      synthesisResult.finishReason
    );
    finalContent = continuationResult.fullContent;
    continued = continuationResult.continued;
  }

  // Format response
  const telegramHtml = convertToTelegramHtml(finalContent);

  const totalExperts = routing.experts.length;
  const totalCalls = (judgeUsed ? 1 : 0) + 1 + (continued ? 1 : 0);

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

// ─── Command: /help ──────────────────────────────────────
async function handleHelp(): Promise<FusionResult> {
  const help = `🤖 <b>Free Model Fusion</b>

Turn your free AI API keys into a smarter multi-model assistant.

<b>Commands:</b>

<b>Profiles:</b>
/profile [speed|balanced|quality|custom]
/speed [question] - Speed mode (quick answers)
/balanced [question] - Balanced mode (default)
/quality [question] - Quality mode (deeper reasoning)
/custom - Custom expert selection

<b>Models & Providers:</b>
/models - List all available models
/providers - List all providers
/addkey &lt;provider&gt; &lt;apikey&gt;
/deletekey &lt;provider&gt;
/listkeys
/addprovider {"name":"provider","endpoint":"https://..."}
/deleteprovider &lt;provider&gt;
/enableprovider &lt;provider&gt;
/disableprovider &lt;provider&gt;
/addmodel {"provider":"p","key":"k","model":"id","useAs":["expert"]}
/deletemodel &lt;modelKey&gt;
/usemodel &lt;modelKey&gt;
/unusemodel &lt;modelKey&gt;

<b>Web Search:</b>
/addsearchkey tavily &lt;apikey&gt;
/web [on|off|auto]
/search &lt;query&gt;

<b>Memory:</b>
/memory - Show recent conversation
/clearmemory confirm - Clear session memory

<b>Tokens:</b>
/tokens - Show current token settings
/settokens &lt;expert&gt; &lt;judge&gt; &lt;synthesis&gt;
/resettokens confirm

<b>Examples:</b>
/addkey groq gsk_abc...
/quality Explain quantum computing
/speed What is 2+2?
/web auto
/search latest AI news 2026`;
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
  const msg = `Profile changed to <b>${profile}</b>.`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta(sessionId) };
}

// ─── Command: /speed|/balanced|/quality|/custom (persistent set) ──
async function handleSetProfile(sessionId: string, profile: RoutingProfile): Promise<FusionResult> {
  await updateSessionSettings(sessionId, { profile });
  const msg = `Profile changed to <b>${profile}</b>.`;
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
  const msg = `Web search mode changed to <b>${mode}</b>.${mode === 'auto' ? ' Will search automatically for current/research queries.' : ''}${mode === 'on' ? ' Will search the web for every query.' : ''}`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
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
    expertMaxTokens: parseInt(process.env.FUSION_EXPERT_MAX_TOKENS || '2500', 10),
    judgeMaxTokens: parseInt(process.env.FUSION_JUDGE_MAX_TOKENS || '1800', 10),
    synthesisMaxTokens: parseInt(process.env.FUSION_SYNTHESIS_MAX_TOKENS || '5000', 10),
  };

  (config as Record<string, unknown>).expertMaxTokens = resetConfig.expertMaxTokens;
  (config as Record<string, unknown>).judgeMaxTokens = resetConfig.judgeMaxTokens;
  (config as Record<string, unknown>).synthesisMaxTokens = resetConfig.synthesisMaxTokens;

  const msg = `✅ Token settings reset to defaults:\nExpert: <code>${resetConfig.expertMaxTokens}</code>\nJudge: <code>${resetConfig.judgeMaxTokens}</code>\nSynthesis: <code>${resetConfig.synthesisMaxTokens}</code>`;
  return { answer: msg, telegramHtml: msg, meta: getEmptyMeta('') };
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
