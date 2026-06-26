# Sub-project D — Frontend Audit & UX Hardening (Design + Plan)

**Date:** 2026-06-26
**Depends on:** A, B, C (merged). Branch: `subproject-d-frontend`
**Skill used:** ui-ux-pro-max (design system confirmed: dark OLED, Inter, #08080e/#0d0d1a — the existing UI already matches).

## Goal

The current `public/index.html` (1009 lines, hand-written SPA, no framework) is
visually solid and already aligns with the recommended design system. D is
therefore a **targeted hardening pass**, not a ground-up redesign (which would
be high-risk with no frontend test layer). Focus: fix the real XSS bugs the
audit found, close accessibility gaps, and apply the skill's pre-delivery
checklist. A full visual redesign is explicitly out of scope.

## Audit findings (grounded in the actual code)

### Real XSS vulnerabilities (must fix)
1. **Chat meta renders `sessionId` unescaped** (`index.html:970-974`): meta
   values `r.profile`, `m.experts`, `mem.sessionId` are interpolated into
   `innerHTML` without `esc()`. `sessionId` is user-controlled (request body,
   `maxLength:200`, no char restriction) and flows to `meta.memory.sessionId`
   → stored-XSS via a crafted sessionId like `<img src=x onerror=…>`.
2. **`esc()` does not escape quotes** (`index.html:990`): `esc()` is
   `textContent→innerHTML`, which escapes `<`,`>`,`&` but NOT `'` or `"`. It is
   used inside `onclick="…(''+esc(p.id)+'')"` attribute string literals
   (provider/model/key tables). A custom provider id containing a single quote
   breaks out of the JS string → XSS. Custom ids have no character restriction
   in the POST `/providers` schema.

### Accessibility gaps (from ui-ux-pro-max + accessibility skill checklist)
3. Nav items and icon-only buttons lack `aria-label` / `role`.
4. No `prefers-reduced-motion` guard on the `fadeIn`/`msgIn` animations.
5. Sidebar toggle on mobile has no `aria-expanded` state.
6. Emoji used as status icons (✅❌🔑) in tables — the skill flags emoji-as-icons
   (font-dependent, can't be token-controlled). Replace with text/SVG where
   cheap; keep where semantically clear and low-risk.
7. Touch targets: most buttons are ≥32px; verify the icon-only `.btn-icon`
   meets 44×44 (it's 32px min — below the 44pt guideline). Bump via padding.

### Confirmed-good (no change)
- `api()` helper: no Content-Type on bodyless requests (the DELETE bug is
  already fixed).
- Design tokens, dark theme contrast, font pairing (Inter/JetBrains Mono).
- `esc()` is used on user content in table cells (labels/ids/endpoints).

## Scope (in)
- Add `escapeAttr()` (escapes `<`,`>`,`&`,`'`,`"`) and use it in all
  `onclick="…"` interpolations; replace `esc()` in those attribute contexts.
- Escape `r.profile`, `m.experts.join(',')`, `mem.sessionId` in chat meta.
- Add `aria-label`/`role` to nav items, icon buttons, sidebar toggle
  (`aria-expanded`).
- Add `@media (prefers-reduced-motion: reduce)` to disable animations.
- Bump `.btn-icon` tap area to ≥44px (padding/hit area, not visual size).
- Replace emoji status icons in tables with small inline SVG or text badges
  where low-risk.

## Scope (out)
- Ground-up visual redesign, new color palette, new layout (existing matches
  the recommended system; high risk without FE tests).
- Frontend test harness (vanilla JS SPA; deferred).
- Full WCAG audit pass with automated tooling (manual checklist applied).

## Non-negotiables
- No new `innerHTML` of unescaped user/external content anywhere.
- Behavior unchanged: all views still load, fetch URLs unchanged.
- `tsc`/vitest unaffected (frontend is static HTML) — re-run to confirm no
  regression in the routes test that serves the UI.
