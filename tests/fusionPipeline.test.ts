import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { handleFusionCommand } from '../src/fusion/commandsHandler.js';
import { initializeDatabase } from '../src/db/client.js';

beforeAll(async () => {
  await initializeDatabase();
});

// ── Mocked fetch harness ─────────────────────────────────
// Returns canned OpenAI-format responses keyed by the request body's `model`.
// Tests build a responses map: { 'llama-3.3-70b-versatile': 'EXPERT_A', ... }
// A model mapped to null makes its call reject (simulating provider failure).
type ResponsesMap = Record<string, string | null>;

function installFetchMock(responses: ResponsesMap, opts: { finishReason?: string } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : { model: '' };
    const content = responses[body.model];
    if (content === null) {
      throw new Error(`network error for ${body.model}`);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: body.model,
        choices: [
          { message: { role: 'assistant', content }, finish_reason: opts.finishReason ?? 'stop' },
        ],
      }),
      text: async () => '',
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  // Default: every model returns a placeholder; tests override.
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Models that the balanced profile will select given the test GROQ env key
// (set in tests/setup.ts). groq has 4 expert/judge/synthesis presets.
const GROQ_EXPERT = 'llama-3.1-8b-instant';
const GROQ_JUDGE_OR_SYNTH = 'llama-3.3-70b-versatile';

describe('fusion pipeline (mocked fetch)', () => {
  it('happy path: synthesis content becomes the answer', async () => {
    installFetchMock({
      [GROQ_EXPERT]: 'expert says 4',
      [GROQ_JUDGE_OR_SYNTH]: 'The answer is 4.',
      // Other groq presets used as experts/judge/synthesis return generic text.
      'openai/gpt-oss-120b': 'expert: 4',
      'meta-llama/llama-4-scout-17b-16e-instruct': 'expert: 4',
      'gemini-2.5-flash': 'expert: 4',
      'gemini-2.5-pro': 'synthesis: 4',
      'gpt-oss-120b': '4',
    });
    const result = await handleFusionCommand('What is 2+2?', {
      sessionId: 'pipe-happy',
      source: 'api',
    });
    expect(result.meta.routing.expertsUsed).toBeGreaterThan(0);
    expect(result.answer.length).toBeGreaterThan(0);
  });

  it('synthesis returns empty content -> falls back to first expert response', async () => {
    const fetchMock = installFetchMock({
      [GROQ_EXPERT]: 'FIRST EXPERT ANSWER',
      [GROQ_JUDGE_OR_SYNTH]: '', // synthesis returns EMPTY content
      'openai/gpt-oss-120b': 'second expert',
      'meta-llama/llama-4-scout-17b-16e-instruct': 'third expert',
      'gpt-oss-120b': '',
    });
    const result = await handleFusionCommand('Say hello', {
      sessionId: 'pipe-empty-synth',
      source: 'api',
    });
    // The answer must be non-empty — fallback to a successful expert response.
    expect(result.answer.length).toBeGreaterThan(0);
    // And it should come from one of the expert responses, not be blank.
    expect(result.answer).toMatch(/EXPERT|expert/i);
    // fetch was actually called (sanity that the mock engaged).
    expect(fetchMock).toHaveBeenCalled();
  });

  it('all experts fail -> actionable all-models-failed message', async () => {
    // Make every model the profile might select reject.
    installFetchMock({
      [GROQ_EXPERT]: null,
      [GROQ_JUDGE_OR_SYNTH]: null,
      'openai/gpt-oss-120b': null,
      'meta-llama/llama-4-scout-17b-16e-instruct': null,
      'gpt-oss-120b': null,
    });
    const result = await handleFusionCommand('Anything', {
      sessionId: 'pipe-all-fail',
      source: 'api',
    });
    expect(result.meta.routing.expertsUsed).toBe(0);
    expect(result.answer).toContain('None of the available AI models');
  });

  it('truncated synthesis (finish_reason length) -> continuation appended', async () => {
    // Balanced profile selects experts[0] (llama-3.1-8b-instant) as synthesis
    // when no synthesis-eligible model is chosen. The first call to that model
    // is the expert call; the synthesis reuses it too. We truncate whichever
    // call returns the synthesis content by counting calls to that model and
    // truncating the LAST one (synthesis runs after experts).
    const synthModel = GROQ_EXPERT; // experts[0] doubles as synthesis
    let callsToSynthModel = 0;
    let totalCalls = 0;
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : { model: '' };
      totalCalls += 1;
      let content = 'expert content';
      let finishReason = 'stop';
      if (body.model === synthModel) {
        callsToSynthModel += 1;
        // The 2nd call to the synth model is the synthesis call (1st was expert).
        if (callsToSynthModel === 2) {
          content = 'PART 1';
          finishReason = 'length';
        } else if (callsToSynthModel === 3) {
          // continuation call -> appended
          content = 'PART 2';
          finishReason = 'stop';
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: body.model,
          choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }],
        }),
        text: async () => '',
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleFusionCommand('Write a long essay', {
      sessionId: 'pipe-trunc',
      source: 'api',
    });
    expect(result.meta.routing.truncated).toBe(true);
    expect(result.meta.routing.continued).toBe(true);
    expect(result.answer).toContain('PART 1');
    expect(result.answer).toContain('PART 2');
  });

  it('continuation returns empty content -> no stray newline appended', async () => {
    // Synthesis truncated, but the continuation call returns empty content.
    const synthModel = GROQ_EXPERT;
    let callsToSynthModel = 0;
    installFetchMock({}); // placeholder, overridden below
    vi.unstubAllGlobals();
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : { model: '' };
      let content = 'expert content';
      let finishReason = 'stop';
      if (body.model === synthModel) {
        callsToSynthModel += 1;
        if (callsToSynthModel === 2) {
          content = 'MAIN';
          finishReason = 'length';
        } else if (callsToSynthModel === 3) {
          // continuation returns empty -> must not append '\n\n'
          content = '   ';
          finishReason = 'stop';
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: body.model,
          choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }],
        }),
        text: async () => '',
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleFusionCommand('Write something', {
      sessionId: 'pipe-empty-continuation',
      source: 'api',
    });
    // Answer is exactly the synthesis content, with no trailing blank line
    // from an empty continuation (no '\n\n' appended for whitespace content).
    expect(result.answer).toBe('MAIN');
  });

  it('empty judge evaluation -> synthesis still succeeds with expert content', async () => {
    // Judge returns empty evaluation; synthesis must still produce an answer
    // (the handler falls back to 'Using expert responses directly.' for the
    // judge evaluation input to synthesis).
    const synthModel = GROQ_EXPERT;
    let callsToSynthModel = 0;
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : { model: '' };
      let content = 'expert answer';
      let finishReason = 'stop';
      if (body.model === GROQ_JUDGE_OR_SYNTH) {
        // judge returns EMPTY evaluation
        content = '';
      }
      if (body.model === synthModel) {
        callsToSynthModel += 1;
        if (callsToSynthModel === 2) {
          // synthesis call -> real content
          content = 'SYNTHESIZED ANSWER';
          finishReason = 'stop';
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: body.model,
          choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }],
        }),
        text: async () => '',
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleFusionCommand('Explain recursion', {
      sessionId: 'pipe-empty-judge',
      source: 'api',
    });
    expect(result.meta.routing.judgeUsed).toBe(true);
    expect(result.answer).toBe('SYNTHESIZED ANSWER');
  });
});
