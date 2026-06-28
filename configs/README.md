# Agent Configuration — Free Model Fusion

Configuration files for connecting external AI agents (Hermes, OpenClaw) to your local Free Model Fusion server.

## Quick Start

**Server must be running:**
```bash
npm run dev
# → http://localhost:3000
```

## The Compatibility Gap

Free Model Fusion uses a **custom API format** at `POST /chat`:

```json
// Request
{ "message": "Hello", "profile": "balanced", "sessionId": "my-session" }

// Response
{ "answer": "Hi!", "meta": { "routing": {...}, "models": {...} } }
```

Hermes and OpenClaw expect **OpenAI-compatible** format at `POST /v1/chat/completions`:

```json
// Request
{ "model": "gpt-4", "messages": [{"role": "user", "content": "Hello"}] }

// Response
{ "choices": [{"message": {"role": "assistant", "content": "Hi!"}}] }
```

**Two options:**

### Option A: Use the configs as-is (direct)

Apply the configs from this directory. They configure the agent frameworks to talk directly to `http://localhost:3000` — but only work if your framework supports custom non-OpenAI endpoints. Some do, some don't.

### Option B: Run the OpenAI adapter (recommended)

```bash
# In one terminal:
npm run dev

# In another terminal — start the adapter:
node configs/openai-adapter.mjs

# Adapter runs on http://localhost:3001
# It translates OpenAI format → Fusion format
```

Then configure your agent to point to `http://localhost:3001/v1` instead.

---

## Files

| File | For | What it does |
|------|-----|-------------|
| `hermes.yaml` | Hermes | Copy into `~/.hermes/config.yaml` or run `hermes model` wizard |
| `openclaw.json5` | OpenClaw | Copy into `~/.openclaw/openclaw.json` |
| `openai-adapter.mjs` | Both | Translates OpenAI format → Fusion format (standalone server) |

## Testing the connection

```bash
# Test the fusion server directly:
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello!","profile":"balanced"}'

# If using the adapter:
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer fusion" \
  -d '{"model":"fusion-balanced","messages":[{"role":"user","content":"Hello!"}]}'
```

## Profiles

Map the model names in the configs to fusion profiles:

| Model ID | Profile | Best for |
|----------|---------|----------|
| `fusion-speed` | `speed` | Quick Q&A, simple tasks |
| `fusion-balanced` | `balanced` | General purpose (default) |
| `fusion-quality` | `quality` | Deep reasoning, complex tasks |

Set `fusionCustomProfile` or pass it in the adapter body as `fusionProfile` to override.

## Session Memory

Both configs let you set a `sessionId` to maintain conversation context across turns. The fusion server remembers messages per session and feeds them back as context on subsequent requests.
