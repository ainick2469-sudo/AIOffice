# AI OFFICE — Project State (Canonical)

> Last updated: 2026-02-14 (All 5 phases complete)

## Current Phase: ALL PHASES COMPLETE
## Status: MVP FUNCTIONAL

## Environment
- Python 3.12.10 ✅ | Node.js v25.2.1 ✅ | Ollama ✅
- Models: qwen3:1.7b, qwen2.5:14b, qwen2.5-coder:32b, qwen2.5:32b

## Completed
- [x] Phase 1: Backend + Frontend
  - FastAPI + SQLite + WebSocket backend
  - React/Vite dark-themed chat UI
  - Main room + DM channels
  - Message persistence + auto-reconnect
- [x] Phase 2: Agent Routing + Ollama Responses
  - Router: qwen3:1.7b LLM + keyword fallback
  - 9 agents with distinct roles/voices
  - Concurrent responses, typing indicators
  - DM auto-routing, main room multi-agent
- [x] Phase 3: Memory System
  - JSONL shared + per-agent memory
  - Distiller extracts facts every 5 messages
  - Memory injected into agent system prompts
- [x] Phase 4: Tool Gateway
  - Sandboxed read/search/run/write tools
  - Allowlist + blocklist + path sandboxing
  - Write requires diff preview + approval
  - Full audit logging to SQLite
  - Audit Log panel in frontend
- [x] Phase 5: Release Gate + Pulse
  - Multi-agent review pipeline (6 roles)
  - Improvement sweeps (2 passes)
  - Producer final sign-off
  - Office Pulse scheduler (configurable)
  - Controls panel in frontend

## Server Files (19 routes)
- /api/health, /api/agents, /api/agents/{id}
- /api/messages/{channel}, /api/channels
- /api/tasks (GET + POST)
- /api/memory/shared, /api/memory/{agent_id}
- /api/audit
- /api/tools/read, /api/tools/search, /api/tools/run, /api/tools/write
- /api/release-gate (POST), /api/release-gate/history
- /api/pulse/start, /api/pulse/stop, /api/pulse/status

## How to Run
```
cd C:\AI_WORKSPACE\ai-office
python start.py
```

## Known Issues
- Clear __pycache__ if routes 404 after edits
- Stale pycache from auto-reloader can hide new routes

## Remaining (Nice-to-Have)
- [ ] Desktop app wrapper (Electron/PyWebView)
- [ ] Startup mode selector (web vs desktop)
- [ ] Task board panel in frontend
- [ ] Project State viewer panel
