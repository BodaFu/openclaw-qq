# openclaw-qq

**OpenClaw extension for QQ messaging via [NapCat](https://github.com/NapNeko/NapCatQQ) OneBot v11.**

Connects your OpenClaw AI agent to QQ — private chats, group chats, per-user persona customization, LLM-powered passive gating, MongoDB message persistence with automatic compaction, and a web admin panel.

[中文文档 →](./README.md)

---

## How it works

```
AI Agent (Claude / Gemini / Qwen / …)
  → OpenClaw agent loop
  → openclaw-qq extension (TypeScript)
  → OneBot v11 WebSocket
  → NapCat (QQ Framework)
  → QQ
```

The extension connects to NapCat's OneBot v11 WebSocket server, receives QQ messages, routes them through OpenClaw's agent loop, and delivers replies back to QQ. All message history is persisted to MongoDB with automatic LLM-powered compaction.

---

## Features

### Core

| Feature | Description |
|---|---|
| **Private chat** | Full bidirectional messaging with QQ friends |
| **Group chat** | Respond to @mentions, with optional passive listening |
| **Media support** | Images, @mentions, reply-to, and emoji reactions |
| **Cron delivery** | Proactive messages via OpenClaw's cron system |

### Per-User Persona System

Each QQ user can have a personalized AI persona:

- **Role-playing**: catgirl, pet, anime characters — fully customizable
- **Style tuning**: tsundere, cold, warm, sarcastic, etc.
- **Custom nicknames**: how the AI addresses the user and vice versa
- **Auto-distillation**: a lightweight LLM analyzes each conversation turn and updates the persona automatically
- **Persona isolation**: each user's persona is independent — A's customization doesn't affect B

Users without a custom persona get the default style.

### Intelligent Message Handling

| Feature | Description |
|---|---|
| **LLM passive gate** | Lightweight LLM decides whether to reply in groups (configurable model, debounce, interruptibility) |
| **MongoDB persistence** | Chat history stored with token-based automatic compaction |
| **LLM compaction** | Older messages summarized by LLM and archived when threshold is exceeded |
| **Admin panel** | Web UI for group management at `/qq/admin` |

---

## Prerequisites

| Requirement | Details |
|---|---|
| [OpenClaw](https://github.com/openclaw/openclaw) | Installed and gateway running |
| [NapCat](https://github.com/NapNeko/NapCatQQ) | Installed with OneBot v11 WebSocket server enabled |
| MongoDB | Running instance (default: `mongodb://127.0.0.1:27017`) |
| Node.js | >= 22 |
| QQ account | Logged in via NapCat |

---

## Quick Start

### 1. Clone into OpenClaw extensions directory

```bash
cd "$(openclaw config get extensionsDir)"
git clone https://github.com/BodaFu/openclaw-qq.git qq
```

### 2. Install dependencies

```bash
cd qq
pnpm install
```

### 3. Configure

Edit `openclaw.json` (usually at `~/.openclaw/openclaw.json`):

```jsonc
{
  "channels": {
    "qq": {
      "accounts": {
        "default": {
          "enabled": true,
          "botQQ": "123456789",
          "botName": "MyBot",
          "ownerQQ": "987654321",
          "ownerName": "YourName",
          "wsUrl": "ws://127.0.0.1:7900",
          "token": "your_ws_token",

          "dmPolicy": "open",
          "groupPolicy": "open",

          "passiveGate": {
            "enabled": true,
            "model": "qwen3.5-plus",
            "apiUrl": "https://your-api-endpoint/v1/chat/completions",
            "apiKey": "your_api_key",
            "debounceMs": 3000,
            "temperature": 0.3,
            "maxRecentMessages": 15
          },

          "store": {
            "mongoUri": "mongodb://127.0.0.1:27017",
            "dbName": "your_db_name",
            "tokenThreshold": 8000,
            "compactKeepRecent": 10,
            "compactModel": "qwen3.5-plus",
            "compactApiUrl": "https://your-api-endpoint/v1/chat/completions",
            "compactApiKey": "your_compact_api_key"
          }
        }
      }
    }
  }
}
```

### 4. Restart gateway

```bash
openclaw gateway restart
```

---

## Configuration Reference

### Account-level options

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable/disable this account |
| `botQQ` | `string` | — | Bot's QQ number (required) |
| `botName` | `string` | `"Bot"` | Bot display name |
| `ownerQQ` | `string` | `""` | Owner's QQ number (enables identity recognition and reporting) |
| `ownerName` | `string` | `""` | Owner's display name (used in agent prompts) |
| `wsUrl` | `string` | `"ws://127.0.0.1:7900"` | NapCat OneBot WebSocket URL |
| `token` | `string` | `""` | OneBot access token |
| `dmPolicy` | `string` | `"open"` | DM policy: `open`, `pairing`, `disabled` |
| `groupPolicy` | `string` | `"open"` | Group policy: `open`, `allowlist`, `disabled` |
| `groupAllowFrom` | `string[]` | `[]` | Allowed group IDs (when `allowlist`) |
| `allowFrom` | `string[]` | `[]` | Allowed user QQ numbers for DM |
| `requireMention` | `boolean` | `false` | Require @mention in groups |
| `historyLimit` | `number` | `25` | Max recent messages in agent context |
| `textChunkLimit` | `number` | `4000` | Max characters per text chunk |

### Passive gate options (`passiveGate`)

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable LLM passive gate |
| `model` | `string` | `"qwen3.5-plus"` | LLM model for gate decisions |
| `apiUrl` | `string` | — | OpenAI-compatible API endpoint |
| `apiKey` | `string` | `""` | API key |
| `debounceMs` | `number` | `3000` | Debounce window (ms) |
| `temperature` | `number` | `0.3` | LLM temperature |
| `maxRecentMessages` | `number` | `15` | Recent messages sent to gate LLM |

> The passive gate LLM config is also reused by the persona distillation module.

### Store options (`store`)

| Key | Type | Default | Description |
|---|---|---|---|
| `mongoUri` | `string` | `"mongodb://127.0.0.1:27017"` | MongoDB connection URI |
| `dbName` | `string` | `"openclaw_qq"` | Database name |
| `tokenThreshold` | `number` | `8000` | Token count triggering compaction |
| `compactKeepRecent` | `number` | `10` | Messages kept after compaction |
| `compactModel` | `string` | `"qwen3.5-plus"` | LLM model for summarization |
| `compactApiUrl` | `string` | — | API endpoint for compaction LLM |
| `compactApiKey` | `string` | `""` | API key (falls back to `passiveGate.apiKey`) |

---

## Per-User Persona System

### Architecture

```
User message → Load persona → Inject into agent context → Agent reply → Reply complete
                                                                            ↓
                                                                 Async persona distillation
                                                                            ↓
                                                                 Lightweight LLM analysis
                                                                            ↓
                                                                 Changed → Update MongoDB
                                                                 Unchanged → Skip
```

### How it works

1. **Persona injection**: On each message, the user's persona is loaded from MongoDB and injected into the agent's context
2. **Auto-distillation**: After the agent replies, a lightweight LLM asynchronously analyzes the conversation for persona change signals
3. **Persona isolation**: In group chats, each user's persona is independent

### Change signals detected

- Explicit requests: "be more tsundere", "call me senpai"
- Implicit preferences: correcting how the AI addresses them, complaining about tone
- Role settings: sending a complete character description
- Casual jokes or memes are not persisted

---

## Admin Panel

```
http://localhost:<gateway_port>/qq/admin
```

- View all groups the bot has joined
- Toggle individual groups on/off
- Set default policy for new groups

---

## NapCat Deployment (macOS)

### Install NapCat

1. Download from [NapCatQQ Releases](https://github.com/NapNeko/NapCatQQ/releases) or use [NapCat-Mac-Installer](https://github.com/NapNeko/NapCat-Mac-Installer)
2. QQ version: **6.9.86** or compatible
3. Install via Mac Installer DMG

### macOS sandbox workaround

```bash
/Applications/QQ.app/Contents/MacOS/QQ --no-sandbox -q YOUR_QQ_NUMBER
```

> `--no-sandbox` is required on macOS to avoid `EPERM` errors.

### Configure OneBot WebSocket

1. Open NapCat WebUI (`http://127.0.0.1:6099/webui`)
2. Go to **Network Config** → Add **WebSocket Server**
3. Set host `0.0.0.0`, port `7900`, access token, message format `array`
4. Save and restart NapCat

### Troubleshooting

| Issue | Solution |
|---|---|
| Worker process keeps exiting | Check QQ version compatibility; clear NapCat cache |
| `EPERM` permission errors | Use `--no-sandbox` flag |
| QR code login stuck | Delete `~/.config/NapCat/` and retry |
| WebSocket connection fails | Verify port and token match config |

---

## License

[MIT](./LICENSE)
