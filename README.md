# 🏢 AI Office

A multi-agent AI team workspace where autonomous agents collaborate, debate, and build projects together. Think Slack meets an AI dev team.

## What Is This?

AI Office is a desktop application that simulates a full software development team powered by AI agents. Each agent has a distinct personality, role, and expertise. They don't just answer your questions — they talk to each other, disagree, build on ideas, use tools, and actually write code.

## The Team (12 Agents)

| Agent | Role | Backend | Personality |
|-------|------|---------|-------------|
| 💡 Spark | Creative Ideator | Ollama | Wild ideas, blue-sky thinking |
| 🏗️ Ada | System Architect | Ollama | Structure, scalability, design patterns |
| 🔨 Max | Builder / Programmer | Ollama | Writes code, debugs, implements |
| 🔍 Rex | Code Reviewer / Security | Ollama | Finds flaws, security issues |
| 🧪 Quinn | QA / Testing | Ollama | Edge cases, testing, quality |
| 🎨 Uma | UI/UX Designer | Ollama | User experience, interface design |
| 🖼️ Iris | Art / Visual Design | Ollama | Colors, typography, visual style |
| 📋 Pam | Producer / Project Manager | Ollama | Coordination, timelines, priorities |
| 📖 Leo | Lore / Narrative | Ollama | Storytelling, creative writing |
| ⭐ Nova | Director / Tech Lead | Claude | Big decisions, strategy, leadership |
| 🔭 Scout | Deep Researcher | Claude | Research, best practices, documentation |
| 🤖 Router | Message Classifier | Ollama | Routes messages to the right agents |

## Features

### Chat System
- **Living conversations** — agents respond to you AND to each other
- **Multi-agent discussions** — 2-4+ agents per conversation
- **Tool execution** — agents can read files, run commands, search code
- **Markdown rendering** with syntax-highlighted code blocks

### Project Management
- **Task Board** — Kanban board (Backlog → In Progress → Review → Done)
- **Decision Log** — tracks all team decisions
- **Audit Log** — every tool use is logged

### Workspace
- **File Viewer** — browse and read project files with syntax highlighting
- **Message Search** — search across all channels
- **Agent Profiles** — click any agent to see stats, memories, recent activity

### Desktop App
- **One-click launch** — double-click shortcut to start everything
- **Close to stop** — closing the window stops all services
- **No terminal needed** — runs as a native desktop window

## Tech Stack

- **Backend**: Python, FastAPI, SQLite, WebSockets
- **Frontend**: React, Vite, react-markdown, react-syntax-highlighter
- **AI**: Ollama (local models) + Anthropic Claude API (premium agents)
- **Desktop**: PyWebView
- **Local Models**: qwen2.5:14b (via Ollama)

## Quick Start

### Prerequisites
- Python 3.12+
- Node.js 18+
- Ollama with `qwen2.5:14b` and `qwen3:1.7b` models
- (Optional) Anthropic API key for Nova and Scout

### Install
```bash
# Clone
git clone https://github.com/ainick2469-sudo/AIOffice.git
cd AIOffice

# Backend dependencies
pip install fastapi uvicorn aiosqlite httpx webview

# Frontend dependencies
cd client && npm install && cd ..

# Build frontend
cd client && npx vite build && cd ..

# Configure (optional — for Claude-powered agents)
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### Run
```bash
# Desktop app (recommended)
python app.py

# Or use the desktop shortcut after first run
```

### Development Mode
```bash
# Terminal 1: Backend
python run.py

# Terminal 2: Frontend (with hot reload)
cd client && npx vite
```

## Architecture

```
ai-office/
├── app.py                  # Desktop app launcher
├── run.py                  # Dev server launcher
├── server/
│   ├── main.py             # FastAPI app + WebSocket
│   ├── agent_engine.py     # Conversation loop + agent orchestration
│   ├── router_agent.py     # Message routing to agents
│   ├── claude_client.py    # Anthropic API client
│   ├── claude_adapter.py   # Claude → Ollama interface adapter
│   ├── ollama_client.py    # Ollama API client
│   ├── tool_executor.py    # Parse + execute tool calls from agents
│   ├── tool_gateway.py     # Sandboxed file/command tools
│   ├── database.py         # SQLite operations
│   ├── memory.py           # JSONL memory system
│   ├── distiller.py        # Extract facts from conversations
│   ├── websocket.py        # WebSocket connection manager
│   ├── routes_api.py       # REST API endpoints
│   └── models.py           # Pydantic models
├── agents/
│   └── registry.json       # Agent definitions + system prompts
├── client/
│   ├── src/
│   │   ├── App.jsx         # Main app with panel tabs
│   │   ├── components/
│   │   │   ├── ChatRoom.jsx
│   │   │   ├── MessageContent.jsx
│   │   │   ├── TaskBoard.jsx
│   │   │   ├── FileViewer.jsx
│   │   │   ├── SearchPanel.jsx
│   │   │   ├── DecisionLog.jsx
│   │   │   ├── AgentProfile.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   ├── AuditLog.jsx
│   │   │   └── Controls.jsx
│   │   ├── hooks/
│   │   │   └── useWebSocket.js
│   │   └── api.js
│   └── package.json
└── data/                   # SQLite DB + JSONL memories (gitignored)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Health check |
| GET | /api/agents | List all agents |
| GET | /api/channels | List channels |
| GET | /api/messages/{channel} | Get messages |
| GET | /api/messages/search?q= | Search messages |
| GET | /api/tasks | Get tasks |
| POST | /api/tasks | Create task |
| PATCH | /api/tasks/{id}/status | Update task status |
| GET | /api/decisions | Get decision log |
| GET | /api/agents/{id}/profile | Agent profile + stats |
| GET | /api/files/tree | Browse project files |
| GET | /api/files/read | Read file content |
| GET | /api/audit | Audit log |
| GET | /api/claude/status | Claude API status |
| WS | /ws/{channel} | WebSocket for real-time chat |

## License

MIT
