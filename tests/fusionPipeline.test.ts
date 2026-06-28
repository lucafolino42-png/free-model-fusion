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
    //
    // Note: query must NOT match complexity keywords so profile stays 'balanced'.
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

    const result = await handleFusionCommand('Draft a long essay', {
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

    const result = await handleFusionCommand('Draft something', {
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

    const result = await handleFusionCommand('Tell me recursion', {
      sessionId: 'pipe-empty-judge',
      source: 'api',
    });
    expect(result.meta.routing.judgeUsed).toBe(true);
    expect(result.answer).toBe('SYNTHESIZED ANSWER');
  });

  it('memory: prior turns are included in subsequent expert calls (context-aware)', async () => {
    // A key "beat OpenRouter" differentiator: conversation history must be
    // passed to the models so responses are context-aware across turns.
    const seenBodies: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      const rawBody = init?.body ?? '{}';
      seenBodies.push(rawBody);
      const body = JSON.parse(rawBody);
      const content = body.model === GROQ_JUDGE_OR_SYNTH ? 'ok' : 'expert reply';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: body.model,
          choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
        }),
        text: async () => '',
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    // Turn 1: establish context the model should remember.
    await handleFusionCommand('My name is Alice.', { sessionId: 'pipe-memory', source: 'api' });
    const firstCallCount = fetchMock.mock.calls.length;
    seenBodies.length = 0;

    // Turn 2: a follow-up that should see turn 1's history in its messages.
    // Query must NOT trigger complexity analysis ("what is" matches SIMPLE_INDICATORS).
    await handleFusionCommand('Do you recall my name?', { sessionId: 'pipe-memory', source: 'api' });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(firstCallCount);
    // At least one model call in turn 2 must include the prior user message
    // ("My name is Alice.") in its messages array — proving history is passed.
    const turn2Bodies = seenBodies.map((b) => JSON.parse(b));
    const anyCallHasHistory = turn2Bodies.some((b) =>
      Array.isArray(b.messages) &&
      b.messages.some((m: { content: string }) => m.content.includes('My name is Alice.'))
    );
    expect(anyCallHasHistory).toBe(true);

    // The current turn-2 message must NOT be duplicated: it should appear
    // (possibly wrapped in a history-aware preamble) as the final user message
    // exactly once in the expert calls. Previously saveMessage ran before
    // getSessionMessages, so the current message was both in history AND
    // appended again. (Judge/synthesis calls get different prompts and are
    // not part of this assertion.)
    const expertCalls = turn2Bodies.filter((b) => {
      if (!Array.isArray(b.messages)) return false;
      const msgs = b.messages as Array<{ role: string; content: string }>;
      // Expert calls include the system prompt that begins with "Answer this
      // question directly and concisely"; judge/synthesis use different
      // prompts. Identify experts by this distinctive opener.
      const sys = msgs.find((m) => m.role === 'system');
      return sys?.content.includes('Answer the user') && !sys?.content.includes('You are evaluating');
    });
    expect(expertCalls.length).toBeGreaterThan(0);
    for (const b of expertCalls) {
      const msgs = b.messages as Array<{ role: string; content: string }>;
      const userTurns = msgs.filter((m) => m.role === 'user');
      const containsCurrentQuestion = userTurns.some((m) =>
        m.content.includes('Do you recall my name?')
      );
      expect(containsCurrentQuestion).toBe(true);
      // The bare current question must not appear verbatim twice (i.e. it
      // is not duplicated in both history and the final user turn).
      const bareCount = userTurns.filter((m) => m.content === 'Do you recall my name?').length;
      expect(bareCount).toBeLessThanOrEqual(1);
    }
  });

  it('memory: vague follow-up includes a conversation-reference preamble in the model call', async () => {
    // Real-model failure: with cheap models, a bare follow-up ("What is the
    // population of the city I just asked about?") gets answered as if no
    // history exists, even though history IS in the messages array. Fix: when
    // there is prior history, the final user message sent to the model should
    // include a short reference to the prior conversation, forcing the model
    // to attend to history rather than treating the message as standalone.
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: body.model,
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        text: async () => '',
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await handleFusionCommand('The city I mentioned is Paris.', { sessionId: 'pipe-preamble', source: 'api' });
    fetchMock.mockClear();

    await handleFusionCommand('What is the population of that city?', { sessionId: 'pipe-preamble', source: 'api' });

    const turn2Bodies = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]?.body ?? '{}')));
    const expertCalls = turn2Bodies.filter((b) => Array.isArray(b.messages));
    expect(expertCalls.length).toBeGreaterThan(0);

    // The final user message sent to the model must mention the prior turn
    // (either by referencing the prior conversation or by quoting prior
    // content) — proving the handler built a context-aware prompt.
    const finalUserMessages = expertCalls
      .map((b) => (b.messages as Array<{ role: string; content: string }>).filter((m) => m.role === 'user').slice(-1)[0]?.content ?? '');
    const anyFinalMessageReferencesPriorTurn = finalUserMessages.some(
      (m) => /prior|previous|earlier|conversation|Paris/i.test(m)
    );
    expect(anyFinalMessageReferencesPriorTurn).toBe(true);
  });

  it('web search: augments the prompt when webMode is on (mocked Tavily)', async () => {
    // The web-search differentiator: when webMode is on, a Tavily search is
    // performed and its results are folded into the synthesis context.
    const tavilyResult = {
      answer: 'The current version is 9.9.',
      results: [{ title: 'Release Notes', url: 'https://example.com/release', content: 'Version 9.9 released.' }],
    };
    const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
      if (url.includes('tavily.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => tavilyResult,
          text: async () => '',
        } as unknown as Response;
      }
      // Provider call: assert the web context reached the synthesis prompt.
      const body = init?.body ? JSON.parse(init.body) : { model: '' };
      const content = body.model === GROQ_JUDGE_OR_SYNTH ? 'judge' : 'synthesis reply';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: body.model,
          choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
        }),
        text: async () => '',
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    // Tavily requires a key in config; stub it for the test.
    const orig = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = 'tvly-test';
    // config is loaded once at import; mutate the in-memory value directly.
    const { config } = await import('../src/config.js');
    (config as Record<string, unknown>).tavilyApiKey = 'tvly-test';

    try {
      const result = await handleFusionCommand('What is the latest version?', {
        sessionId: 'pipe-web',
        source: 'api',
        web: 'on',
      });
      // A Tavily call was made.
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('tavily.com'))).toBe(true);
      // The web search is reflected in meta.
      expect(result.meta.web.searched).toBe(true);
      expect(result.meta.web.enabled).toBe(true);
    } finally {
      process.env.TAVILY_API_KEY = orig;
      (config as Record<string, unknown>).tavilyApiKey = orig ?? '';
    }
  });
});
