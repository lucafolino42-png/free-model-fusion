// public/js/utils.js
// Pure HTML-escaping helpers shared by the SPA and the test suite.
// Implemented as explicit string operations (no document dependency) so they
// are unit-testable in plain Node. Behavior matches the original
// textContent->innerHTML trick: < > & are escaped; quotes are NOT (that is
// escapeAttr's job). Exported on window for the inline SPA script to use.

export function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// escapeAttr: for use inside HTML attributes and inside JS string literals
// embedded in onclick="..." attributes. Escapes < > & ' " so a value cannot
// break out of the attribute or the string literal.
export function escapeAttr(s) {
  return esc(s)
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;');
}

// Expose to the inline SPA script (which is not a module).
if (typeof window !== 'undefined') {
  window.esc = esc;
  window.escapeAttr = escapeAttr;
}
