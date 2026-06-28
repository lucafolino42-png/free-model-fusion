import { getProviderById, getModelById } from './registry.js';
import { hasCredential, getCredential } from './credentials.js';
import { db } from '../db/client.js';
import { customModels } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

interface OpenAIModelsResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
  }>;
}

export async function discoverModels(providerId: string): Promise<{
  success: boolean;
  modelsDiscovered: number;
  models?: Array<{ key: string; modelId: string }>;
  error?: string;
}> {
  const provider = await getProviderById(providerId);
  if (!provider) {
    return { success: false, modelsDiscovered: 0, error: "Provider '" + providerId + "' not found." };
  }

  const hasKey = await hasCredential(provider.credentialRef);
  if (!hasKey) {
    return { success: false, modelsDiscovered: 0, error: "No API key configured for '" + providerId + "'. Add one first." };
  }

  const chatEndpoint = provider.endpoint;
  let modelsEndpoint: string;

  if (chatEndpoint.indexOf('/chat/completions') > -1) {
    modelsEndpoint = chatEndpoint.replace('/chat/completions', '/models');
  } else {
    const lastSlash = chatEndpoint.lastIndexOf('/');
    modelsEndpoint = lastSlash > 0
      ? chatEndpoint.substring(0, lastSlash) + '/models'
      : chatEndpoint + '/models';
  }

  logger.info('Discovering models for ' + providerId + ' from ' + modelsEndpoint);

  try {
    const credential = await getCredential(provider.credentialRef);
    const apiKey = credential || '';

    const response = await fetch(modelsEndpoint, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(function() { return 'Unknown error'; });
      return {
        success: false,
        modelsDiscovered: 0,
        error: 'Provider returned ' + response.status + ': ' + errorText.slice(0, 200),
      };
    }

    const data = (await response.json()) as OpenAIModelsResponse;

    if (!data.data || !Array.isArray(data.data)) {
      return {
        success: false,
        modelsDiscovered: 0,
        error: 'Unexpected response format from provider models endpoint.',
      };
    }

    const existingModels = await db
      .select({ id: customModels.id })
      .from(customModels)
      .where(eq(customModels.providerId, providerId));

    const existingIds = new Set(existingModels.map(function(m) { return m.id; }));

    const chatModels = data.data.filter(function(m) {
      var id = m.id.toLowerCase();
      if (id.indexOf('embedding') > -1 || id.indexOf('davinci') > -1 || id.indexOf('babbage') > -1
        || id.indexOf('curie') > -1 || id.indexOf('whisper') > -1 || id.indexOf('tts') > -1
        || id.indexOf('dall') > -1 || id.indexOf('moderation') > -1) {
        return false;
      }
      return true;
    });

    var maxToSave = 100;
    var toSave = chatModels.slice(0, maxToSave);
    var now = new Date();
    var saved = 0;
    var savedModels = [];

    for (var i = 0; i < toSave.length; i++) {
      var model = toSave[i];
      var modelKey = providerId + '_' + model.id.replace(/[^a-zA-Z0-9_-]/g, '_');

      if (existingIds.has(modelKey)) continue;

      var existingPreset = await getModelById(modelKey);
      if (existingPreset) continue;

      try {
        await db.insert(customModels).values({
          id: modelKey,
          providerId: providerId,
          title: model.id,
          model: model.id,
          useAs: JSON.stringify(['expert']),
          enabled: true,
          speedClass: 'medium',
          qualityClass: 'good',
          maxOutputTokens: 8192,
          createdAt: now,
          updatedAt: now,
        });
        saved++;
        savedModels.push({ key: modelKey, modelId: model.id });
      } catch (e) {
        logger.debug('Skipping duplicate model ' + modelKey);
      }
    }

    return {
      success: true,
      modelsDiscovered: saved,
      models: savedModels,
    };
  } catch (error) {
    return {
      success: false,
      modelsDiscovered: 0,
      error: 'Discovery failed: ' + String(error),
    };
  }
}
