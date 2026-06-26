import { describe, it, expect } from 'vitest';
import { formatAllExpertsFailed, formatNoExpertsConfigured } from '../src/fusion/commandsHandler.js';

describe('formatAllExpertsFailed', () => {
  it('enumerates each provider/model/reason failure', () => {
    const errors = [
      { provider: 'groq', model: 'llama-3.3-70b-versatile', error: 'Provider Groq Cloud returned 401: Invalid API key' },
      { provider: 'gemini', model: 'gemini-2.5-flash', error: 'Request to Gemini (gemini-2.5-flash) failed: aborted' },
    ];
    const out = formatAllExpertsFailed(errors);
    expect(out).toContain('llama-3.3-70b-versatile');
    expect(out).toContain('Invalid API key');
    expect(out).toContain('gemini-2.5-flash');
    expect(out).toContain('aborted');
    expect(out).toContain('/listkeys');
    expect(out).toContain('/providers');
  });

  it('is actionable even with a single failure', () => {
    const out = formatAllExpertsFailed([
      { provider: 'groq', model: 'llama-3.3-70b-versatile', error: 'timed out' },
    ]);
    expect(out).toContain('groq');
    expect(out).toContain('timed out');
  });
});

describe('formatNoExpertsConfigured', () => {
  it('directs the user to add a key, distinct from the all-failed message', () => {
    const out = formatNoExpertsConfigured();
    expect(out).toContain('/addkey');
    expect(out).not.toContain('None of the available AI models');
  });
});
