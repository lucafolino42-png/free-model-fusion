import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, maskApiKey } from '../src/utils/crypto.js';

describe('encrypt / decrypt round-trip', () => {
  it('decrypt(encrypt(x)) === x for an API key', () => {
    const key = 'gsk_test_abcdefghijklmnopqrstuvwxyz_0123456789';
    expect(decrypt(encrypt(key))).toBe(key);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const key = 'sk-somekeyvalue1234567890';
    expect(encrypt(key)).not.toBe(encrypt(key));
  });

  it('ciphertext format is iv:tag:encrypted (three hex parts)', () => {
    const ct = encrypt('hello');
    expect(ct.split(':').length).toBe(3);
  });

  it('throws on tampered ciphertext', () => {
    const ct = encrypt('secret');
    const [iv, tag, enc] = ct.split(':');
    // Flip a character in the encrypted payload.
    const tampered = `${iv}:${tag}:${enc.slice(0, -2)}ff`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws on malformed ciphertext (wrong number of parts)', () => {
    expect(() => decrypt('not-three-parts')).toThrow(/Invalid encrypted data format/);
  });
});

describe('maskApiKey', () => {
  it('masks a long key showing first 4 and last 4', () => {
    expect(maskApiKey('sk-abcdefghijklmnop1234567890')).toBe('sk-a****7890');
  });

  it('masks a short key (<=8 chars)', () => {
    expect(maskApiKey('abc123')).toBe('ab****');
  });
});
