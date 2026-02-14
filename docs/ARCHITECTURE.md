# AI OFFICE — Architecture

## Module Map

### `/server/` — FastAPI Backend
- `main.py` — App entry, CORS, lifespan, mount routes
- `database.py` — SQLite setup, table creation, query helpers
- `models.py` — Pydantic models for messages, tasks, decisions, agents
- `websocket.py` — WebSocket manager for real-time chat
- `routes_api.py` — REST endpoints (agents, tasks, decisions, audit)
- `agent_engine.py` — Agent orchestration (route → select → generate → respond)
- `router_agent.py` — Fast message classification via qwen3:1.7b
- `ollama_client.py` — HTTP client for Ollama API
- `memory.py` — Memory read/write/distill operations
- `tool_gateway.py` — Tool execution with allow-list, audit, approval
- `pulse.py` — Office Pulse scheduler (timed checks)
- `release_gate.py` — Multi-agent release review pipeline

### `/client/` — React/Vite Frontend
- `src/App.jsx` — Main layout with sidebar + panels
- `src/components/ChatRoom.jsx` — Main room group chat
- `src/components/DirectMessage.jsx` — DM channels
- `src/components/TaskBoard.jsx` — Backlog/In-progress/Done
- `src/components/AuditLog.jsx` — Tool call viewer
- `src/components/ProjectState.jsx` — Live project state
- `src/components/AgentAvatar.jsx` — Agent identity display
- `src/hooks/useWebSocket.js` — WS connection hook
- `src/api.js` — REST API client

### `/agents/` — Agent Configuration
- `registry.json` — Agent definitions (id, name, role, model, permissions)

### `/memory/` — Persistent Memory
- `shared_memory.jsonl` — Shared project facts
- `agents/<agent_id>.jsonl` — Per-agent private memory

### `/tools/` — Tool Gateway Config
- `allowlist.json` — Allowed commands and file patterns
- `gateway.py` — (Symlink/import from server; config lives here)

### `/tests/` — Test Suite
- `test_api.py` — API endpoint tests
- `test_routing.py` — Router classification tests
- `test_memory.py` — Memory read/write tests
- `test_gateway.py` — Tool gateway permission tests

### `/docs/` — Documentation
- `PROJECT_STATE.md` — Canonical project state (always current)
- `DECISIONS.md` — Locked decisions
- `ARCHITECTURE.md` — This file
- `STYLE_GUIDE.md` — UI/art rules
- `SECURITY.md` — Permissions + threat model

## Database Schema (SQLite)

```sql
-- Messages in channels (main room + DMs)
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,        -- 'main' or 'dm:<agent_id>'
    sender TEXT NOT NULL,         -- 'user' or agent_id
    content TEXT NOT NULL,
    msg_type TEXT DEFAULT 'message', -- message|task|decision|tool_request|tool_result|review
    parent_id INTEGER,           -- for threading
    pinned BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Task board
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'backlog', -- backlog|in_progress|done
    assigned_to TEXT,             -- agent_id
    created_by TEXT,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Locked decisions
CREATE TABLE decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    decided_by TEXT,
    rationale TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tool call audit log
CREATE TABLE tool_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    tool_type TEXT NOT NULL,      -- read|run|write
    command TEXT NOT NULL,
    args TEXT,                    -- JSON
    output TEXT,
    exit_code INTEGER,
    approved_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agent registry (mirrors JSON but queryable)
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    skills TEXT,                  -- JSON array
    backend TEXT DEFAULT 'ollama',
    model TEXT NOT NULL,
    permissions TEXT DEFAULT 'read', -- read|run|write
    active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
