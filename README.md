# AI Office

AI Office is a local multi-agent workspace that feels like a real staff room: agents debate, route work, run tools, create tasks, and respond in real time.

## Security Note

If any API key was ever pasted into chat, logs, screenshots, or commits, treat it as exposed. Rotate it immediately and replace `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in `.env`.

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

Registry source of truth: `agents/registry.json`

## Current Features

- Real-time multi-channel chat with WebSocket
- Agent-to-agent continuation loops with interrupt handling
- Thread replies, reactions, message grouping, and unread badges
- Structured collaboration commands: `/meeting`, `/vote`
- Task board with auto task-tag updates (`[TASK:start|done|blocked]`)
- Branch-aware task assignment/filtering per channel/project context
- Channel-scoped project workspaces with `/project` lifecycle commands
- Channel-scoped tool sandbox root for read/search/run/write
- File context injection before agent code generation
- Build/test/run command config (`.ai-office/config.json`) + auto-detect presets
- Post-write build/test/fix loop with deterministic Nova escalation
- `/work` autonomous background execution mode
- Project autonomy modes (`SAFE`, `TRUSTED`, `ELEVATED`) with kill switch reset
- Channel process manager (start/stop/list) for project services
- Console events panel for router/tool/verification observability
- Web research tools (`[TOOL:web]`, `[TOOL:fetch]`) with provider fallback
- Git panel + `/git` and `/branch`/`/merge` commands with merge preview/apply conflict surfacing
- Inline code execution for code blocks (`python`, `javascript`, `bash`)
- Conversation export to `docs/exports/` via `/export`
- Project templates (`react`, `python`, `rust`)
- Agent performance metrics and API usage/cost tracking
- Budget threshold and stop-warning behavior for hosted API backends
- Theme toggle (dark/light) with desktop-first launcher and dedicated dev launcher (`dev.py`)
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
- `DELETE /api/channels/{channel_id}/messages`
- `GET /api/messages/search`
- `GET /api/tasks`
- `POST /api/tasks`
- `GET /api/tasks?branch=<name>`
- `PATCH /api/tasks/{task_id}/status`
- `POST /api/files/upload`
- `GET /api/files/tree`
- `GET /api/files/read`
- `POST /api/projects`
- `GET /api/projects`
- `POST /api/projects/switch`
- `GET /api/projects/active/{channel}`
- `GET /api/projects/{name}/branches`
- `POST /api/projects/{name}/branches/switch`
- `POST /api/projects/{name}/merge-preview`
- `POST /api/projects/{name}/merge-apply`
- `GET /api/projects/{name}/autonomy-mode`
- `PUT /api/projects/{name}/autonomy-mode`
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
- `POST /api/process/start`
- `POST /api/process/stop`
- `GET /api/process/list/{channel}`
- `POST /api/process/kill-switch`
- `GET /api/console/events/{channel}`
- `GET /api/audit`
- `GET /api/audit/count`
- `DELETE /api/audit/logs`
- `DELETE /api/audit/decisions`
- `DELETE /api/audit/all`
- `POST /api/tools/web`
- `POST /api/tools/fetch`
- `POST /api/tools/create-skill`
- `POST /api/skills/reload`
- `POST /api/execute`
- `GET /api/performance/agents`
- `GET /api/usage`
- `GET /api/usage/summary`
- `GET /api/usage/budget`
- `PUT /api/usage/budget`

## Windows Reproducible Commands

Run these from the repository root.

1. One-command setup (recommended)

```bat
scripts\dev_setup.cmd
```

Or PowerShell:

```powershell
.\scripts\dev_setup.ps1
```

2. Install backend deps manually

```bat
python -m pip install -r requirements.txt
```

3. Frontend checks (PATH-safe wrappers)

```bat
cd /d client
dev-build.cmd
dev-lint.cmd
```

4. Start app (desktop-first launcher)

```bat
python start.py
```

5. Dev web mode (backend + Vite)

```bat
python dev.py
```

Or double-click:

```bat
desktop-launch.cmd
```

Desktop mode requires `pywebview` and runs as a standalone native window (not browser fallback).

6. Build standalone Windows `.exe`

```bat
build-desktop.cmd
```

Output:

```text
dist\AI Office\AI Office.exe
```

## Runtime Data Paths

Runtime state now uses platform-default user data storage plus env overrides:

- `AI_OFFICE_HOME` (base runtime directory)
- `AI_OFFICE_DB_PATH` (SQLite DB location)
- `AI_OFFICE_MEMORY_DIR` (memory JSONL directory)
- `AI_OFFICE_WORKSPACE_ROOT` (workspace root for projects/channels)
- `AI_OFFICE_PROJECTS_DIR` (legacy alias, still supported)

Default on Windows: `%LOCALAPPDATA%\AIOffice`.

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
python tools\set_openai_key.py sk-...
```

- Clear OpenAI key:

```bat
python tools\set_openai_key.py --clear
```

- Check config (masked output):

```bat
python tools\check_openai_config.py
```
