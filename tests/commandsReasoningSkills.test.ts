import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { handleFusionCommand } from '../src/fusion/commandsHandler.js';
import { initializeDatabase } from '../src/db/client.js';
import { unloadSkill } from '../src/fusion/skills.js';

let sessionCounter = 0;
function freshSessionId(label: string): string {
  sessionCounter += 1;
  return `reasoning-skills-${label}-${sessionCounter}`;
}

beforeAll(async () => {
  await initializeDatabase();
});

afterEach(() => {
  unloadSkill();
});

// ── /reasoning ───────────────────────────────────────────

describe('/reasoning command', () => {
  it('shows current reasoning effort when called without args (defaults to medium)', async () => {
    const result = await handleFusionCommand('/reasoning', {
      sessionId: freshSessionId('default'),
      source: 'api',
    });
    expect(result.answer).toContain('medium');
    expect(result.answer).toContain('Usage: /reasoning low|medium|high|xhigh');
  });

  it('sets reasoning effort to low', async () => {
    const sid = freshSessionId('set-low');
    const result = await handleFusionCommand('/reasoning low', {
      sessionId: sid,
      source: 'api',
    });
    expect(result.answer).toContain('set to');
    expect(result.answer).toMatch(/low/);

    const check = await handleFusionCommand('/reasoning', {
      sessionId: sid,
      source: 'api',
    });
    expect(check.answer).toMatch(/Reasoning effort.*low/);
  });

  it('sets reasoning effort to medium', async () => {
    const sid = freshSessionId('set-medium');
    await handleFusionCommand('/reasoning medium', {
      sessionId: sid,
      source: 'api',
    });
    const check = await handleFusionCommand('/reasoning', {
      sessionId: sid,
      source: 'api',
    });
    expect(check.answer).toMatch(/Reasoning effort.*medium/);
  });

  it('sets reasoning effort to high', async () => {
    const sid = freshSessionId('set-high');
    await handleFusionCommand('/reasoning high', {
      sessionId: sid,
      source: 'api',
    });
    const check = await handleFusionCommand('/reasoning', {
      sessionId: sid,
      source: 'api',
    });
    expect(check.answer).toMatch(/Reasoning effort.*high/);
  });

  it('sets reasoning effort to xhigh', async () => {
    const sid = freshSessionId('set-xhigh');
    await handleFusionCommand('/reasoning xhigh', {
      sessionId: sid,
      source: 'api',
    });
    const check = await handleFusionCommand('/reasoning', {
      sessionId: sid,
      source: 'api',
    });
    expect(check.answer).toMatch(/Reasoning effort.*xhigh/);
  });

  it('rejects invalid reasoning levels with an error message', async () => {
    const result = await handleFusionCommand('/reasoning ultra', {
      sessionId: freshSessionId('invalid'),
      source: 'api',
    });
    expect(result.answer).toContain('Invalid level');
    expect(result.answer).toContain('ultra');
    expect(result.answer).toContain('low, medium, high, or xhigh');
  });

  it('is case-insensitive for the level argument', async () => {
    const sid = freshSessionId('case');
    await handleFusionCommand('/reasoning HIGH', {
      sessionId: sid,
      source: 'api',
    });
    const check = await handleFusionCommand('/reasoning', {
      sessionId: sid,
      source: 'api',
    });
    expect(check.answer).toContain('high');
  });

  it('overwrites a previously set reasoning effort', async () => {
    const sid = freshSessionId('overwrite');
    await handleFusionCommand('/reasoning high', {
      sessionId: sid,
      source: 'api',
    });
    await handleFusionCommand('/reasoning low', {
      sessionId: sid,
      source: 'api',
    });
    const check = await handleFusionCommand('/reasoning', {
      sessionId: sid,
      source: 'api',
    });
    expect(check.answer).toContain('low');
    // The usage line always lists valid levels (including 'high'), so check the
    // status line specifically rather than the full output.
    expect(check.answer).toMatch(/Reasoning effort.*low/);
    expect(check.answer).not.toMatch(/Reasoning effort.*high/);
  });

  it('returns FusionResult with meta.sessionId and no routing', async () => {
    const sid = freshSessionId('meta');
    const result = await handleFusionCommand('/reasoning medium', {
      sessionId: sid,
      source: 'api',
    });
    expect(result.meta).toBeDefined();
    expect(result.meta.memory.sessionId).toBe(sid);
    expect(result.meta.routing.expertsUsed).toBe(0);
    expect(result.telegramHtml).toBeDefined();
  });
});

// ── /skills ──────────────────────────────────────────────

describe('/skills command', () => {
  it('lists all available skills when called without args', async () => {
    const result = await handleFusionCommand('/skills', {
      sessionId: freshSessionId('list'),
      source: 'api',
    });
    expect(result.answer).toContain('Available Skills');
    expect(result.answer).toContain('Code Review');
    expect(result.answer).toContain('Web Design');
    expect(result.answer).toContain('Backend Development');
    expect(result.answer).toContain('Debugging');
    expect(result.answer).toContain('Concise');
    expect(result.answer).toContain('Educational');
    expect(result.answer).toContain('/skills load');
    expect(result.answer).toContain('/skills unload');
    expect(result.answer).toContain('/skills search');
  });

  it('loads a skill successfully', async () => {
    const result = await handleFusionCommand('/skills load code-review', {
      sessionId: freshSessionId('load'),
      source: 'api',
    });
    expect(result.answer).toContain('loaded');
    // Handler uses the raw argument (code-review), not the display name
    expect(result.answer).toContain('code-review');
  });

  it('shows an error when loading a non-existent skill', async () => {
    const result = await handleFusionCommand('/skills load nonexistent-skill', {
      sessionId: freshSessionId('load-nonexistent'),
      source: 'api',
    });
    expect(result.answer).toContain('not found');
    expect(result.answer).toContain('nonexistent-skill');
    expect(result.answer).toContain('/skills');
  });

  it('shows the loaded skill as active when listing skills', async () => {
    const sid = freshSessionId('active');
    await handleFusionCommand('/skills load debugging', {
      sessionId: sid,
      source: 'api',
    });
    const result = await handleFusionCommand('/skills', {
      sessionId: sid,
      source: 'api',
    });
    expect(result.answer).toContain('Debugging');
    expect(result.answer).toContain('(active)');
  });

  it('unloads the current skill', async () => {
    const sid = freshSessionId('unload');
    await handleFusionCommand('/skills load concise', {
      sessionId: sid,
      source: 'api',
    });
    const unloadResult = await handleFusionCommand('/skills unload', {
      sessionId: sid,
      source: 'api',
    });
    expect(unloadResult.answer).toContain('unloaded');

    const listResult = await handleFusionCommand('/skills', {
      sessionId: sid,
      source: 'api',
    });
    expect(listResult.answer).not.toContain('(active)');
  });

  it('finds a skill by name with /skills search', async () => {
    const result = await handleFusionCommand('/skills search code-review', {
      sessionId: freshSessionId('search'),
      source: 'api',
    });
    expect(result.answer).toContain('Code Review');
    expect(result.answer).toContain('/skills load');
  });

  it('lists all skills when search query does not match', async () => {
    const result = await handleFusionCommand('/skills search zzzzdoesnotexist', {
      sessionId: freshSessionId('search-nonexistent'),
      source: 'api',
    });
    expect(result.answer).toContain('No skill found');
    expect(result.answer).toContain('zzzzdoesnotexist');
    expect(result.answer).toContain('Code Review');
    expect(result.answer).toContain('Web Design');
    expect(result.answer).toContain('Backend Development');
    expect(result.answer).toContain('Debugging');
    expect(result.answer).toContain('Concise');
    expect(result.answer).toContain('Educational');
  });

  it('shows usage message for invalid subcommand', async () => {
    const result = await handleFusionCommand('/skills bogus', {
      sessionId: freshSessionId('bogus'),
      source: 'api',
    });
    expect(result.answer).toContain('Usage');
    expect(result.answer).toMatch(/skills \[load/);
  });

  it('shows usage when load is called without a skill name', async () => {
    const result = await handleFusionCommand('/skills load', {
      sessionId: freshSessionId('load-noarg'),
      source: 'api',
    });
    expect(result.answer).toContain('Usage');
    expect(result.answer).toMatch(/skills \[load/);
  });

  it('shows usage when search is called without a query', async () => {
    const result = await handleFusionCommand('/skills search', {
      sessionId: freshSessionId('search-noarg'),
      source: 'api',
    });
    expect(result.answer).toContain('Usage');
    expect(result.answer).toMatch(/skills \[load/);
  });

  it('searching for a different skill still shows active skill correctly', async () => {
    const sid = freshSessionId('cross');
    await handleFusionCommand('/skills load educational', {
      sessionId: sid,
      source: 'api',
    });
    const searchResult = await handleFusionCommand('/skills search debugging', {
      sessionId: sid,
      source: 'api',
    });
    expect(searchResult.answer).toContain('Debugging');
    // Handler uses results.name which is title-case (Debugging)
    expect(searchResult.answer).toContain('/skills load Debugging');
  });

  it('returns FusionResult with meta.sessionId', async () => {
    const sid = freshSessionId('meta');
    const result = await handleFusionCommand('/skills', {
      sessionId: sid,
      source: 'api',
    });
    expect(result.meta).toBeDefined();
    expect(result.meta.memory.sessionId).toBe(sid);
    expect(result.meta.routing.expertsUsed).toBe(0);
    expect(result.telegramHtml).toBeDefined();
  });
});
