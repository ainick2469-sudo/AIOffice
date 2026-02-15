# AI Office

AI Office is a local multi-agent workspace that feels like a real staff room: agents debate, route work, run tools, create tasks, and respond in real time.

## Security Note

If any API key was ever pasted into chat, logs, screenshots, or commits, treat it as exposed. Rotate it immediately and replace `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in `C:\AI_WORKSPACE\ai-office\.env`.

## Stack

- Backend: Python 3.12, FastAPI, SQLite, WebSocket
- Frontend: React 19, Vite 7, ESLint 9
- Desktop: PyWebView + system tray (pystray, Pillow)
- AI backends: Ollama, Anthropic, OpenAI

## Team

17 staff members are currently supported.

- `router` (Router)
- `spark` (Creative Ideator)
- `architect` (System Architect)
- `builder` (Builder)
- `reviewer` (Reviewer/Security)
- `qa` (QA)
- `uiux` (UI/UX)
- `art` (Visual Design)
- `producer` (PM)
- `lore` (Narrative)
- `director` (Claude)
- `researcher` (Claude)
- `sage` (Scope Guardian)
- `codex` (OpenAI implementation overseer)
- `ops` (DevOps / Reliability)
- `scribe` (Technical Writer)
- `critic` (Formal Critic / Red Team)

Registry source of truth: `C:\AI_WORKSPACE\ai-office\agents\registry.json`

## Current Features

- Real-time multi-channel chat with WebSocket
- Agent-to-agent continuation loops with interrupt handling
- Thread replies, reactions, message grouping, and unread badges
- Structured collaboration commands: `/meeting`, `/vote`
- Task board with auto task-tag updates (`[TASK:start|done|blocked]`)
- Channel-scoped project workspaces with `/project` lifecycle commands
- Channel-scoped tool sandbox root for read/search/run/write
- File context injection before agent code generation
- Build/test/run command config (`.ai-office/config.json`) + auto-detect presets
- Post-write build/test/fix loop with deterministic Nova escalation
- `/work` autonomous background execution mode
- Web research tools (`[TOOL:web]`, `[TOOL:fetch]`) with provider fallback
- Git panel + `/git` and `/branch`/`/merge` commands
- Inline code execution for code blocks (`python`, `javascript`, `bash`)
- Conversation export to `docs/exports/` via `/export`
- Project templates (`react`, `python`, `rust`)
- Agent performance metrics and API usage/cost tracking
- Budget threshold and stop-warning behavior for hosted API backends
- Theme toggle (dark/light) and startup mode selector (web/desktop)
- App Builder control to launch full multi-agent app delivery runs
- Desktop app launcher with tray controls and standalone native window mode

## API Highlights

- `GET /api/agents`
- `PATCH /api/agents/{agent_id}`
- `POST /api/messages/{message_id}/reactions`
- `GET /api/messages/{message_id}/reactions`
- `GET /api/claude/status`
- `GET /api/ollama/status`
- `GET /api/openai/status`
- `POST /api/app-builder/start`
- `GET /api/ollama/models/recommendations`
- `POST /api/ollama/models/pull`
- `GET /api/messages/{channel}`
- `GET /api/messages/search`
- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/{task_id}/status`
- `POST /api/files/upload`
- `GET /api/files/tree`
- `GET /api/files/read`
- `POST /api/projects`
- `GET /api/projects`
- `POST /api/projects/switch`
- `GET /api/projects/active/{channel}`
- `DELETE /api/projects/{name}`
- `GET /api/projects/{name}/build-config`
- `PUT /api/projects/{name}/build-config`
- `POST /api/projects/{name}/build`
- `POST /api/projects/{name}/test`
- `POST /api/projects/{name}/run`
- `GET /api/projects/{name}/git/status`
- `GET /api/projects/{name}/git/log`
- `GET /api/projects/{name}/git/diff`
- `POST /api/projects/{name}/git/commit`
- `POST /api/projects/{name}/git/branch`
- `POST /api/projects/{name}/git/merge`
- `POST /api/work/start`
- `POST /api/work/stop`
- `GET /api/work/status/{channel}`
- `POST /api/tools/web`
- `POST /api/tools/fetch`
- `POST /api/execute`
- `GET /api/performance/agents`
- `GET /api/usage`
- `GET /api/usage/summary`
- `GET /api/usage/budget`
- `PUT /api/usage/budget`

## Windows Reproducible Commands

Run these from `C:\AI_WORKSPACE\ai-office`.

1. Install backend deps

```bat
C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe -m pip install -r requirements.txt
```

2. Frontend checks (PATH-safe wrappers)

```bat
cd /d C:\AI_WORKSPACE\ai-office\client
dev-build.cmd
dev-lint.cmd
```

3. Start app (PATH-safe launcher with mode selector)

```bat
cd /d C:\AI_WORKSPACE\ai-office
C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe start.py --mode web
```

4. Desktop mode

```bat
cd /d C:\AI_WORKSPACE\ai-office
C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe start.py --mode desktop
```

Or double-click:

```bat
C:\AI_WORKSPACE\ai-office\desktop-launch.cmd
```

Desktop mode requires `pywebview` and runs as a standalone native window (not browser fallback).

## Full App Build Workflow

Use the Controls tab and start **App Builder** with:
- app name
- build goal
- stack profile
- target directory

The backend endpoint is `POST /api/app-builder/start`. It seeds delivery tasks, posts a structured kickoff message, and starts the multi-agent build loop in chat.

For command execution in subdirectories, agents can use:

```text
[TOOL:run] @client npm run build
```

## Key Management Helpers

- Set/replace OpenAI key:

```bat
C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe tools\set_openai_key.py sk-...
```

- Clear OpenAI key:

```bat
C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe tools\set_openai_key.py --clear
```

- Check config (masked output):

```bat
C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe tools\check_openai_config.py
```
