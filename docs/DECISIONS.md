# AI OFFICE — Decisions Log

> Locked decisions only. Once recorded here, these are canonical.

## D001: Tech Stack
- **Backend**: Python 3.13, FastAPI, WebSockets, SQLite
- **Frontend**: React + Vite
- **AI**: Ollama (local), Claude (optional cloud)
- **Decided**: 2026-02-14
- **Rationale**: FastAPI is fast + async; SQLite is zero-config; React is standard

## D002: Model Assignment
- **Router**: qwen3:1.7b (fast, cheap for classification)
- **Builder**: qwen2.5-coder:32b (specialized code model)
- **All other agents**: qwen2.5:14b (good general reasoning)
- **Fallback**: qwen2.5:32b (for complex tasks if needed)
- **Decided**: 2026-02-14
- **Rationale**: Use best model per role. Tiny router for speed, coder for code.

## D003: Workspace Sandbox
- All file operations restricted to `C:\AI_WORKSPACE\ai-office`
- No exceptions without explicit user approval in chat
- **Decided**: 2026-02-14
