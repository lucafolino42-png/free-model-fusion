import { describe, it, expect } from 'vitest';
import { esc, escapeAttr } from '../public/js/utils.js';

describe('esc (HTML text-content escape)', () => {
  it('escapes < > &', () => {
    expect(esc('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('escapes a bare ampersand', () => {
    expect(esc('a & b')).toBe('a &amp; b');
  });

  it('returns empty string for null/undefined/empty', () => {
    expect(esc(null as unknown as string)).toBe('');
    expect(esc(undefined as unknown as string)).toBe('');
    expect(esc('')).toBe('');
  });

  it('leaves plain text unchanged', () => {
    expect(esc('Hello world 123')).toBe('Hello world 123');
  });

  it('does NOT escape quotes (that is escapeAttr’s job)', () => {
    expect(esc("a'b\"c")).toBe("a'b\"c");
  });
});

describe('escapeAttr (HTML attribute / JS-string-literal escape)', () => {
  it('escapes < > & and both quotes', () => {
    expect(escapeAttr('<a onclick="x">\'&\'</a>')).toBe(
      '&lt;a onclick=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
    );
  });

  it('escapes single quotes (breaks onclick string-literal injection)', () => {
    // A provider id containing a single quote must not break out of the
    // onclick="...(''+id+'')" attribute string literal.
    expect(escapeAttr("a',alert(1),'b")).toBe("a&#39;,alert(1),&#39;b");
  });

  it('escapes double quotes', () => {
    expect(escapeAttr('a"b')).toBe('a&quot;b');
  });

  it('returns empty string for null/undefined/empty', () => {
    expect(escapeAttr(null as unknown as string)).toBe('');
    expect(escapeAttr('')).toBe('');
  });

  it('is safe to embed inside onclick="...(\'...\')" ', () => {
    const id = escapeAttr("evil');alert('xss");
    const attr = `onclick="doThing('${id}')"`;
    // The dangerous single quotes from the input are neutralized to &#39;;
    // they cannot close the JS string literal. The attribute's own delimiter
    // quotes (the literal ' in the template) remain, which is intended.
    expect(attr).toContain('&#39;');
    // No raw, unescaped single-quote from the INPUT survives: every character
    // that came from the input's single quotes is now &#39;.
    expect(id).toBe('evil&#39;);alert(&#39;xss');
    // And crucially, the injected "alert('xss')" is not executable as JS here
    // because the quotes that would close/open the string are entity-encoded.
    expect(id).not.toContain("')"); // no input quote is raw
  });
});
