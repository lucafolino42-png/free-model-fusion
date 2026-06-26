import { describe, it, expect, beforeAll } from 'vitest';
import { initializeDatabase } from '../src/db/client.js';
import {
  getOrCreateSession,
  getSessionMessages,
  saveMessage,
  clearSessionMemory,
  updateSessionSettings,
} from '../src/fusion/memory.js';

beforeAll(async () => {
  await initializeDatabase();
});

describe('getOrCreateSession', () => {
  it('creates a new session with defaults and reports isNew', async () => {
    const s = await getOrCreateSession('sess-new', 'api');
    expect(s.isNew).toBe(true);
    expect(s.id).toBe('sess-new');
    expect(s.profile).toBe('balanced');
    expect(s.webMode).toBe('off');
    expect(s.preferredExperts).toEqual([]);
  });

  it('reloads an existing session with isNew=false', async () => {
    await getOrCreateSession('sess-reload', 'api');
    const again = await getOrCreateSession('sess-reload', 'api');
    expect(again.isNew).toBe(false);
  });
});

describe('saveMessage + getSessionMessages', () => {
  it('saves messages and returns them in chronological order', async () => {
    const sid = 'sess-msgs';
    await getOrCreateSession(sid, 'api');
    await saveMessage(sid, 'user', 'first', undefined);
    await saveMessage(sid, 'assistant', 'second', undefined);
    const msgs = await getSessionMessages(sid, 10, 10000);
    expect(msgs.map((m) => m.content)).toEqual(['first', 'second']);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('respects the maxChars budget by trimming oldest messages', async () => {
    const sid = 'sess-trim';
    await getOrCreateSession(sid, 'api');
    await saveMessage(sid, 'user', 'AAAA', undefined);
    await saveMessage(sid, 'assistant', 'BBBB', undefined);
    await saveMessage(sid, 'user', 'CCCC', undefined);
    // Budget of 10 chars: oldest ('AAAA') should be dropped to keep recent.
    const msgs = await getSessionMessages(sid, 10, 10);
    expect(msgs.map((m) => m.content)).toEqual(['BBBB', 'CCCC']);
  });

  it('respects the limit count', async () => {
    const sid = 'sess-limit';
    await getOrCreateSession(sid, 'api');
    for (let i = 0; i < 5; i++) {
      await saveMessage(sid, 'user', `m${i}`, undefined);
    }
    const msgs = await getSessionMessages(sid, 2, 100000);
    expect(msgs.length).toBeLessThanOrEqual(2);
  });
});

describe('clearSessionMemory', () => {
  it('removes all messages for a session', async () => {
    const sid = 'sess-clear';
    await getOrCreateSession(sid, 'api');
    await saveMessage(sid, 'user', 'to-be-cleared', undefined);
    await clearSessionMemory(sid);
    const msgs = await getSessionMessages(sid, 10, 10000);
    expect(msgs).toEqual([]);
  });
});

describe('updateSessionSettings', () => {
  it('persists profile and webMode', async () => {
    const sid = 'sess-settings';
    await getOrCreateSession(sid, 'api');
    await updateSessionSettings(sid, { profile: 'quality', webMode: 'auto' });
    const reloaded = await getOrCreateSession(sid, 'api');
    expect(reloaded.profile).toBe('quality');
    expect(reloaded.webMode).toBe('auto');
  });
});
