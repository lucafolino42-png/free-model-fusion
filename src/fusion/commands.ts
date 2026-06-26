import type { RoutingProfile } from '../providers/types.js';

// ─── Parsed Command Types ────────────────────────────────
export interface ParsedCommand {
  type: 'message' | 'help' | 'profile' | 'speed' | 'balanced' | 'quality' | 'custom' |
    'models' | 'providers' | 'addkey' | 'deletekey' | 'listkeys' |
    'addprovider' | 'deleteprovider' | 'enableprovider' | 'disableprovider' |
    'addmodel' | 'deletemodel' | 'enablemodel' | 'disablemodel' |
    'usemodel' | 'unusemodel' | 'setjudge' | 'setsynthesis' |
    'addsearchkey' | 'web' | 'search' |
    'memory' | 'clearmemory' |
    'tokens' | 'settokens' | 'resettokens' |
    'resetregistry' | 'unknown';
  text: string; // Remaining text after command
  args: string[];
  profileOverride?: RoutingProfile; // For /speed question style
}

// ─── Parse Message ───────────────────────────────────────
export function parseCommand(message: string): ParsedCommand {
  const trimmed = message.trim();

  // Not a command
  if (!trimmed.startsWith('/')) {
    return { type: 'message', text: trimmed, args: [] };
  }

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const text = parts.slice(1).join(' ');
  const args = parts.slice(1);

  // /help
  if (cmd === '/help') {
    return { type: 'help', text: '', args: [] };
  }

  // /profile [speed|balanced|quality|custom]
  if (cmd === '/profile') {
    return { type: 'profile', text, args };
  }

  // /speed|/balanced|/quality|/custom [question]
  if (['/speed', '/balanced', '/quality', '/custom'].includes(cmd)) {
    const profile = cmd.slice(1) as RoutingProfile;
    return {
      type: profile as ParsedCommand['type'],
      text,
      args,
      profileOverride: text ? profile : undefined,
    };
  }

  // /ask speed|balanced|quality <question>
  if (cmd === '/ask') {
    const subCmd = args[0]?.toLowerCase() as RoutingProfile | undefined;
    if (subCmd && ['speed', 'balanced', 'quality', 'custom'].includes(subCmd)) {
      return {
        type: subCmd as ParsedCommand['type'],
        text: args.slice(1).join(' '),
        args: args.slice(1),
        profileOverride: subCmd,
      };
    }
    return { type: 'message', text: trimmed, args: [] };
  }

  // /models
  if (cmd === '/models') {
    return { type: 'models', text: '', args: [] };
  }

  // /providers
  if (cmd === '/providers') {
    return { type: 'providers', text: '', args: [] };
  }

  // /addkey <provider> <apikey>
  if (cmd === '/addkey') {
    return { type: 'addkey', text, args };
  }

  // /deletekey <provider>
  if (cmd === '/deletekey') {
    return { type: 'deletekey', text, args };
  }

  // /listkeys
  if (cmd === '/listkeys') {
    return { type: 'listkeys', text: '', args: [] };
  }

  // /addprovider {...json...}
  if (cmd === '/addprovider') {
    return { type: 'addprovider', text, args };
  }

  // /deleteprovider <provider>
  if (cmd === '/deleteprovider') {
    return { type: 'deleteprovider', text, args };
  }

  // /enableprovider <provider>
  if (cmd === '/enableprovider') {
    return { type: 'enableprovider', text, args };
  }

  // /disableprovider <provider>
  if (cmd === '/disableprovider') {
    return { type: 'disableprovider', text, args };
  }

  // /addmodel {...json...}
  if (cmd === '/addmodel') {
    return { type: 'addmodel', text, args };
  }

  // /deletemodel <modelKey>
  if (cmd === '/deletemodel') {
    return { type: 'deletemodel', text, args };
  }

  // /enablemodel <modelKey>
  if (cmd === '/enablemodel') {
    return { type: 'enablemodel', text, args };
  }

  // /disablemodel <modelKey>
  if (cmd === '/disablemodel') {
    return { type: 'disablemodel', text, args };
  }

  // /usemodel <modelKey>
  if (cmd === '/usemodel') {
    return { type: 'usemodel', text, args };
  }

  // /unusemodel <modelKey>
  if (cmd === '/unusemodel') {
    return { type: 'unusemodel', text, args };
  }

  // /setjudge <provider> [modelKey]
  if (cmd === '/setjudge') {
    return { type: 'setjudge', text, args };
  }

  // /setsynthesis <provider> [modelKey]
  if (cmd === '/setsynthesis') {
    return { type: 'setsynthesis', text, args };
  }

  // /addsearchkey tavily <apikey>
  if (cmd === '/addsearchkey') {
    return { type: 'addsearchkey', text, args };
  }

  // /web [on|off|auto]
  if (cmd === '/web') {
    return { type: 'web', text, args };
  }

  // /search <query>
  if (cmd === '/search') {
    return { type: 'search', text, args };
  }

  // /memory
  if (cmd === '/memory') {
    return { type: 'memory', text: '', args: [] };
  }

  // /clearmemory [confirm]
  if (cmd === '/clearmemory') {
    return { type: 'clearmemory', text, args };
  }

  // /tokens
  if (cmd === '/tokens') {
    return { type: 'tokens', text: '', args: [] };
  }

  // /settokens <expert> <judge> <synthesis>
  if (cmd === '/settokens') {
    return { type: 'settokens', text, args };
  }

  // /resettokens [confirm]
  if (cmd === '/resettokens') {
    return { type: 'resettokens', text, args };
  }

  // /resetregistry [confirm]
  if (cmd === '/resetregistry') {
    return { type: 'resetregistry', text, args };
  }

  return { type: 'unknown', text: trimmed, args: [] };
}
