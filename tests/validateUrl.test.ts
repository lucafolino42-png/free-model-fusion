import { describe, it, expect } from 'vitest';
import { validateProviderUrl, sanitizeErrorMessage } from '../src/utils/validateUrl.js';

describe('validateProviderUrl', () => {
  it('accepts a valid public https URL', () => {
    expect(() => validateProviderUrl('https://api.groq.com/openai/v1/chat/completions')).not.toThrow();
  });

  it('rejects http scheme', () => {
    expect(() => validateProviderUrl('http://api.example.com/v1/chat')).toThrow(/https:/);
  });

  it('rejects an invalid URL string', () => {
    expect(() => validateProviderUrl('not-a-url')).toThrow(/Invalid provider endpoint URL/);
  });

  it('rejects localhost', () => {
    expect(() => validateProviderUrl('https://localhost:3000/v1/chat')).toThrow(/reserved or internal hostname/);
  });

  it('rejects a private IPv4 range (10.x)', () => {
    expect(() => validateProviderUrl('https://10.0.0.1/v1/chat')).toThrow(/private or internal IP/);
  });

  it('rejects a private IPv4 range (192.168.x)', () => {
    expect(() => validateProviderUrl('https://192.168.1.1/v1/chat')).toThrow(/private or internal IP/);
  });

  it('rejects a loopback IPv4 (127.x)', () => {
    expect(() => validateProviderUrl('https://127.0.0.1/v1/chat')).toThrow(/private or internal IP/);
  });

  it('rejects a raw public IP address', () => {
    expect(() => validateProviderUrl('https://8.8.8.8/v1/chat')).toThrow(/raw IP address/);
  });

  it('rejects a .internal hostname', () => {
    expect(() => validateProviderUrl('https://host.docker.internal/v1/chat')).toThrow(/reserved or internal hostname/);
  });

  it('rejects a .local hostname', () => {
    expect(() => validateProviderUrl('https://myhost.local/v1/chat')).toThrow(/reserved or internal hostname/);
  });
});

describe('sanitizeErrorMessage', () => {
  it('redacts an sk- style key', () => {
    const out = sanitizeErrorMessage('error: sk-abcdefghijklmnopqrstuvwxyz1234567890');
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234567890');
    expect(out).toContain('****');
  });

  it('redacts a gsk_ style key', () => {
    const out = sanitizeErrorMessage('got gsk_abcdefghijklmnopqrstuvwxyz1234567890 from provider');
    expect(out).not.toContain('gsk_abcdefghijklmnopqrstuvwxyz1234567890');
    expect(out).toContain('****');
  });

  it('redacts an Authorization Bearer header value', () => {
    const out = sanitizeErrorMessage('Authorization: Bearer supersecrettokenvalue1234567890');
    expect(out).not.toContain('supersecrettokenvalue1234567890');
    expect(out).toContain('****');
  });

  it('redacts a Google AIza key', () => {
    const key = 'AIzaSyA' + 'BcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'.slice(0, 28);
    const out = sanitizeErrorMessage(`key was ${key}`);
    expect(out).not.toContain(key);
  });

  it('leaves ordinary error text intact', () => {
    const msg = 'Provider Groq Cloud returned 401: Invalid API key';
    expect(sanitizeErrorMessage(msg)).toBe(msg);
  });
});
