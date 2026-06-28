import { describe, it, expect } from 'vitest';
import { showCommandHelp, showFullHelp, COMMAND_HELP } from '../src/fusion/commandsHandler.js';

const ALL_COMMANDS = [
  'help',
  'profile', 'speed', 'balanced', 'quality', 'custom',
  'models', 'providers',
  'addkey', 'deletekey', 'listkeys',
  'addprovider', 'deleteprovider', 'enableprovider', 'disableprovider',
  'addmodel', 'deletemodel',
  'usemodel', 'unusemodel', 'setjudge', 'setsynthesis',
  'addsearchkey', 'web', 'search',
  'memory', 'clearmemory',
  'tokens', 'settokens', 'resettokens',
  'newchat', 'stats', 'resetregistry',
  'reasoning', 'skills',
  'wizard',
] as const;

const ALIAS_COMMANDS = ['add', 'remove', 'enablemodel', 'disablemodel'] as const;

describe('COMMAND_HELP coverage', () => {
  for (const cmd of ALL_COMMANDS) {
    it('has a help entry for /' + cmd, () => {
      expect(COMMAND_HELP[cmd]).toBeDefined();
      expect(COMMAND_HELP[cmd].length).toBeGreaterThan(20);
    });
  }

  for (const cmd of ALIAS_COMMANDS) {
    it('has a help entry for alias /' + cmd, () => {
      expect(COMMAND_HELP[cmd]).toBeDefined();
      expect(COMMAND_HELP[cmd].length).toBeGreaterThan(20);
    });
  }

  it('every COMMAND_HELP entry has content', () => {
    for (const [key, value] of Object.entries(COMMAND_HELP)) {
      expect(value.length)
        .withContext('Entry for "' + key + '" is too short or empty')
        .toBeGreaterThan(20);
    }
  });
});

describe('showCommandHelp', () => {
  for (const cmd of ALL_COMMANDS) {
    it('returns help text for /' + cmd, () => {
      const result = showCommandHelp(cmd);
      expect(result.answer).toContain('/' + cmd);
      expect(result.answer).toContain('Usage');
    });
  }

  for (const cmd of ALIAS_COMMANDS) {
    it('returns help text for alias /' + cmd, () => {
      const result = showCommandHelp(cmd);
      expect(result.answer).toContain('/' + cmd);
    });
  }

  it('returns unknown command message for invalid commands', () => {
    const result = showCommandHelp('nonexistent');
    expect(result.answer).toContain('Unknown command');
  });

  it('is case-insensitive', () => {
    const result = showCommandHelp('WEB');
    expect(result.answer).toContain('/web');
  });

  it('returns FusionResult with empty meta', () => {
    const result = showCommandHelp('help');
    expect(result.meta).toBeDefined();
    expect(result.meta.memory.sessionId).toBe('');
  });
});

describe('showFullHelp', () => {
  it('returns full help text with app name', () => {
    const result = showFullHelp();
    expect(result.answer).toContain('Free Model Fusion');
  });

  it('lists all command categories', () => {
    const result = showFullHelp();
    expect(result.answer).toContain('Profiles');
    expect(result.answer).toContain('Models & Providers');
    expect(result.answer).toContain('Web Search');
    expect(result.answer).toContain('Memory');
    expect(result.answer).toContain('Session & Stats');
  });

  it('references /wizard in the help output', () => {
    const result = showFullHelp();
    expect(result.answer).toContain('/wizard');
  });

  it('tells users about /help', () => {
    const result = showFullHelp();
    expect(result.answer).toContain('/help');
  });
});
