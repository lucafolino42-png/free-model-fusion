# Free Model Fusion 🤖

> **Turn your free AI API keys into a smarter multi-model assistant.**

Free Model Fusion is a **self-hosted, open-source AI router** that combines multiple free/cheap AI APIs into one intelligent assistant with expert panels, judge/synthesis evaluation, session memory, web search, Telegram support, and speed-vs-quality routing.

Think of it as a **free OpenRouter-style model fusion engine** for people who collect free AI API keys from providers like Groq, OpenRouter, Gemini, Cerebras, NVIDIA NIM, Together, Fireworks, DeepInfra, and more.

[![tests](https://img.shields.io/badge/tests-184%20passing-brightgreen)](docs/superpowers/specs/)
[![typecheck](https://img.shields.io/badge/tsc--noEmit-clean-brightgreen)](docs/superpowers/specs/)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522-blue)](package.json)
[![ci](https://img.shields.io/badge/ci-model--freshness-blue)](.github/workflows/model-freshness.yml)

**Full reference: open `/docs` after launching, or see [`public/docs.html`](public/docs.html).**

**New in v1.0:** Reasoning effort control, skills system, setup wizard, OpenAI-compatible `/v1/chat/completions` endpoint with streaming, embeddings API, web UI dashboard with settings management, race mode for faster responses, query complexity analysis, accordion-based model groups with Discover button, Telegram meta footer with routing info, and tripled default token budgets (expert=22500, judge=16200, synthesis=45000).

## License

MIT — see [`LICENSE`](LICENSE).

## Contributing

PRs welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, conventions, and where to help.

## Security

Auth/authz is intentionally absent — this is a self-hosted tool meant for trusted networks. Put it behind a reverse proxy (Caddy / nginx / Cloudflare Tunnel) if exposing it. Found a vulnerability? Open an issue with the `security` label.

## Router vs Model Fusion

Free Model Fusion can be used in two ways:

### 1. Model Router
Use one local/self-hosted interface in front of many AI providers. Route by speed, quality, availability, and fallback behavior.

### 2. Model Fusion
For harder prompts, call multiple expert models in parallel, evaluate their answers with a judge model, and synthesize the strongest parts into one final response.

This does not guarantee better answers. Quality depends on the providers, models, prompts, and settings you configure.

## Why?

If you're collecting free API keys from AI providers, you know the pain:

- Each provider has different models, endpoints, and rate limits
- No single free model is good at everything
- You want smart routing, fallback, and response fusion
- You don't want to pay a monthly fee for an AI gateway

Free Model Fusion solves this with a clean, single-file runtime. No n8n, no complex pipelines, no paid gateways.

## Features

- ✨ **Multi-Model Expert Panel** — Call multiple AI models in parallel and synthesize their answers
- ⚡ **Speed vs Quality Routing** — Choose between quick answers (`/speed`) and deep reasoning (`/quality`)
- 🧠 **Judge + Synthesis Pipeline** — Evaluate expert responses and produce a refined final answer
- 🔄 **Automatic Fallback** — If some models fail, continue with successful ones
- 📚 **Session Memory** — Persistent conversation history with configurable context length
- 🔍 **Web Search** — Built-in Tavily search integration with auto-detect mode
- 🏃 **Race Mode** — Proceed to synthesis once 2 experts respond (speed/balanced profiles)
- 🧩 **Skills System** — Load task-specific prompt modifiers (code review, debugging, education, etc.)
- 🎯 **Reasoning Effort** — Control model thinking depth (low/medium/high/xhigh)
- 🤖 **Telegram Bot** — Full Telegram support with webhook and polling modes
- 🌐 **Web UI Dashboard** — Full SPA with chat, providers, models, keys, settings, and setup wizard
- 🔗 **OpenAI-Compatible API** — Connect any OpenAI SDK client via `/v1/chat/completions` with **chunked streaming** + tool parsing
- 🔐 **Encrypted Credentials** — API keys stored encrypted in the database
- 🧩 **Custom Providers** — Add any OpenAI-compatible API endpoint
- 🚀 **Setup Wizard** — Step-by-step guided onboarding for new users
- 🐳 **Docker Ready** — One command to deploy
- 📦 **Self-Hosted** — Your keys, your data, your control

## Performance

> **How much better is multi-model fusion compared to a single AI model?**

Free Model Fusion uses a **Mixture-of-Agents (MoA)** approach — calling multiple AI models in parallel, evaluating their responses with a judge model, and synthesizing a refined final answer. Published research ([arXiv:2406.04692](https://arxiv.org/abs/2406.04692)) demonstrates this method **can improve quality** over single models depending on the configured models and prompts, with **improved robustness through automatic fallback** when individual models fail.

> ⚠️ **Important:** Actual quality depends entirely on the providers, models, and settings you configure. The benchmark runner (`npx tsx scripts/benchmark.ts`) lets you test your own setup — do not treat published research numbers as guarantees for your configuration.

📊 **See the full analysis:** [`MODEL_FUSION_ANALYSIS.md`](MODEL_FUSION_ANALYSIS.md) — includes architecture diagrams, cost analysis, and real-world scenario comparisons.

🧪 **Run your own benchmark:** `npx tsx scripts/benchmark.ts` — compares single-model vs fusion responses across 10 questions and generates a markdown report. Results are local/config-dependent and not universal proof.

| Metric | Single Model | Fusion (Typical) |
|--------|-------------|------------------|
| **Quality** | Varies by model | Can improve with diverse experts |
| **Reliability** | Single point of failure | Designed for fallback/redundancy |
| **Cost (free APIs)** | $0.00 | $0.00 |
| **Cost (paid APIs)** | $0.0001–0.005 | $0.002–0.02 (2-4x more calls) |

> **Note:** Fusion makes multiple API calls per query. With free tiers this stays $0, but paid APIs multiply costs. Provider free tiers and limits change over time.

---

## Quickstart

### With Docker (recommended)

```bash
# Clone & enter
git clone https://github.com/lucafolino42-png/free-model-fusion.git
cd free-model-fusion

# Copy env and edit
cp .env.example .env
# At minimum, set FUSION_SECRET_KEY
# Optional: Add GROQ_API_KEY for free fast models (note: free tier has strict 6000 TPM limit)

# Start
docker compose up -d

# Check health
curl http://localhost:3000/health
```

> ⚠️ **Groq Free Tier Note:** The default expert token limit is 2000 to work within Groq's free tier (6000 TPM for Llama 3.1 8B). If you only have Groq keys, consider adding more providers (Gemini, Cerebras, OpenRouter free models) for better reliability. You can increase `FUSION_EXPERT_MAX_TOKENS` if you have a paid Groq plan.

### Without Docker

```bash
# Clone & enter
git clone https://github.com/lucafolino42-png/free-model-fusion.git
cd free-model-fusion

# Install dependencies
npm install

# Copy env and edit
cp .env.example .env

# Start in development mode
npm run dev
```

## Usage

### API (Native `/chat` endpoint)

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Explain how Cloudflare Tunnel works",
    "sessionId": "demo"
  }'
```

Response:

```json
{
  "answer": "Cloudflare Tunnel creates an encrypted tunnel...",
  "telegramHtml": "...",
  "meta": {
    "routing": { "profile": "balanced", "expertsUsed": 3, ... },
    "models": { "experts": ["gemini_flash", "groq_llama3_70b", ...] },
    "web": { "enabled": false, "searched": false, ... },
    "memory": { "sessionId": "demo", ... },
    "tokens": { ... }
  }
}
```

### OpenAI-Compatible API (`/v1/chat/completions`)

```bash
# Non-streaming
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fusion-balanced",
    "messages": [
      { "role": "user", "content": "Explain Cloudflare Tunnel" }
    ]
  }'
```

```bash
# Streaming (chunked - generates full response then streams as chunks)
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fusion-quality",
    "messages": [
      { "role": "user", "content": "Write a haiku about Docker" }
    ],
    "stream": true
  }'
```

> **Note:** Streaming is **chunked compatibility streaming** — the full response is generated first, then sent as SSE chunks. This is not true token-by-token streaming.

### Speed vs Quality

```bash
# Quick answer
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "/speed What is 2+2?", "sessionId": "demo"}'

# Deep reasoning
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "/quality Explain quantum error correction", "sessionId": "demo"}'
```

### Telegram

1. Create a bot via [@BotFather](https://t.me/BotFather) and get the token
2. Set `TELEGRAM_BOT_TOKEN` in `.env`
3. (Optional) Set `TELEGRAM_WEBHOOK_URL` for production webhook mode
4. Start the app

```text
/addkey groq gsk_abc...     # Add your API key
/profile speed               # Set speed profile
What is the weather?         # Regular question
/quality Explain deeply      # One-time quality override
/web auto                    # Enable auto web search
/search latest AI news       # Manual search
```

### Adding a Custom Provider

Free Model Fusion supports any OpenAI-compatible API endpoint:

```bash
# Add the provider
/addprovider {"name":"nvidia_nim","endpoint":"https://integrate.api.nvidia.com/v1/chat/completions"}

# Add your API key
/addkey nvidia_nim nvapi-abc...

# Add models
/addmodel {"provider":"nvidia_nim","key":"nvidia_quality","model":"meta/llama-3.1-405b-instruct","useAs":["expert","judge","synthesis"]}

# Use it
/usemodel nvidia_quality
/profile quality
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `DATABASE_URL` | `file:./data/fusion.db` | SQLite database path |
| `FUSION_SECRET_KEY` | — | Encryption key (min 32 chars; required in production) |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token |
| `TELEGRAM_WEBHOOK_URL` | — | Webhook URL for Telegram |
| `TAVILY_API_KEY` | — | Tavily web search API key |
| `CORS_ORIGIN` | `*` | Allowed origins for the API. Set to a specific origin in production |
| `OPENROUTER_API_KEY` | — | OpenRouter API key |
| `GROQ_API_KEY` | — | Groq API key |
| `GEMINI_API_KEY` | — | Google Gemini API key |
| `CEREBRAS_API_KEY` | — | Cerebras API key |
| `NVIDIA_NIM_API_KEY` | — | NVIDIA NIM API key |
| `TOGETHER_API_KEY` | — | Together AI API key |
| `FIREWORKS_API_KEY` | — | Fireworks AI API key |
| `DEEPINFRA_API_KEY` | — | DeepInfra API key |
| `NOVITA_API_KEY` | — | Novita AI API key |
| `HYPERBOLIC_API_KEY` | — | Hyperbolic API key |
| `SAMBANOVA_API_KEY` | — | SambaNova API key |
| `PERPLEXITY_API_KEY` | — | Perplexity API key |
| `NEBIUS_API_KEY` | — | Nebius API key |
| `REPLICATE_API_KEY` | — | Replicate API key |
| `LAMBDA_API_KEY` | — | Lambda Labs API key |
| `CUSTOM_OPENAI_API_KEY` | — | Custom OpenAI-compatible provider API key |
| `FUSION_DEFAULT_PROFILE` | `balanced` | `speed`, `balanced`, `quality`, or `custom` |
| `FUSION_MAX_EXPERTS` | `4` | Maximum expert models to call |
| `FUSION_MAX_EXPERTS_PER_PROVIDER` | `2` | Max experts per provider |
| `FUSION_EXPERT_MAX_TOKENS` | `22500` | Max tokens per expert response |
| `FUSION_JUDGE_MAX_TOKENS` | `16200` | Max tokens for judge evaluation |
| `FUSION_SYNTHESIS_MAX_TOKENS` | `45000` | Max tokens for synthesis |
| `FUSION_CONTINUATION_MAX_TOKENS` | `22500` | Max tokens for continuation |
| `FUSION_ENABLE_CONTINUATION` | `true` | Enable continuation on truncation |
| `FUSION_MAX_CONTINUATIONS` | `1` | Max continuation attempts |
| `FUSION_HISTORY_MESSAGES` | `12` | Max history messages to load |
| `FUSION_HISTORY_CHARS` | `12000` | Max history characters |
| `FUSION_WEB_MAX_RESULTS` | `5` | Max web search results |
| `FUSION_WEB_CONTEXT_CHARS` | `8000` | Max web search context chars |
| `TELEGRAM_CHUNK_SIZE` | `3600` | Telegram message chunk size |

See [.env.example](.env.example) for the complete list.

## Supported Providers

Free Model Fusion comes pre-configured with presets for:

| Provider | Speed | Quality | Free Tier? | Notes |
|----------|-------|---------|------------|-------|
| Groq | ⚡ very_fast | Good | ✅ Yes* | Free tier has strict rate limits (TPM) |
| Cerebras | ⚡ very_fast | Good | ✅ Yes* | Free tier available |
| Gemini | ⚡ fast | Strong | ✅ Yes* | Free tier with daily limits |
| OpenRouter | ⚡ fast | Frontier | ✅ Free models | Access to many free models |
| SambaNova | ⚡ fast | Good | ✅ Yes* | Free tier available |
| Together | ⚡ fast | Strong | 💲 Pay-as-you-go | No free tier |
| Fireworks | ⚡ fast | Strong | 💲 Pay-as-you-go | No free tier |
| DeepInfra | ⚡ fast | Good | 💲 Pay-as-you-go | No free tier |
| Novita | ⚡ fast | Good | 💲 Cheap | No free tier |
| Hyperbolic | 🐢 medium | Good | 💲 Pay-as-you-go | No free tier |
| Perplexity | 🐢 medium | Strong | 💲 Pay-as-you-go | No free tier |
| Nebius | 🐢 medium | Strong | 💲 Pay-as-you-go | No free tier |
| Replicate | 🐢 medium | Good | 💲 Pay-as-you-go | No free tier |
| Lambda Labs | 🐢 medium | Strong | 💲 Pay-as-you-go | No free tier |
| NVIDIA NIM | 🐢 slow | Frontier | 💲 Pay-as-you-go | No free tier |
| Custom | Configurable | Configurable | You choose | Any OpenAI-compatible endpoint |

> ⚠️ **Free tiers marked with * may have strict rate limits, daily quotas, or require account verification.** Provider free tiers and limits change over time — always check the provider's current pricing page.

### NVIDIA NIM Example

```bash
/addprovider {"name":"nvidia_nim","endpoint":"https://integrate.api.nvidia.com/v1/chat/completions"}
/addkey nvidia_nim nvapi-abc123...
/addmodel {"provider":"nvidia_nim","key":"nvidia_quality","model":"meta/llama-3.1-405b-instruct","useAs":["expert","judge","synthesis"]}
/usemodel nvidia_quality
/profile quality
```

## Project Structure

```
free-model-fusion/
├── src/
│   ├── index.ts              # Entry point
│   ├── config.ts             # Environment configuration
│   ├── server.ts             # Fastify server setup
│   ├── db/
│   │   ├── schema.ts         # Database schema
│   │   ├── client.ts         # Database client
│   │   └── settings.ts       # Settings persistence
│   ├── providers/
│   │   ├── types.ts          # Type definitions
│   │   ├── presets.ts        # Provider/model presets
│   │   ├── registry.ts       # Provider/model registry
│   │   ├── credentials.ts    # API key management
│   │   └── modelClient.ts    # OpenAI-compatible client
│   ├── fusion/
│   │   ├── normalizeInput.ts # Input sanitization
│   │   ├── commands.ts       # Command parser
│   │   ├── commandsHandler.ts# Command handler
│   │   ├── routing.ts        # Speed/quality routing
│   │   ├── expertPanel.ts    # Parallel expert calls
│   │   ├── judge.ts          # Response evaluation
│   │   ├── synthesis.ts      # Final answer synthesis
│   │   ├── continuation.ts   # Truncation handling
│   │   ├── memory.ts         # Session memory
│   │   ├── webSearch.ts      # Tavily search
│   │   └── prompts.ts        # System prompts
│   ├── telegram/
│   │   ├── bot.ts            # Bot initialization
│   │   ├── webhook.ts        # Webhook handler
│   │   └── send.ts           # Message sending
│   ├── format/
│   │   ├── telegramHtml.ts   # HTML formatter
│   │   └── splitTelegram.ts  # Message splitter
│   ├── api/
│   │   ├── routes/           # HTTP API routes (split by group)
│   │   │   ├── index.ts      # registerRoutes composition
│   │   │   ├── chat.ts       # /chat, /webhook/chat
│   │   │   ├── providers.ts  # /providers CRUD + toggle
│   │   │   ├── models.ts     # /models CRUD
│   │   │   ├── keys.ts       # /keys CRUD
│   │   │   ├── settings.ts   # /settings, /memory
│   │   │   ├── env.ts        # /api/env
│   │   │   └── static.ts     # /health, /, /favicon.ico
│   │   └── schemas.ts        # Zod validation schemas
│   └── utils/
│       ├── crypto.ts         # Encryption utilities
│       ├── logger.ts         # Logging
│       └── errors.ts         # Error classes
├── tests/                    # Test files
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## API Reference

### `POST /chat`

Send a chat message to the fusion engine.

**Body:**
```json
{
  "message": "string (required)",
  "sessionId": "string (optional)",
  "profile": "speed|balanced|quality|custom (optional)",
  "web": "on|off|auto (optional)",
  "source": "api|webhook (optional, default: api)"
}
```

**Response:**
```json
{
  "answer": "string",
  "telegramHtml": "string (optional)",
  "meta": {
    "routing": { "profile": "...", "expertsUsed": 3, ... },
    "models": { "experts": [...], "judge": "...", "synthesis": "..." },
    "web": { "enabled": true, "searched": true, "resultsCount": 5 },
    "memory": { "sessionId": "...", "messagesLoaded": 8, "messagesSaved": true },
    "tokens": { "expert": 22500, "judge": 16200, "synthesis": 45000, ... }
  }
}
```

### `GET /health`

Returns server health status.

### `GET /providers`

Returns all configured providers.

### `GET /models`

Returns all configured models.

### `POST /telegram/webhook`

Telegram webhook endpoint (configured automatically).

## Commands

| Command | Description |
|---------|-------------|
| `/help [command]` | Show help or get command details |
| `/profile [mode]` | View/change routing profile |
| `/speed [question]` | Quick answer (or set profile) |
| `/balanced [question]` | Balanced mode (default) |
| `/quality [question]` | Deep reasoning mode |
| `/models` | List available models |
| `/providers` | List configured providers |
| `/addkey <provider> <key>` | Save API key |
| `/deletekey <provider>` | Remove API key |
| `/listkeys` | Show configured keys |
| `/addprovider {...json...}` | Add custom provider |
| `/addmodel {...json...}` | Add custom model |
| `/usemodel <key>` | Use model as expert |
| `/unusemodel <key>` | Stop using model |
| `/add <key>` | Alias for `/usemodel` |
| `/remove <key>` | Alias for `/unusemodel` |
| `/enablemodel <key>` | Add model to custom expert set |
| `/disablemodel <key>` | Remove model from expert set |
| `/enableprovider <id>` | Enable a provider |
| `/disableprovider <id>` | Disable a provider |
| `/setjudge <key>` | Set judge model |
| `/setsynthesis <key>` | Set synthesis model |
| `/reasoning [level]` | Control reasoning effort |
| `/skills [load/unload/search]` | Load, unload, or search skills |
| `/addsearchkey tavily <key>` | Add web search API key |
| `/web [on\|off\|auto]` | Web search mode |
| `/search <query>` | Manual web search |
| `/memory` | Show conversation history |
| `/clearmemory confirm` | Clear session memory |
| `/newchat` | Start fresh session |
| `/stats` | Session statistics |
| `/tokens` | Show token settings |
| `/settokens <e> <j> <s>` | Set token limits |
| `/resettokens confirm` | Reset token defaults |
| `/wizard` | Guided setup wizard |
| `/resetregistry confirm` | Reset custom providers/models |

## Security

- API keys are stored **encrypted** using AES-256-GCM in the database
- API keys are **never logged** or exposed in responses
- `FUSION_SECRET_KEY` is required for production to encrypt stored keys
- Custom provider URLs create SSRF risk — only add trusted endpoints
- Telegram HTML is sanitized before sending
- Rate limiting can be enabled via Fastify configuration

## Deployment

### Docker (recommended)

```bash
docker compose up -d
```

### VPS / Railway / Fly.io / Coolify

1. Set environment variables in your hosting dashboard
2. Use the Dockerfile or run `npm run build && npm start`
3. Set `TELEGRAM_WEBHOOK_URL` to your public URL for Telegram support

### PostgreSQL

By default, Free Model Fusion uses SQLite (zero setup). **PostgreSQL support is planned but not yet implemented** — the code currently only supports libSQL/SQLite via `@libsql/client`.

For PostgreSQL (when implemented):
1. Set `DATABASE_URL` to your PostgreSQL connection string
2. Use Drizzle's PostgreSQL driver instead of `@libsql/client`

## Roadmap

- [x] Streaming responses (`/v1/chat/completions`)
- [x] Web UI dashboard (full SPA)
- [ ] More web search providers (SearXNG, Bing, Google)
- [ ] PostgreSQL driver support
- [ ] Usage metrics and analytics
- [ ] Model benchmarking suite
- [ ] Multi-user support
- [ ] Plugin system for custom tools
- [ ] CLI tool (`fusion chat`, `fusion add-key`, etc.)
- [ ] Support for non-OpenAI APIs (Anthropic, Cohere, etc.)

## Limitations

- **Chunked streaming, not token-by-token** — Responses are generated in full, then streamed as chunks via `/v1/chat/completions` (compatible with OpenAI clients but not true token streaming)
- **Tool calling is prompt-injected + JSON parsing** — Not native provider-level tool calling; tool definitions are injected into the prompt and model output is parsed for JSON tool calls
- **Model IDs change** — Provider model IDs may change; use 📡 Discover in the Models view to re-fetch
- **Rate limits** — Each free provider has its own rate limits
- **SQLite default** — SQLite works great for single-user; PostgreSQL support is planned for multi-user

## Development

```bash
# Install
npm install

# Run in dev mode (auto-reload)
npm run dev

# Type check
npm run typecheck

# Tests
npm test

# Build
npm run build
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License — see [LICENSE](LICENSE) for details.

---

**Free Model Fusion** — Turn free AI keys into a smarter assistant. Built with ❤️ for the open-source community.
