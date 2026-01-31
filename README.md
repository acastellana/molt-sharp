# Sharp 🎯

**A unified multi-agent dashboard for AI assistants**

Sharp is a sleek, mobile-responsive web dashboard for managing multiple AI agent sessions. Built as part of the [Clawdbot](https://github.com/clawdbot) ecosystem, it provides a unified interface for chatting with agents, embedding apps, and monitoring background tasks.

## Features

- **📱 Sessions Sidebar** — View and switch between sessions with search and filters
- **🔍 Smart Filters** — Filter by channel (Telegram, Discord, etc.) and status (Running, Unread, Error)
- **💬 Chat Interface** — Streaming responses, tool activity, message queue
- **📲 Mobile-Responsive** — Works on phones, tablets, and desktops
- **🌙 Dark Theme** — GitHub-inspired dark color scheme
- **⚡ Real-time Updates** — WebSocket-based with live status
- **🤖 Auto Titles** — AI-generated session titles via OpenAI
- **📦 Session Management** — Pin, archive, rename, auto-archive

## Quick Start

Sharp is a static HTML/JS application. Serve it with any web server:

```bash
# Python
python3 -m http.server 9000

# Node.js
npx serve -p 9000

# Caddy (recommended for production)
caddy file-server --listen :9000
```

Then open `http://localhost:9000`

## Configuration

Copy `config.example.json` to `config.json`:

```json
{
  "gatewayWsUrl": "wss://your-gateway/ws",
  "gatewayHttpUrl": "https://your-gateway"
}
```

## Project Structure

```
sharp/
├── index.html           # Main dashboard (all-in-one)
├── app.html             # App viewer with assistant panel
├── styles/main.css      # Extracted CSS
├── lib/config.js        # Configuration loader
├── .registry/apps.json  # App registry (gitignored)
├── docs/                # Documentation
├── specs/               # Feature specifications
└── tests/               # Vitest tests
```

## Backend API

Sharp connects via WebSocket to a Clawdbot gateway. Required methods:

| Method | Description |
|--------|-------------|
| `connect` | Authenticate session |
| `chat.send` | Send message to agent |
| `chat.history` | Get message history |
| `chat.abort` | Cancel running agent |
| `sessions.list` | List sessions |

See [Backend API Documentation](docs/BACKEND-API.md).

## Testing

```bash
npm install
npm test              # Run tests
npm run test:watch    # Watch mode
```

## Development

No build step. Edit `index.html` and refresh.

## License

[MIT](LICENSE) © 2024-2025 Albert Castellana
