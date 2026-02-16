# AI OFFICE — Development Log
# Complete changelog from project inception to current state
# Last updated: 2026-02-15

---

## SESSION 7 - Hardening + Agent Config (2026-02-15)

### Security and Key Hygiene
- [x] Added explicit key-rotation warning in docs.
- [x] Added `tools/set_openai_key.py --clear` mode to remove OpenAI key from `.env`.
- [x] Updated OpenAI config checker to use masked, live key detection.

### Runtime and Launch Repro
- [x] Added root runtime wrapper: `with-runtime.cmd` (prepends Windows/Python/Node paths).
- [x] Updated `start.py` to avoid PATH-fragile `npx vite` launch.
- [x] Updated `app.py` build path to use `client/dev-build.cmd` instead of raw `npx vite build`.

### Frontend Lint Refactor (react-hooks/set-state-in-effect)
- [x] Refactored:
  - `client/src/components/AgentProfile.jsx`
  - `client/src/components/AuditLog.jsx`
  - `client/src/components/FileViewer.jsx`
  - `client/src/components/Sidebar.jsx`
  - `client/src/hooks/useWebSocket.js`
- [x] Removed unused `node` arg in `client/src/components/MessageContent.jsx`.

### Codex as First-Class Staff
- [x] Added `codex` to `agents/registry.json` as canonical source.
- [x] Kept DB fallback seeding for backward compatibility.
- [x] Preserved router/engine Codex routing and OpenAI backend support.

### Agent Config Feature Delivery
- [x] Added backend update API: `PATCH /api/agents/{agent_id}`.
- [x] Added DB update path for editable fields:
  - `display_name`, `role`, `backend`, `model`, `permissions`, `active`, `color`, `emoji`, `system_prompt`.
- [x] Enforced backend enum (`ollama`, `claude`, `openai`) via pydantic request model.
- [x] Added new frontend panel: `client/src/components/AgentConfig.jsx`.
- [x] Wired panel into tabs in `client/src/App.jsx`.
- [x] Added live refresh signaling so sidebar staff view updates without page reload.

---

## SESSION 8 - Launch + Toolchain Reliability (2026-02-15)

### Standalone Desktop Behavior
- [x] Added `pywebview` dependency declaration in `requirements.txt`.
- [x] Removed browser fallback from `app.py`; desktop mode now fails fast if pywebview is missing.
- [x] Added `desktop-launch.cmd` for double-click standalone launch.
- [x] Added smoke validation for desktop launch path: `tools/desktop_smoke.py`.

### Tool Call and Tool Creation Reliability
- [x] Fixed tool run PATH inheritance in `server/tool_gateway.py` so `python`/`npm` commands work reliably.
- [x] Added end-to-end toolchain smoke test:
  - `tools/toolchain_smoke.py` verifies read/search/run/write/task.
  - Includes generated tool-file creation and cleanup.
- [x] Added runtime/startup smoke scripts:
  - `tools/runtime_smoke.py`
  - `tools/startup_smoke.py`

---

## PROJECT OVERVIEW
- **Name:** AI Office
- **Location:** C:\AI_WORKSPACE\ai-office
- **GitHub:** https://github.com/ainick2469-sudo/AIOffice.git
- **Stack:** FastAPI + SQLite + WebSocket (backend), React/Vite (frontend), PyWebView (desktop), Ollama + Claude API (AI)
- **Models:** qwen3:1.7b (router), qwen2.5:14b (most agents), qwen2.5-coder:32b (Max), Claude Sonnet (Nova, Scout)

---

## PHASE 1 — Foundation (Session 1)
**Date:** 2026-02-14 ~11:00 AM
**Commit:** Part of initial commit

### Backend
- [x] FastAPI server with uvicorn (server/main.py)
- [x] SQLite database via aiosqlite (server/database.py)
- [x] Schema: messages, tasks, decisions, tool_logs, agents tables
- [x] WebSocket manager for real-time broadcast (server/websocket.py)
- [x] REST API endpoints: /api/health, /api/agents, /api/messages/{channel}, /api/channels
- [x] Message persistence (insert, query, pagination)
- [x] Agent registry loaded from agents/registry.json into DB on startup

### Frontend
- [x] React + Vite project scaffolded (client/)
- [x] Dark theme CSS (Discord-inspired color scheme)
- [x] Sidebar component: channels list, DM list, staff roster with roles/colors
- [x] ChatRoom component: message list, input box, send button
- [x] Main Room + DM channels (dm:<agent_id>)
- [x] WebSocket hook (useWebSocket.js) with auto-reconnect
- [x] Message history loaded on channel switch
- [x] Auto-scroll to bottom on new messages

### Initial Agents (9)
| ID | Name | Role | Model |
|----|------|------|-------|
| router | Router | Message classifier | qwen3:1.7b |
| architect | Ada | System Architect | qwen2.5:14b |
| builder | Max | Builder / Programmer | qwen2.5-coder:32b |
| reviewer | Rex | Code Reviewer / Security | qwen2.5:14b |
| qa | Quinn | QA / Testing | qwen2.5:14b |
| uiux | Uma | UI/UX Designer | qwen2.5:14b |
| art | Iris | Art / Visual Design | qwen2.5:14b |
| producer | Pam | Producer / Project Manager | qwen2.5:14b |
| lore | Leo | Lore / Narrative | qwen2.5:14b |

### Launchers
- [x] start.py — single-command launcher (starts backend + frontend)
- [x] run.py — alternative launcher
- [x] AI Office.bat — batch file shortcut

### Docs Created
- docs/SYSTEM_OVERVIEW.md — full architecture diagram + data flow
- docs/ARCHITECTURE.md — technical architecture details
- docs/DECISIONS.md — locked architectural decisions
- docs/MVP_MILESTONES.md — phase milestones
- docs/SECURITY.md — safety model + sandbox rules
- docs/STYLE_GUIDE.md — code style conventions
- docs/PROJECT_STATE.md — canonical project status

---

## PHASE 2 — Agent Routing + Ollama Responses (Session 1)
**Date:** 2026-02-14 ~12:00 PM

- [x] Router agent (server/router_agent.py): LLM-based classification via qwen3:1.7b
- [x] Keyword fallback routing when LLM fails or returns invalid JSON
- [x] Ollama client (server/ollama_client.py): HTTP calls to localhost:11434
- [x] Agent engine v1 (server/agent_engine.py): route → generate → broadcast
- [x] Concurrent agent responses (asyncio.gather for multiple agents)
- [x] Typing indicators ("X is thinking..." broadcast via WebSocket)
- [x] DM auto-routing: dm:<agent_id> channels respond with just that agent
- [x] Main room multi-agent: router selects 2-4 agents per message
- [x] System prompts per agent with role-specific instructions
- [x] Context window: last 10 messages included in each generation

---

## PHASE 3 — Memory System (Session 1)
**Date:** 2026-02-14 ~1:00 PM

- [x] JSONL-based memory storage (memory/ directory)
- [x] Shared memory file (memory/shared_memory.jsonl) — project-wide facts
- [x] Per-agent memory files (memory/agents/<agent_id>.jsonl)
- [x] Memory module (server/memory.py): read/write/query memories
- [x] Distiller (server/distiller.py): extracts durable facts after every 5 messages
- [x] Memory injection: agent system prompts include relevant memories
- [x] Memory viewer in agent profiles (scrollable)

---

## PHASE 4 — Tool Gateway (Session 1-2)
**Date:** 2026-02-14 ~2:00 PM

- [x] Tool gateway (server/tool_gateway.py): sandboxed file/command execution
- [x] READ tools: read file contents within sandbox
- [x] SEARCH tools: grep/find within project directory
- [x] RUN tools: execute commands with allowlist validation
- [x] WRITE tools: create/modify files with diff preview + approval flow
- [x] Allowlist (tools/allowlist.json): permitted commands
- [x] Path sandboxing: all operations restricted to C:\AI_WORKSPACE\ai-office
- [x] Audit logging: every tool call logged to SQLite (who/when/what/output)
- [x] Audit Log panel in frontend (AuditLog.jsx)
- [x] REST endpoints: /api/tools/read, /api/tools/search, /api/tools/run, /api/tools/write
- [x] Tool executor (server/tool_executor.py): parses [TOOL:read/run/search/write] from agent messages

---

## PHASE 5 — Release Gate + Office Pulse (Session 2)
**Date:** 2026-02-14 ~3:00 PM

- [x] Release gate (server/release_gate.py): multi-agent review pipeline
  - 6 review roles: architecture, code quality, security, testing, UX, overall
  - 2 improvement sweep passes
  - Producer final sign-off
- [x] Office Pulse scheduler (server/pulse.py): timed agent check-ins
  - Configurable intervals
  - Max 1 message per agent per pulse (no infinite loops)
  - Start/stop/status API endpoints
- [x] Controls panel in frontend (Controls.jsx): pulse start/stop, config
- [x] REST endpoints: /api/release-gate, /api/release-gate/history, /api/pulse/start, /api/pulse/stop, /api/pulse/status

---

## SESSION 3 — Agent-to-Agent Conversation + UI Overhaul (Session 3)
**Date:** 2026-02-14 ~5:00 PM
**Key change:** Agents now talk to EACH OTHER, not just respond to user

### Agent-to-Agent Conversation Engine
- [x] Agent engine v2 rewrite: living conversation loop
- [x] After agents respond to user, others react to what was said
- [x] Follow-up rounds: agents build on each other's messages
- [x] Hard cap: 1000 messages max per conversation
- [x] User can jump in anytime — agents pivot to respond
- [x] Stop button: force-end conversation via API
- [x] Conversation status tracking: active/message_count/max_messages
- [x] REST endpoints: /api/conversation/{channel}, /api/conversation/{channel}/stop
- [x] Frontend: "💬 Active (X msgs)" badge + ⏹ Stop button in chat header

### New Agent: Spark (💡 Creative Ideator)
- [x] Added to registry: brainstorming, wild ideas, riffs off others
- [x] Router updated: brainstorming → Spark + others

### Conversation Loop Fixes
- [x] Router fixed: now always picks 2-4 agents (was sending everything to just Pam)
- [x] Message format fixed: agents no longer prefix with [producer]: or similar
- [x] Self-prefixing cleanup: strips "[agent_id]: " and "Name: " prefixes
- [x] PASS handling: agents return None for PASS/[PASS] responses
- [x] Conversation continuation: _invites_response() detects questions/mentions
- [x] _pick_next(): selects follow-up agents based on last message content
- [x] _mentions(): detects when agents reference each other by name

### Markdown Rendering
- [x] MessageContent.jsx component with react-markdown + react-syntax-highlighter
- [x] Syntax-highlighted code blocks (remark-gfm for GitHub-flavored markdown)
- [x] npm packages: react-markdown, react-syntax-highlighter, remark-gfm

### CSS Fixes
- [x] Message list overflow-y scroll fix
- [x] min-height: 0 on flex children for proper scrolling
- [x] Code block styling (dark theme, copy-friendly)

---

## SESSION 4 — Desktop App + Task Board + File Viewer + Claude API (Session 4)
**Date:** 2026-02-14 ~7:00 PM

### Desktop App
- [x] app.py: PyWebView wrapper (opens browser window pointing to localhost)
- [x] Single-process launch: starts backend + frontend + opens window
- [x] client-dist/ for production builds

### Task Board
- [x] TaskBoard.jsx: Kanban board with 4 columns (Backlog → In Progress → Review → Done)
- [x] Create task form in UI
- [x] Click to move tasks between columns
- [x] REST endpoint: PATCH /api/tasks/{id}/status
- [x] Task board CSS: column layout, cards, priority indicators

### File Viewer
- [x] FileViewer.jsx: browse project files, click to view with syntax highlighting
- [x] Directory navigation with back button and path breadcrumbs
- [x] File icons by extension (🐍 .py, 📜 .js, ⚛️ .jsx, etc.)
- [x] File size display
- [x] REST endpoints: /api/files/tree, /api/files/read
- [x] File viewer CSS: split pane (tree + preview)

### Claude API Integration
- [x] claude_client.py: Anthropic API client (auth, message formatting, alternating roles)
- [x] claude_adapter.py: wraps claude_client to match ollama_client interface
- [x] .env file with ANTHROPIC_API_KEY
- [x] .env.example template
- [x] Engine routes to Claude when agent backend="claude"
- [x] REST endpoint: /api/claude/status

### New Agents: Nova + Scout
| ID | Name | Role | Backend |
|----|------|------|---------|
| director | Nova (🧠) | Director / Tech Lead | Claude API |
| researcher | Scout (🔭) | Deep Researcher | Claude API |

- [x] Added to registry with Claude backend
- [x] Router updated with director/researcher keywords + system prompt

### Frontend Tab System
- [x] App.jsx: 5 tabs — Chat, Tasks, Files, Audit, Controls
- [x] All components wired and rendering

---

## SESSION 5 — Personality Overhaul + Memory Wipe + Sage + GitHub (Session 5)
**Date:** 2026-02-14 ~9:30 PM
**Commit:** 1495283 "Initial commit: AI Office v0.2"

### GitHub
- [x] Git initialized, .gitignore configured
- [x] Initial commit: 67 files, 10,039 lines
- [x] Pushed to https://github.com/ainick2469-sudo/AIOffice.git

### New Agent: Sage (🌿 Scope Guardian)
- [x] Added to registry: sees big picture, calls out scope creep
- [x] Personality: "You see the forest when everyone else is staring at trees"
- [x] Added to engine ALL_AGENT_IDS + AGENT_NAMES
- [x] Added to router VALID_IDS
- [x] Added to router system prompt + keyword map (scope, focus, priority, shipping, etc.)
- [x] Memory file created: memory/agents/sage.jsonl

### Deep Personality Rewrite (All 13 Agents)
- [x] Every agent got a SPECIFIC communication style, not just role description
- [x] Rex: skeptical by default, finds problems, dry sarcasm
- [x] Quinn: methodical skeptic, "what if this breaks?"
- [x] Spark: chaotic creative, wild ideas that might be terrible
- [x] Ada: methodical, slows things down to think properly
- [x] Pam: pragmatic, cuts through nonsense, focuses on shipping
- [x] Nova: makes hard calls, decides when team can't agree
- [x] Sage: wise realist, "Do we actually need this?"
- [x] Anti-sycophancy rules: no more "fantastic suggestion!" — real debate, real friction
- [x] DISAGREE instructions: each agent told HOW to disagree (directly, with data, etc.)

### Memory Wipe
- [x] All stale/hallucinated memories cleared (old AR app references)
- [x] Database wiped: fresh start, no "Echo" conversations
- [x] Memory files reset to 0-1 lines each

### Channel Auto-Naming
- [x] Channels auto-rename based on conversation topic
- [x] Uses Ollama to summarize first few messages into a short topic title
- [x] Broadcasts channel_renamed event via WebSocket
- [x] Frontend sidebar updates channel names in real-time

### Search Panel
- [x] SearchPanel.jsx: search messages across all channels
- [x] REST endpoint: /api/search?q=...&channel=...
- [x] Results show channel, sender, timestamp, content snippet

### Agent Profile Panel
- [x] AgentProfile.jsx: click agent → see role, memory, recent activity
- [x] Scrollable memory viewer
- [x] Agent stats display

### Decision Log Panel
- [x] DecisionLog.jsx: view locked decisions from DB
- [x] Shows decision content, who made it, when

---

## SESSION 6 — v0.6 Fixes (Session 6)
**Date:** 2026-02-14 ~11:30 PM
**Commit:** a5a437d

### Interrupt System Rewrite
- [x] Interrupt checks between EVERY agent response (not just between rounds)
- [x] Immediate re-routing when user sends new message during active conversation
- [x] Clean interrupt: current agent finishes, then new message gets routed

### Task Tool ([TOOL:task])
- [x] Pattern: [TOOL:task] Title | assigned_to | priority
- [x] Parser in tool_executor.py: extracts title, assigned_to, priority
- [x] DB insert on parse: creates task in backlog
- [x] Broadcast: task_created event via WebSocket
- [x] UI: TaskBoard auto-refreshes (5-second polling)

### PASS Filtering
- [x] Leading AND trailing PASS occurrences stripped via regex
- [x] Handles: "PASS", "[PASS]", "PASS.", and PASS buried in response text

### Write Tool Format Flexibility
- [x] write_noblock pattern: allows write tool calls without strict content block format
- [x] Warnings logged for missing content blocks but execution continues

### Full Task CRUD
- [x] GET /api/tasks — list all tasks
- [x] POST /api/tasks — create task
- [x] PATCH /api/tasks/{id}/status — update status (backlog/in_progress/review/done)
- [x] Task board UI with drag-to-update columns

---

## CURRENT STATE — v0.8 (as of 2026-02-15)

### Platform Status
- Runtime hardening added for Windows shell PATH issues.
- Root wrapper: `with-runtime.cmd`
- Frontend wrappers: `client/dev-build.cmd`, `client/dev-lint.cmd`
- Launchers updated to avoid raw `npx` dependency paths.

### Agent and API Status
- Agent roster is now 14 total, including `codex` (OpenAI backend).
- `agents/registry.json` is canonical for Codex; DB fallback remains.
- New endpoint: `PATCH /api/agents/{agent_id}` for agent config updates.
- Existing status endpoints: `/api/ollama/status`, `/api/claude/status`, `/api/openai/status`.

### UI Status
- Implemented and live:
  - Dashboard home
  - Unread badges + sound notifications
  - Thread replies + timestamp grouping
  - File uploads in chat
  - Staff online/offline backend badges
  - Agent Config tab for editing agent settings

### Remaining Gaps
- Meeting mode
- Voting / consensus workflow
- Message reactions
- Router and follow-up quality tuning

### How to Run (Windows)
```bat
cd C:\AI_WORKSPACE\ai-office
C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe start.py
```

Desktop mode:
```bat
cd C:\AI_WORKSPACE\ai-office
C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe app.py
```

### Security Reminder
- If any key was exposed in chat/logs/screenshots, rotate it immediately and replace it in `.env`.

---

## SESSION 9 - Full App Builder Enablement (2026-02-15)

### Goal
- Enable AI Office to build complete applications end-to-end with structured orchestration, not just ad-hoc chat responses.

### Delivered
- Added App Builder orchestration module:
  - `server/app_builder.py`
  - Structured kickoff prompt with milestones, tool usage requirements, and final handoff requirements.
  - Automatic seed tasks for architecture, implementation, QA/review, and release summary.
- Added API endpoint:
  - `POST /api/app-builder/start`
  - Implemented in `server/routes_api.py` with `AppBuilderStartIn` model in `server/models.py`.
- Added Controls UI for App Builder:
  - `client/src/components/Controls.jsx`
  - Fields for app name, goal, stack profile, target directory, include-tests toggle.
  - Status feedback after kickoff.
- Expanded tool-run reliability for real app builds:
  - `server/tool_gateway.py` now supports:
    - `@subdir` command targeting (example: `@client npm run build`)
    - broader safe command allowlist (npm install/ci/dev/build/test, scaffold commands)
    - shell-operator blocking (`&&`, `||`, `|`, redirection, etc.)
    - longer adaptive timeouts for install/scaffold/build commands
    - injected Git path for command execution.
- Added run-result cwd visibility in chat tool output:
  - `server/tool_executor.py`
- Improved routing for full-app requests:
  - `server/router_agent.py` keyword map expanded for "full app", "from scratch", and production-ready asks.

### Verification
- `tools/toolchain_smoke.py` PASS (includes `@client npm -v` run path check)
- `tools/runtime_smoke.py` PASS (includes app-builder endpoint check)
- `tools/startup_smoke.py` PASS
- `tools/desktop_smoke.py` PASS
- `tools/personality_smoke.py` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS

## SESSION 10 - Staff Expansion + Model Readiness (2026-02-15)

### Added staff
- `ops` (DevOps / Reliability Engineer)
- `scribe` (Technical Writer / Documentation)
- `critic` (Formal Critic / Red Team)

### Routing and engine updates
- Added new IDs and display names to conversation engine:
  - `server/agent_engine.py`
- Extended router team map, keywords, and validation set:
  - `server/router_agent.py`
- Added adversarial/anti-groupthink routing priority with `critic` in major decisions.

### Ollama model management feature
- Added model management APIs:
  - `GET /api/ollama/models/recommendations`
  - `POST /api/ollama/models/pull`
- Implemented in:
  - `server/ollama_client.py`
  - `server/routes_api.py`
  - `server/models.py` (`OllamaPullIn`)
- Added Controls UI panel to:
  - refresh model readiness
  - pull missing recommended models
  - inspect model-to-staff mapping
  - Files: `client/src/components/Controls.jsx`, `client/src/App.css`, `client/src/api.js`

### CLI helper
- Added `tools/pull_staff_models.py` to pull recommended Ollama models directly.

### Validation
- `tools/runtime_smoke.py` PASS
- `tools/startup_smoke.py` PASS
- `tools/desktop_smoke.py` PASS
- `tools/toolchain_smoke.py` PASS
- `tools/personality_smoke.py` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS

### Notes
- Model pull was attempted, but skipped in this environment because Ollama was not reachable at `127.0.0.1:11434`.

---

## SESSION 11 - Collab Core + Execution Engine (2026-02-15)

### Collaboration core
- [x] Added message reactions persistence:
  - DB table: `message_reactions`
  - APIs:
    - `POST /api/messages/{message_id}/reactions`
    - `GET /api/messages/{message_id}/reactions`
  - WebSocket fanout event: `reaction_update`
- [x] Added deterministic collab commands:
  - `/meeting` (structured mode)
  - `/vote` (deterministic option selection and tally)
- [x] Vote results now persist to `decisions`.
- [x] Chat header now shows collab mode status.

### Execution engine foundations
- [x] Added project workspace manager:
  - `server/project_manager.py`
  - `PROJECTS_ROOT = C:/AI_WORKSPACE/projects`
  - create/list/switch/status/delete with two-step delete confirmation token.
- [x] Added project APIs:
  - `POST /api/projects`
  - `GET /api/projects`
  - `POST /api/projects/switch`
  - `GET /api/projects/active/{channel}`
  - `DELETE /api/projects/{name}`
  - `GET /api/projects/status/{channel}`
- [x] Tool gateway now uses channel-aware sandbox roots.
- [x] Added build runner:
  - `server/build_runner.py`
  - config path: `.ai-office/config.json`
  - auto-detects Node/Python/Rust/Go/CMake commands
  - APIs for config/build/test/run.
- [x] Added `/build` command family in engine:
  - `/build config`
  - `/build set-build <cmd>`
  - `/build set-test <cmd>`
  - `/build set-run <cmd>`
  - `/build run`
  - `/test run`
  - `/run start`
- [x] Added post-write build/test/fix loop:
  - auto-runs after write tool calls when build config exists
  - up to 3 fix attempts
  - escalates to Nova on repeated failure.
- [x] Added file context injection in prompts:
  - README/manifests
  - user referenced paths
  - recent file references
  - assigned task references.
- [x] Added task status tag automation:
  - `[TASK:start] #id`
  - `[TASK:done] #id - summary`
  - `[TASK:blocked] #id - reason`

### UI
- [x] Added Projects tab:
  - `client/src/components/ProjectPanel.jsx`
- [x] Added active project badge to chat header.
- [x] Added reactions UI in chat messages.

---

## SESSION 12 - Stage 2/3 Completion Pass (2026-02-15)

### Stage 2 features
- [x] Added autonomous work mode:
  - `server/autonomous_worker.py`
  - APIs:
    - `POST /api/work/start`
    - `POST /api/work/stop`
    - `GET /api/work/status/{channel}`
  - Commands:
    - `/work start`
    - `/work stop`
    - `/work status`
- [x] Added web research:
  - `server/web_search.py`
  - provider order:
    - SearXNG (if configured)
    - Tavily (if configured)
  - explicit unavailable response when neither exists
  - tools: `[TOOL:web]`, `[TOOL:fetch]` (restricted by role).
- [x] Added Git integration:
  - `server/git_tools.py`
  - APIs:
    - `/api/projects/{name}/git/status|log|diff|commit|branch|merge`
  - Commands:
    - `/git status`, `/git log`, `/git commit <msg>`, `/git branch <name>`
    - `/branch <name>`, `/merge <name>`
  - UI panel: `client/src/components/GitPanel.jsx`
- [x] Added inline code execution:
  - API: `POST /api/execute` (`python`, `javascript`, `bash`, 30s timeout)
  - Message code blocks now include Run button in `MessageContent.jsx`.

### Stage 3 features
- [x] Added `/export` transcript writing to active project:
  - `docs/exports/<channel>-<timestamp>.md`
- [x] Added project templates:
  - `/project create <name> --template react|python|rust`
  - API body supports `template`.
- [x] Added performance tracking:
  - DB table: `build_results`
  - API: `GET /api/performance/agents`
  - Agent profile now surfaces build/tool/task metrics.
- [x] Added API usage/cost tracking + budget:
  - DB table: `api_usage`
  - budget persisted in `settings` (`api_budget_usd`)
  - APIs:
    - `GET /api/usage`
    - `GET /api/usage/summary`
    - `GET /api/usage/budget`
    - `PUT /api/usage/budget`
  - stop-warning behavior for hosted backends when budget is exceeded.
- [x] Added dark/light theme toggle in UI.
- [x] Added startup mode selector (`start.py --mode web|desktop`).
- [x] Hardened tool creation workflow by auto-compiling newly written `tools/*.py` scripts.

### Tests and verification
- [x] Added tests:
  - `tests/test_projects_api.py`
  - `tests/test_build_runner.py`
  - `tests/test_task_tag_updates.py`
  - `tests/test_execute_api.py`
  - `tests/test_git_api.py`
- [x] Verification run:
  - `python -m pytest tests -q` PASS
  - `client/dev-lint.cmd` PASS
  - `client/dev-build.cmd` PASS
  - `tools/runtime_smoke.py` PASS
  - `tools/startup_smoke.py` PASS
  - `tools/desktop_smoke.py` PASS
  - `tools/toolchain_smoke.py` PASS
  - `tools/personality_smoke.py` PASS

---

## SESSION 13 - Segment 1 Task Board Overhaul (2026-02-15)

### Backend task schema + API
- [x] Extended `tasks` schema for structured workflow fields:
  - `subtasks` (JSON text)
  - `linked_files` (JSON text)
  - `depends_on` (JSON text)
  - normalized `priority` default to 2 (range 1-3)
- [x] Added non-destructive migrations in `server/database.py` for legacy DBs.
- [x] Added normalized task helpers in `server/database.py`:
  - `create_task_record`, `get_task`, `list_tasks`, `update_task`, `delete_task`
- [x] Added/updated task endpoints in `server/routes_api.py`:
  - `GET /api/tasks/{id}`
  - `PUT /api/tasks/{id}`
  - `DELETE /api/tasks/{id}`
  - existing `POST /api/tasks`, `GET /api/tasks`, `PATCH /api/tasks/{id}/status` now use shared normalized task logic.
- [x] Updated task models in `server/models.py`:
  - `TaskIn` supports structured fields + priority validation
  - new `TaskUpdateIn`
  - `TaskOut` includes structured fields.

### Tooling and data cleanup
- [x] Added `tools/clean_test_data.py`:
  - deletes smoke/test junk tasks with `--dry-run` support
  - supports `--all` for full task wipe when needed.
- [x] Updated `server/tool_executor.py` task creation to use structured DB helper and priority range 1-3.

### Frontend Task Board rewrite
- [x] Rebuilt `client/src/components/TaskBoard.jsx`:
  - filterable board (search, assignee, priority, status)
  - stronger priority indicators (P1/P2/P3)
  - clear back/next move controls
  - task detail modal with editable fields
  - subtask management in modal
  - linked file management in modal
  - task deletion from modal.
- [x] Updated `client/src/App.css` with Task Board/modal styles for desktop + mobile.

### Regression fix during segment
- [x] Fixed `/api/execute` runtime executable resolution in `server/routes_api.py` so python/node/bash execution works even when PATH is fragile.

### Verification
- [x] `python -m pytest tests -q` PASS (`9 passed`)
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS
- [x] Direct startup validation via `python start.py --mode web` + `/api/health` check PASS (`START_OK`)

---

## SESSION 14 - Segment 2 Conversation Quality (2026-02-15)

### Baseline conversation test and log
- [x] Sent baseline prompt: `hey team, what should we build today?`
- [x] Logged deterministic baseline behavior before fix to:
  - `tests/segment2_conversation_baseline_before_fix.md`
- [x] Logged post-fix behavior to:
  - `tests/segment2_conversation_after_fix.md`

### Engine follow-up quality fixes (`server/agent_engine.py`)
- [x] Added stronger follow-up prompt rules in `_build_system`:
  - "Read all messages above. If someone already said X, do NOT repeat it. React to what THEY said."
  - must reference at least one teammate by name in follow-ups
  - if everyone agrees, challenge at least one assumption.
- [x] Added follow-up quality enforcement helpers:
  - semantic similarity check against recent agent messages
  - agreement-cluster detection
  - challenge-signal detection
  - teammate-name reference enforcement for follow-ups.
- [x] Added deterministic anti-groupthink routing in `_pick_next`:
  - when multiple agents already spoke and last message is pure agreement, force one challenger voice (`critic/reviewer/sage/codex`).

### Segment 2 verification
- [x] `python -m pytest tests -q` PASS (`9 passed`)
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS
- [x] `python start.py --mode web` startup health check PASS (`START_OK`)

---

## SESSION 15 - Segment 3 E2E Project Verification (2026-02-15)

### Project lifecycle and build pipeline validation
- [x] Created and switched active project to `test-calculator` under `C:/AI_WORKSPACE/projects`.
- [x] Applied build/test/run config for project:
  - build: `python -m py_compile main.py`
  - test: `python -m pytest tests/ -v`
  - run: `python main.py`
- [x] Executed chat-driven E2E prompt:
  - `Team, build a Python calculator with add/subtract/multiply/divide. Max write the code, Quinn write tests.`
- [x] Confirmed generated files:
  - `C:/AI_WORKSPACE/projects/test-calculator/main.py`
  - `C:/AI_WORKSPACE/projects/test-calculator/tests/test_calculator.py`

### Failure documentation
- [x] Added full E2E run log to `tests/e2e_test_log.md`.
- [x] No failures occurred in this run; log explicitly records zero failures.

### Segment utility
- [x] Added deterministic helper runner:
  - `tools/segment3_e2e_runner.py`
  - creates project, configures commands, drives conversation flow, and writes E2E log.

### Segment 3 verification
- [x] Project-level checks:
  - `python -m py_compile main.py` PASS
  - `python -m pytest tests/ -v` PASS (`6 passed`)
- [x] Repo-level checks:
  - `python -m pytest tests -q` PASS (`9 passed`)
  - `client/dev-lint.cmd` PASS
  - `client/dev-build.cmd` PASS
  - `python start.py --mode web` health check PASS (`START_OK`)

---

## SESSION 16 - Feature 1 Brainstorm Mode (2026-02-15)

### New command mode
- [x] Added `/brainstorm [topic]` command in `server/agent_engine.py`.
- [x] Added `/brainstorm stop` command to end mode and publish vote-ranked summary.
- [x] Brainstorm collab mode now sets `collab_mode=brainstorm` with topic and round metadata.

### Agent orchestration and prompts
- [x] Added deterministic brainstorm roster selection (5-6 agents):
  - Must include Spark when active.
  - Strong preference order includes Ada (`architect`), Uma (`uiux`), Leo (`lore`), Sage.
  - Adds one wildcard when available.
- [x] Added brainstorm-specific system guidance in `_build_system`:
  - exactly one idea
  - 2-3 sentences
  - role-perspective specific
  - no agreement/repetition.
- [x] Added dedicated brainstorm round runner to collect one idea per selected agent and post round-complete instruction message.

### Upvote tracking and stop summary
- [x] Added reaction-backed idea vote summary for brainstorm message IDs.
- [x] `/brainstorm stop` now posts:
  - top-voted ideas (👍 counts)
  - winner callout
  - prompt to convert winner into task.

### Tests and verification
- [x] Added `tests/test_brainstorm_mode.py` covering:
  - brainstorm start
  - idea round completion
  - upvote counting
  - stop summary emission.
- [x] Verification run:
  - `python -m pytest tests/test_brainstorm_mode.py -q` PASS
  - `python -m pytest tests -q` PASS (`10 passed`)
  - `client/dev-lint.cmd` PASS
  - `client/dev-build.cmd` PASS
  - `python start.py --mode web` health check PASS (`START_OK`)

---

## SESSION 17 - Feature 2 Oracle Mode (2026-02-15)

### New command mode
- [x] Added `/oracle <question>` command in `server/agent_engine.py`.
- [x] Oracle flow now sends startup notice:
  - `🔮 Oracle mode — reading project files...`
- [x] Oracle routes responses through Scout (`researcher`) by default, with Nova fallback if Scout is unavailable.

### Oracle file context pipeline
- [x] Added file selection logic with keyword scoring and heuristics:
  - scans active project tree
  - prefers relevant files by question terms
  - endpoint/API questions boost `routes_api`/routing files
  - max 5 files selected.
- [x] Added file context injection limits:
  - reads text files only
  - max 200 lines per file with truncation marker.
- [x] Added optional test-gap hint generation for "no tests/without tests" questions.

### Oracle answer generation
- [x] Added dedicated Oracle answer generator with strict grounding rules:
  - answer only from provided files/tree
  - cite concrete files and avoid guessing
  - explain missing-file limitations explicitly.
- [x] Supports ollama/claude/openai backends with existing budget guard behavior for hosted providers.

### Tests and verification
- [x] Added `tests/test_oracle_mode.py`:
  - verifies endpoint questions select `routes_api.py`
  - verifies `/oracle` posts system startup + agent answer.
- [x] Verification run:
  - `python -m pytest tests/test_oracle_mode.py -q` PASS
  - `python -m pytest tests -q` PASS (`12 passed`)
  - `client/dev-lint.cmd` PASS
  - `client/dev-build.cmd` PASS
  - `python start.py --mode web` health check PASS (`START_OK`)

---

## SESSION 18 - Feature 3 War Room Mode (2026-02-15)

### New command mode
- [x] Added `/warroom [issue]` command in `server/agent_engine.py`.
- [x] Added `/warroom stop` command with closure summary.
- [x] War Room collab mode now tracks:
  - `issue/topic`
  - `started_at`
  - `trigger` (manual/auto)
  - `allowed_agents`.

### War Room enforcement
- [x] Locked active responders to 4 core agents:
  - Max (`builder`)
  - Rex (`reviewer`)
  - Quinn (`qa`)
  - Nova (`director`)
- [x] Added suppression guard so non-war-room agents are skipped without escalation noise.
- [x] Added war-room prompt override:
  - "WAR ROOM MODE. Focus ONLY on fixing [issue]. No brainstorming, no new features. Steps: reproduce -> diagnose -> fix -> verify."

### Auto-trigger and auto-exit behavior
- [x] Auto-enter War Room on repeated build/test failure threshold in build-fix loop.
- [x] Auto-exit War Room when:
  - build/test recovers to pass,
  - Nova marks it "resolved",
  - user runs `/warroom stop`.
- [x] Exit posts summary including issue, elapsed time, resolver, and reason.

### Frontend status/timer
- [x] Updated `client/src/components/ChatRoom.jsx`:
  - war-room header state with issue + elapsed timer
  - status display now shows `WAR ROOM — [issue] — [mm:ss]` when active.
- [x] Updated `client/src/App.css` with red/orange war-room badge styling.

### Tests and verification
- [x] Added `tests/test_warroom_mode.py`:
  - manual start/stop lifecycle
  - auto-trigger from repeated build failures.
- [x] Verification run:
  - `python -m pytest tests/test_warroom_mode.py -q` PASS
  - `python -m pytest tests -q` PASS (`14 passed`)
  - `client/dev-lint.cmd` PASS
  - `client/dev-build.cmd` PASS
  - `python start.py --mode web` health check PASS (`START_OK`)

---

## SESSION 19 - Feature 4 Auto Code Review Pipeline (2026-02-16)

### Auto-review runtime behavior
- [x] Added channel-level auto-review toggle via slash commands:
  - `/review on`
  - `/review off`
  - `/review status`
- [x] Implemented code-write detection from successful `[TOOL:write]` executions.
- [x] Added reviewable file filtering:
  - allowed: `.py .js .jsx .ts .tsx .rs .go .cpp .c .java`
  - excluded: docs/tests/spec-style files and non-code files.
- [x] Added 30-second per-channel review rate limit.

### Reviewer automation
- [x] Added auto-review generator path for Rex (`reviewer`) with deterministic output contract:
  - first line `Severity: critical|warning|ok`
  - short bug/security/error-handling/edge-case review bullets.
- [x] Auto-review messages are now posted as `msg_type=review` with `📋 Code Review`.
- [x] If review severity is critical:
  - auto-create follow-up task assigned to original author
  - include linked file path
  - broadcast task creation event.

### Tool execution contract updates
- [x] Updated `server/tool_executor.py` result payloads to include tool call metadata (`path`/`arg`) so post-processors can safely detect written files.

### Tests and verification
- [x] Added `tests/test_auto_review_pipeline.py`:
  - verifies critical review creates review message + task
  - verifies `/review off` disables auto-review.
- [x] Verification run:
  - `python -m pytest tests/test_auto_review_pipeline.py -q` PASS
  - `python -m pytest tests -q` PASS
  - `client/dev-lint.cmd` PASS
  - `client/dev-build.cmd` PASS

---

## SESSION 20 - Feature 5 Sprint Mode (2026-02-16)

### Sprint command surface
- [x] Added sprint command handler in `server/agent_engine.py`:
  - `/sprint start <duration> <goal>`
  - `/sprint status`
  - `/sprint stop`
- [x] Added duration parser (`30m`, `2h`) and channel-scoped sprint state tracking.

### Sprint execution flow
- [x] Sprint start now:
  - sets collab mode `sprint` with `goal`, `started_at`, `ends_at`
  - starts background work loop (through existing autonomous worker)
  - asks Nova to decompose sprint goal into `3-6` `[TOOL:task]` items.
- [x] Added sprint watcher loop:
  - periodic progress updates (default every 5 minutes)
  - auto-stop on timer expiry
  - auto-stop when sprint-scoped tasks are all done.

### Sprint report generation
- [x] Sprint stop now generates and posts structured report:
  - goal
  - planned vs actual duration
  - task completion and blocked/remaining summary
  - file create/modify counts from git status
  - build/test status (when configured)
  - agent write participation summary.
- [x] Report persisted to:
  - `<active project>/docs/sprint-reports/<channel>-<timestamp>.md`

### Frontend sprint status
- [x] Updated `client/src/components/ChatRoom.jsx`:
  - header badge now shows sprint countdown and goal while sprint is active.
- [x] Updated `client/src/App.css`:
  - added sprint badge styling.

### Tests and verification
- [x] Added `tests/test_sprint_mode.py`:
  - sprint start/status/stop lifecycle
  - task decomposition path
  - report file persistence.
- [x] Verification run:
  - `python -m pytest tests/test_sprint_mode.py -q` PASS
  - `python -m pytest tests -q` PASS (`17 passed`)
  - `tools/runtime_smoke.py` PASS
  - `tools/startup_smoke.py` PASS
  - `tools/desktop_smoke.py` PASS
  - `tools/toolchain_smoke.py` PASS
  - `tools/personality_smoke.py` PASS
  - `client/dev-lint.cmd` PASS
  - `client/dev-build.cmd` PASS

---

## SESSION 21 - Step 2/3 Conversation Quality + Complexity Caps (2026-02-16)

### Step 2 - Agent response quality hardening
- [x] Updated `server/agent_engine.py` `_generate()` to inject a strict teammate summary block before each response:
  - `=== WHAT YOUR TEAMMATES ALREADY SAID (DO NOT REPEAT) ===`
  - includes recent teammate one-line excerpts since the latest user message.
- [x] Added generic-response detection so if multiple teammates already posted generic replies, the next agent is forced to add concrete role-specific value or effectively PASS.
- [x] Added extra anti-repeat guard after generation:
  - if response is too similar to teammate messages, it is dropped (treated like PASS).

### Step 3 - Message complexity detection and turn limits
- [x] Added complexity classifier helpers in `server/agent_engine.py`:
  - simple -> max 2 initial agents, 0 follow-up rounds
  - medium -> max 3 initial agents, 1 follow-up round
  - complex -> max 4 initial agents, 2 follow-up rounds
- [x] Added channel-scoped turn policy state and applied limits in:
  - `process_message()` initial routing
  - `_handle_interrupt()` rerouting
  - `_conversation_loop()` follow-up gating and user-last reroute path.

### Verification
- [x] `python -m pytest tests -q` PASS (`17 passed`)
- [x] `tools/personality_smoke.py` PASS
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS

---

## SESSION 22 - Step 4 Clear Chat Endpoint + UI (2026-02-16)

### Backend
- [x] Added `clear_channel_messages(channel)` in `server/database.py`.
- [x] Added API endpoint in `server/routes_api.py`:
  - `DELETE /api/channels/{channel_id}/messages`
  - Deletes all channel messages, inserts system message `Chat history cleared.`, and broadcasts it via websocket.

### Frontend
- [x] Updated `client/src/components/ChatRoom.jsx`:
  - Added `Clear Chat` button in header.
  - Added confirmation dialog: `Clear all messages in this channel? This cannot be undone.`
  - On success, clears local state and keeps the returned system message visible.

### Verification
- [x] `python -m pytest tests -q` PASS (`17 passed`)
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS
