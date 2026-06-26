# Sub-project E — Security Hardening (Design + Plan)

**Date:** 2026-06-26  Depends on: A–D (merged). Branch: `subproject-e-security`
**Skill used:** api-security-testing (checklist-driven audit).

## Audit results (against the skill's checklist)

| Check | Status | Action |
|---|---|---|
| Authentication | N/A (self-hosted, operator-trusted by design) | none |
| Authorization | N/A | none |
| Input validation | ✅ zod/JSON schemas; ✅ SSRF (A); ✅ /api/env allowlist | none |
| Rate limiting | ⚠️ global 100/min shared by /health and /chat | **add stricter per-route limit on /chat** |
| Errors sanitized | ✅ 5xx hides message; stack logged only | none |
| Logging | ✅ structured | none |
| CORS | ⚠️ `origin:true` reflects any origin | **make configurable (CORS_ORIGIN env)** |
| HTTPS | N/A (reverse proxy) | none |
| **Security headers** | ❌ missing (no CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy) | **add via onSend hook, no new dep** |

## Scope (in)
1. **Security headers** — Fastify `onSend` hook setting:
   `Content-Security-Policy` (default-src 'self'; script/style 'self' 'unsafe-inline'
   — inline styles/scripts are used by the SPA; font 'self' + Google Fonts CDN),
   `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
   `Referrer-Policy: strict-origin-when-cross-origin`. No new dependency.
2. **Configurable CORS** — add `CORS_ORIGIN` env (default `*` to preserve dev
   convenience; set to a specific origin to lock down). `config.ts` + `server.ts`.
3. **Stricter /chat rate limit** — register `@fastify/rate-limit` per-route on
   `/chat` (e.g. 20/min) so the expensive external-API path can't be abused to
   burn provider quota. Global 100/min stays for cheap routes.
4. **Type-safe Tavily response parse** — replace `webSearch.ts` blind `as {...}`
   with an `isObject` guard (fold-in from C's pattern).
5. **Tests** — extend `routes.test.ts`: assert security headers present on a
   response; assert CORS reflects configured origin.

## Scope (out)
- Auth/authz (by design, self-hosted).
- HTTPS enforcement (reverse proxy).
- Full penetration test (checklist audit applied; not a pentest engagement).

## Non-negotiables
- No new runtime dependency (use Fastify hooks + existing `@fastify/rate-limit`).
- 137 tests stay green; tsc clean.
- CSP must not break the SPA (inline styles/scripts are used → 'unsafe-inline'
  for style/script is required; document the tradeoff).
