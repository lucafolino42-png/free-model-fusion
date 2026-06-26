import { describe, it, expect } from 'vitest';
import { parseCommand } from '../src/fusion/commands.js';

describe('parseCommand', () => {
  it('parses plain messages', () => {
    const result = parseCommand('Hello, how are you?');
    expect(result.type).toBe('message');
    expect(result.text).toBe('Hello, how are you?');
  });

  it('parses /help', () => {
    const result = parseCommand('/help');
    expect(result.type).toBe('help');
  });

  it('parses /profile without args', () => {
    const result = parseCommand('/profile');
    expect(result.type).toBe('profile');
  });

  it('parses /profile speed', () => {
    const result = parseCommand('/profile speed');
    expect(result.type).toBe('profile');
    expect(result.args[0]).toBe('speed');
  });

  it('parses /speed without question (persistent set)', () => {
    const result = parseCommand('/speed');
    expect(result.type).toBe('speed');
    expect(result.profileOverride).toBeUndefined();
  });

  it('parses /speed with question (one-time override)', () => {
    const result = parseCommand('/speed What is 2+2?');
    expect(result.type).toBe('speed');
    expect(result.text).toBe('What is 2+2?');
    expect(result.profileOverride).toBe('speed');
  });

  it('parses /balanced with question', () => {
    const result = parseCommand('/balanced Explain quantum computing');
    expect(result.type).toBe('balanced');
    expect(result.profileOverride).toBe('balanced');
    expect(result.text).toBe('Explain quantum computing');
  });

  it('parses /quality with question', () => {
    const result = parseCommand('/quality Deep analysis');
    expect(result.type).toBe('quality');
    expect(result.profileOverride).toBe('quality');
  });

  it('parses /custom', () => {
    const result = parseCommand('/custom');
    expect(result.type).toBe('custom');
  });

  it('parses /ask speed', () => {
    const result = parseCommand('/ask speed Hello');
    expect(result.type).toBe('speed');
    expect(result.profileOverride).toBe('speed');
    expect(result.text).toBe('Hello');
  });

  it('parses /models', () => {
    const result = parseCommand('/models');
    expect(result.type).toBe('models');
  });

  it('parses /providers', () => {
    const result = parseCommand('/providers');
    expect(result.type).toBe('providers');
  });

  it('parses /addkey', () => {
    const result = parseCommand('/addkey groq gsk_abc123');
    expect(result.type).toBe('addkey');
    expect(result.args[0]).toBe('groq');
    expect(result.args[1]).toBe('gsk_abc123');
  });

  it('parses /deletekey', () => {
    const result = parseCommand('/deletekey groq');
    expect(result.type).toBe('deletekey');
    expect(result.args[0]).toBe('groq');
  });

  it('parses /listkeys', () => {
    const result = parseCommand('/listkeys');
    expect(result.type).toBe('listkeys');
  });

  it('parses /addprovider with JSON', () => {
    const json = '{"id":"test","endpoint":"https://test.com"}';
    const result = parseCommand(`/addprovider ${json}`);
    expect(result.type).toBe('addprovider');
    expect(result.text).toBe(json);
  });

  it('parses /addmodel with JSON', () => {
    const json = '{"provider":"test","key":"m1","model":"test-model"}';
    const result = parseCommand(`/addmodel ${json}`);
    expect(result.type).toBe('addmodel');
  });

  it('parses /deletemodel', () => {
    const result = parseCommand('/deletemodel my_model');
    expect(result.type).toBe('deletemodel');
    expect(result.args[0]).toBe('my_model');
  });

  it('parses /usemodel', () => {
    const result = parseCommand('/usemodel gemini_flash');
    expect(result.type).toBe('usemodel');
    expect(result.args[0]).toBe('gemini_flash');
  });

  it('parses /unusemodel', () => {
    const result = parseCommand('/unusemodel gemini_flash');
    expect(result.type).toBe('unusemodel');
  });

  it('parses /setjudge', () => {
    const result = parseCommand('/setjudge gemini_flash');
    expect(result.type).toBe('setjudge');
    expect(result.args[0]).toBe('gemini_flash');
  });

  it('parses /setsynthesis', () => {
    const result = parseCommand('/setsynthesis gemini_pro');
    expect(result.type).toBe('setsynthesis');
  });

  it('parses /addsearchkey', () => {
    const result = parseCommand('/addsearchkey tavily tvly-abc123');
    expect(result.type).toBe('addsearchkey');
    expect(result.args[0]).toBe('tavily');
    expect(result.args[1]).toBe('tvly-abc123');
  });

  it('parses /web', () => {
    const result = parseCommand('/web on');
    expect(result.type).toBe('web');
    expect(result.args[0]).toBe('on');
  });

  it('parses /web auto', () => {
    const result = parseCommand('/web auto');
    expect(result.type).toBe('web');
    expect(result.args[0]).toBe('auto');
  });

  it('parses /search', () => {
    const result = parseCommand('/search latest AI news');
    expect(result.type).toBe('search');
    expect(result.text).toBe('latest AI news');
  });

  it('parses /memory', () => {
    const result = parseCommand('/memory');
    expect(result.type).toBe('memory');
  });

  it('parses /clearmemory', () => {
    const result = parseCommand('/clearmemory confirm');
    expect(result.type).toBe('clearmemory');
    expect(result.args[0]).toBe('confirm');
  });

  it('parses /tokens', () => {
    const result = parseCommand('/tokens');
    expect(result.type).toBe('tokens');
  });

  it('parses /settokens', () => {
    const result = parseCommand('/settokens 2000 1500 4000');
    expect(result.type).toBe('settokens');
    expect(result.args[0]).toBe('2000');
    expect(result.args[1]).toBe('1500');
    expect(result.args[2]).toBe('4000');
  });

  it('parses /resettokens', () => {
    const result = parseCommand('/resettokens confirm');
    expect(result.type).toBe('resettokens');
  });

  it('parses unknown command', () => {
    const result = parseCommand('/unknowncommand');
    expect(result.type).toBe('unknown');
  });
});
