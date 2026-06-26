# Free Model Fusion 🤖

> **Turn your free AI API keys into a smarter multi-model assistant.**

Free Model Fusion is a **self-hosted, open-source AI router** that combines multiple free/cheap AI APIs into one intelligent assistant with expert panels, judge/synthesis evaluation, session memory, web search, Telegram support, and speed-vs-quality routing.

Think of it as a **free OpenRouter-style model fusion engine** for people who collect free AI API keys from providers like Groq, OpenRouter, Gemini, Cerebras, NVIDIA NIM, Together, Fireworks, DeepInfra, and more.

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
- 🔍 **Web Search** — Built-in Tavily search integration for current/relevant information
- 🤖 **Telegram Bot** — Full Telegram support with webhook and polling modes
- 🔐 **Encrypted Credentials** — API keys stored encrypted in the database
- 🧩 **Custom Providers** — Add any OpenAI-compatible API endpoint
- 🐳 **Docker Ready** — One command to deploy
- 📦 **Self-Hosted** — Your keys, your data, your control

## Quickstart

### With Docker (recommended)

```bash
# Clone & enter
git clone https://github.com/yourusername/free-model-fusion.git
cd free-model-fusion

# Copy env and edit
cp .env.example .env
# At minimum, set FUSION_SECRET_KEY

# Start
docker compose up -d

# Check health
curl http://localhost:3000/health
```

### Without Docker

```bash
# Clone & enter
git clone https://github.com/yourusername/free-model-fusion.git
cd free-model-fusion

# Install dependencies
npm install

# Copy env and edit
cp .env.example .env

# Start in development mode
npm run dev
```

## Usage

### API

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
| `FUSION_SECRET_KEY` | — | Encryption key (min 32 chars) |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token |
| `TELEGRAM_WEBHOOK_URL` | — | Webhook URL for Telegram |
| `TAVILY_API_KEY` | — | Tavily web search API key |
| `OPENROUTER_API_KEY` | — | OpenRouter API key |
| `GROQ_API_KEY` | — | Groq API key |
| `GEMINI_API_KEY` | — | Google Gemini API key |
| `CEREBRAS_API_KEY` | — | Cerebras API key |
| `NVIDIA_NIM_API_KEY` | — | NVIDIA NIM API key |
| `FUSION_DEFAULT_PROFILE` | `balanced` | `speed`, `balanced`, `quality`, or `custom` |
| `FUSION_MAX_EXPERTS` | `4` | Maximum expert models to call |
| `FUSION_EXPERT_MAX_TOKENS` | `2500` | Max tokens per expert response |
| `FUSION_JUDGE_MAX_TOKENS` | `1800` | Max tokens for judge evaluation |
| `FUSION_SYNTHESIS_MAX_TOKENS` | `5000` | Max tokens for synthesis |
| `FUSION_HISTORY_MESSAGES` | `12` | Max history messages to load |

See [.env.example](.env.example) for the complete list.

## Supported Providers

Free Model Fusion comes pre-configured with presets for:

| Provider | Speed | Quality | Free Tier |
|----------|-------|---------|-----------|
| Groq | ⚡ very_fast | Good | ✅ Free |
| Cerebras | ⚡ very_fast | Good | ✅ Free |
| Gemini | ⚡ fast | Strong | ✅ Free |
| OpenRouter | ⚡ fast | Frontier | ✅ Free models |
| Together | ⚡ fast | Strong | 💲 Pay-as-you-go |
| Fireworks | ⚡ fast | Strong | 💲 Pay-as-you-go |
| DeepInfra | ⚡ fast | Good | 💲 Pay-as-you-go |
| Novita | ⚡ fast | Good | 💲 Cheap |
| Perplexity | 🐢 medium | Strong | 💲 Pay-as-you-go |
| NVIDIA NIM | 🐢 slow | Frontier | 💲 Pay-as-you-go |
| Custom | Configurable | Configurable | You choose |

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
│   │   ├── routes.ts         # HTTP API routes
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
    "tokens": { "expert": 2500, "judge": 1800, "synthesis": 5000, ... }
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
| `/help` | Show help message |
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
| `/web [on\|off\|auto]` | Web search mode |
| `/search <query>` | Manual web search |
| `/memory` | Show conversation history |
| `/clearmemory confirm` | Clear session memory |
| `/tokens` | Show token settings |
| `/settokens <e> <j> <s>` | Set token limits |

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

By default, Free Model Fusion uses SQLite (zero setup). For PostgreSQL:

1. Set `DATABASE_URL` to your PostgreSQL connection string
2. Install the `@libsql/client` with PostgreSQL support or switch to Drizzle's PostgreSQL driver

## Roadmap

- [ ] Streaming responses
- [ ] Web UI dashboard
- [ ] More web search providers (SearXNG, Bing, Google)
- [ ] PostgreSQL driver support
- [ ] Usage metrics and analytics
- [ ] Model benchmarking suite
- [ ] Multi-user support
- [ ] Plugin system for custom tools
- [ ] CLI tool (`fusion chat`, `fusion add-key`, etc.)
- [ ] Support for non-OpenAI APIs (Anthropic, Cohere, etc.)

## Limitations

- **No streaming yet** — All responses are generated in full before returning
- **No web UI in v1** — Telegram and API only
- **Model IDs change** — Provider model IDs may change; you can override via custom providers
- **Rate limits** — Each free provider has its own rate limits
- **SQLite default** — SQLite works great for single-user; use PostgreSQL for multi-user

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
