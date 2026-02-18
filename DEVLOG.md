# AI OFFICE — Development Log
# Complete changelog from project inception to current state
# Last updated: 2026-02-17

---

## SESSION 38 - Process Tool Tags (2026-02-17)

### Background process tool tags
- [x] Added tool tags to `server/tool_executor.py`:
  - `[TOOL:start_process] <command | json>`
  - `[TOOL:stop_process] <process_id | json>`
  - `[TOOL:list_processes]`
  - `[TOOL:tail_process_logs] <process_id [lines] | json>`
- [x] Tool executor now routes these to `server/process_manager.py` and returns results to chat.

### Verification
- [x] `with-runtime.cmd python -m pytest -q tests` PASS
- [x] `tools/toolchain_smoke.py` PASS

---

## SESSION 37 - Argv-Based Tool Run Execution (2026-02-17)

### Tool execution modernization
- [x] `server/tool_gateway.py` run tool now uses `asyncio.create_subprocess_exec(*argv)` (no shell by default).
- [x] Structured run support:
  - `POST /api/tools/run` accepts JSON with `cmd: [...]`, `cwd`, `env`, `timeout`.
  - Tool executor supports `[TOOL:run] {\"cmd\":[...],...}` payloads.
- [x] Policy now distinguishes legacy string vs argv:
  - shell meta token blocking remains for legacy string path
  - argv path does not treat `;` as chaining (fixes false positives for `python -c`).
- [x] Node tool reliability: `npm`/`npx` commands are executed via `node` + `npm-cli.js`/`npx-cli.js` to avoid `.cmd` quoting edge cases.
- [x] Added backend coverage: `tests/test_tool_run_argv_exec.py`.

### Verification
- [x] `with-runtime.cmd python -m pytest -q tests` PASS
- [x] `tools/toolchain_smoke.py` PASS
- [x] `tools/runtime_smoke.py` PASS
- [x] `tools/startup_smoke.py` PASS
- [x] `tools/desktop_smoke.py` PASS
- [x] `tools/personality_smoke.py` PASS

---

## SESSION 36 - Permission Grants API (2026-02-17)

### Permission grants (time-boxed scope enablement)
- [x] Added endpoints:
  - `POST /api/permissions/grant`
  - `POST /api/permissions/revoke`
- [x] Grants persist in DB (`permission_grants`) and are merged into the effective channel scopes.
- [x] Added backend coverage: `tests/test_permission_grants_api.py`.

### Verification
- [x] `with-runtime.cmd python -m pytest -q tests` PASS

---

## SESSION 35 - Debug Bundle + Copy UX (2026-02-17)

### Debug bundle export
- [x] Added `POST /api/debug/bundle` to download a redacted zip containing:
  - console events
  - tool logs
  - tasks snapshot
  - permission/autonomy snapshot
  - running process list + logs
- [x] Added `server/debug_bundle.py` bundle builder + secret redaction.
- [x] Added backend coverage: `tests/test_debug_bundle_export.py`.

### Copy UX
- [x] Chat: per-message Copy button (raw text including code blocks).
- [x] Console: Copy JSON + Copy Markdown for filtered console events.
- [x] Audit: Copy full tool payload/result as JSON per entry.
- [x] Added Debug tab/panel for one-click debug bundle export.

### Tooling reliability
- [x] Updated `with-runtime.cmd` to prefer Python 3.12 so `with-runtime.cmd python -m pytest` is reproducible.

### Verification
- [x] `with-runtime.cmd python -m pytest -q tests` PASS
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS
- [x] `tools/runtime_smoke.py` PASS
- [x] `tools/startup_smoke.py` PASS
- [x] `tools/desktop_smoke.py` PASS
- [x] `tools/toolchain_smoke.py` PASS
- [x] `tools/personality_smoke.py` PASS

---

## SESSION 34 - EPIC 2 Foundations (Workspace/Task Scope + Runtime Manager) (2026-02-17)

### Task/project isolation foundation
- [x] Extended `tasks` schema in `server/database.py`:
  - `channel` (default `main`)
  - `project_name` (default `ai-office`)
- [x] Added non-destructive migrations for existing DBs and backfilled defaults.
- [x] Updated task CRUD helpers to persist/filter by:
  - `channel`
  - `project_name`
  - `branch`
- [x] Updated task routes in `server/routes_api.py`:
  - `POST /api/tasks` now honors `channel` + `project_name`
  - `GET /api/tasks` now supports `channel` + `project_name` filtering.

### Workspace runtime foundation
- [x] Added `server/runtime_manager.py`:
  - channel workspace introspection
  - workspace venv creation
  - command rewrite for workspace-local `python` / `pip`
- [x] Integrated runtime command rewrite in `server/tool_gateway.py`.
- [x] Updated `server/project_manager.py` to materialize channel workspace structure for non-app projects:
  - `{workspace}/{project}/{channel}/repo`
  - `{workspace}/{project}/{channel}/artifacts`
  - `{workspace}/{project}/{channel}/skills`
  - `{workspace}/{project}/{channel}/venv`
  - `{workspace}/{project}/{channel}/logs`
- [x] Active non-app project path now resolves to channel workspace `repo`.

### Policy refinement for scoped permissions
- [x] `server/policy.py` now enforces scope requirements:
  - `run` scope for run tools
  - `write` scope for mutating file tools
  - `pip` scope for package installs
  - `git` scope for mutating git commands

### Verification
- [x] `python -m pytest -q tests` PASS
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS
- [x] `tools/runtime_smoke.py` PASS
- [x] `tools/startup_smoke.py` PASS
- [x] `tools/desktop_smoke.py` PASS
- [x] `tools/toolchain_smoke.py` PASS
- [x] `tools/personality_smoke.py` PASS

---

## SESSION 33 - EPIC 1 Permissioned Autonomy + Approval Governance (2026-02-17)

### Policy persistence model
- [x] Added channel permission policy table in `server/database.py`:
  - `permission_policies(channel, mode, expires_at, scopes, command_allowlist_profile, timestamps)`
  - modes: `locked | ask | trusted`
  - trusted mode now auto-reverts to `ask` on expiry read
- [x] Added approval request table in `server/database.py`:
  - `approval_requests(id, channel, task_id, agent_id, tool_type, payload_json, risk_level, status, decided_by, decided_at, created_at)`

### Tool approval handshake
- [x] Added API endpoints in `server/routes_api.py`:
  - `GET /api/permissions?channel=...`
  - `PUT /api/permissions`
  - `POST /api/permissions/trust_session`
  - `POST /api/permissions/approval-response`
- [x] Integrated channel policy into `server/policy.py` decisions:
  - `locked` blocks mutating tools
  - `ask` returns `requires_approval`
  - `trusted` auto-approves under policy constraints
- [x] Added request/response approval flow in `server/tool_gateway.py`:
  - approval request creation + websocket broadcast (`approval_request`)
  - async waiter resolution (`approval_response`)
  - trusted-session audit tagging
- [x] Updated `server/tool_executor.py`:
  - pauses on `needs_approval`
  - waits for approval response
  - reruns tool on approval, emits denial/timeout messages otherwise

### Audit governance + UI controls
- [x] Extended tool log schema and writer fields:
  - `channel`, `task_id`, `approval_request_id`, `policy_mode`, `reason`
- [x] Extended audit API:
  - filter support: `channel`, `task_id`, `risk_level`
  - export support: `GET /api/audit/export`
- [x] Updated chat UI (`client/src/components/ChatRoom.jsx`):
  - live approval request modal
  - actions: `Approve Once`, `Approve All For This Task`, `Deny`
  - trust-window selector (time-bounded trusted session)
  - approval mode status badge in chat header
- [x] Updated audit UI (`client/src/components/AuditLog.jsx`):
  - new filters (channel/task/risk)
  - export button for filtered audit data
- [x] Added modal styles in `client/src/App.css`

### New tests
- [x] `tests/test_permission_policy_api.py`
- [x] `tests/test_tool_approval_handshake.py`
- [x] `tests/test_trusted_mode_expiry.py`

### Verification (post-segment)
- [x] `python -m pytest -q tests` PASS
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS
- [x] `tools/runtime_smoke.py` PASS
- [x] `tools/startup_smoke.py` PASS
- [x] `tools/desktop_smoke.py` PASS
- [x] `tools/toolchain_smoke.py` PASS
- [x] `tools/personality_smoke.py` PASS

---

## SESSION 32 - EPIC 0 Portability + Deterministic Test Hardening (2026-02-17)

### Segment 0.0 baseline lock
- [x] Re-ran verification matrix:
  - `python -m pytest -q tests`
  - `client/dev-lint.cmd`
  - `client/dev-build.cmd`
  - `tools/runtime_smoke.py`
  - `tools/startup_smoke.py`
  - `tools/desktop_smoke.py`
  - `tools/toolchain_smoke.py`
  - `tools/personality_smoke.py`
- [x] Baseline snapshot pushed:
  - commit: `5f18d9c`
  - tag: `baseline-2026-02-17-prof1`

### Segment 0.1 runtime config unification
- [x] Added canonical runtime config module: `server/runtime_config.py`.
- [x] Added `WORKSPACE_ROOT` in `server/runtime_paths.py` using env override:
  - `AI_OFFICE_WORKSPACE_ROOT`
  - fallback to `AI_OFFICE_PROJECTS_DIR`
- [x] Migrated runtime imports across launcher/server/tools to `server.runtime_config`.

### Segment 0.2 setup and deterministic test wiring
- [x] Added one-command setup scripts:
  - `scripts/dev_setup.ps1`
  - `scripts/dev_setup.cmd`
- [x] Added `pytest.ini` (`testpaths=tests`, `addopts=-q`).
- [x] Added isolated test runtime helper: `tests/helpers/temp_db.py`.
- [x] Updated `tests/conftest.py`:
  - enforces `AI_OFFICE_TESTING=1`
  - enforces temp `AI_OFFICE_HOME/DB/MEMORY/WORKSPACE` roots
- [x] Hardened `server/database.py`:
  - test-aware DB resolution via `AI_OFFICE_TESTING=1`
  - env-forced DB path support
  - avoids creating desktop runtime dirs during test mode

### Docs and env contract updates
- [x] Updated `README.md` with:
  - setup scripts (`scripts/dev_setup.cmd` / `scripts/dev_setup.ps1`)
  - runtime env var contract including `AI_OFFICE_WORKSPACE_ROOT`
- [x] Updated baseline references in `HANDOFF_PROMPT.md`.

### Verification (post-segment)
- [x] `python -m pytest -q tests` PASS
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS
- [x] `tools/runtime_smoke.py` PASS
- [x] `tools/startup_smoke.py` PASS
- [x] `tools/desktop_smoke.py` PASS
- [x] `tools/toolchain_smoke.py` PASS
- [x] `tools/personality_smoke.py` PASS

---

## SESSION 31 - Baseline Lock + Multi-Branch Orchestration Polish (2026-02-17)

### Baseline snapshot and tag
- [x] Verified full matrix before implementation:
  - `python -m pytest -q tests`
  - `client/dev-lint.cmd`
  - `client/dev-build.cmd`
  - `tools/runtime_smoke.py`
  - `tools/startup_smoke.py`
  - `tools/desktop_smoke.py`
  - `tools/toolchain_smoke.py`
  - `tools/personality_smoke.py`
- [x] Baseline commit created and pushed on `main`:
  - commit: `095f9b3`
  - tag: `baseline-2026-02-17`
- [x] Segment 0.0 baseline refresh (post-branch-orchestration lock):
  - commit: `5f18d9c`
  - tag: `baseline-2026-02-17-prof1`
  - matrix status: `41 passed` backend tests + frontend lint/build + all five smoke scripts passing

### Branch-aware backend state model
- [x] Added task branch support in `server/database.py`:
  - `tasks.branch` (`TEXT NOT NULL DEFAULT 'main'`)
  - branch-aware `create_task_record()`, `list_tasks(status, branch)`, `update_task()`
  - branch-aware `get_tasks_for_agent(agent_id, branch=...)`
- [x] Added `channel_branches` table and helpers:
  - `get_channel_active_branch(channel, project_name)`
  - `set_channel_active_branch(channel, project_name, branch)`
  - `list_project_branches_state(project_name)`
- [x] Added non-destructive DB migrations for existing installs.

### Git safety workflows + new APIs
- [x] Reworked `server/git_tools.py`:
  - branch listing/current/switch
  - merge preview (non-destructive + auto-abort)
  - merge apply with structured conflict payload and safety guards
  - dirty working tree protection for preview/apply
- [x] Added routes in `server/routes_api.py`:
  - `GET /api/projects/{name}/branches`
  - `POST /api/projects/{name}/branches/switch`
  - `POST /api/projects/{name}/merge-preview`
  - `POST /api/projects/{name}/merge-apply`
- [x] Updated task APIs:
  - `GET /api/tasks?branch=<name>`
  - `POST /api/tasks` supports branch-aware defaulting from channel/project active branch

### Project/agent/tool context wiring
- [x] `server/project_manager.py` now returns active branch with active project and status payloads.
- [x] `server/agent_engine.py` now:
  - injects active branch into system prompt context
  - scopes assigned task fetch by active branch
  - keeps branch state in `/project` and `/git` command flows
- [x] `server/tool_executor.py` task creation now tags tasks with active branch context.
- [x] `server/policy.py` + `server/tool_gateway.py` now carry branch metadata in policy decisions/tool outputs/events.

### Frontend branch UX polish
- [x] `client/src/components/ProjectPanel.jsx`
  - branch list/current badge
  - switch/create branch controls
  - merge preview/apply controls with conflict payload visibility
- [x] `client/src/components/TaskBoard.jsx`
  - branch filter
  - branch field in create/edit flows
  - branch chip per task card
- [x] `client/src/components/GitPanel.jsx`
  - current branch display
  - merge preview/apply controls
  - conflict summary rendering
- [x] `client/src/components/ChatRoom.jsx`
  - header now shows `Project: <name> @ <branch>`

### New tests added
- [x] `tests/test_branch_context_api.py`
- [x] `tests/test_task_branch_assignment.py`
- [x] `tests/test_merge_preview_api.py`
- [x] `tests/test_merge_apply_conflict_handling.py`
- [x] `tests/test_project_switch_branch_persistence.py`
- [x] `tests/test_agent_branch_prompt_context.py`

### Verification (post-implementation)
- [x] `python -m pytest -q tests` PASS (`41 passed`)
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS
- [x] `tools/runtime_smoke.py` PASS
- [x] `tools/startup_smoke.py` PASS
- [x] `tools/desktop_smoke.py` PASS
- [x] `tools/toolchain_smoke.py` PASS
- [x] `tools/personality_smoke.py` PASS

---

## SESSION 30 - Autonomy/Process/Console Stabilization + Test Expansion (2026-02-17)

### Backend reliability and policy execution
- [x] Added/validated autonomy policy engine (`server/policy.py`) with mode-aware command/path guardrails.
- [x] Added process manager (`server/process_manager.py`) with channel-scoped start/stop/list and kill switch.
- [x] Added extracted post-write verification module (`server/verification_loop.py`) and confirmed integration path.
- [x] Added observability helper (`server/observability.py`) and console-event persistence routes.
- [x] Added skills loader runtime (`server/skills_loader.py`) + create/reload route coverage.

### Test isolation + smoke stability fixes
- [x] Hardened `tests/conftest.py` to bootstrap isolated DB and assert env-root isolation.
- [x] Updated `with-runtime.cmd` to include common LocalAppData Python paths for shell reproducibility.
- [x] Fixed smoke script import path portability for:
  - `tools/runtime_smoke.py`
  - `tools/startup_smoke.py`
  - `tools/desktop_smoke.py`
- [x] Updated `tools/toolchain_smoke.py` for SAFE/TRUSTED mode behavior during run-tool checks.
- [x] Updated runtime upload assertion to support runtime-home upload location.

### New backend tests added
- [x] `tests/test_autonomy_policy.py`
- [x] `tests/test_process_manager.py`
- [x] `tests/test_verification_loop.py`
- [x] `tests/test_tool_format_compliance.py`
- [x] `tests/test_skills_plugin_loader.py`
- [x] `tests/test_create_skill_tool.py`
- [x] `tests/test_project_scoped_memory.py`
- [x] `tests/test_console_events_api.py`

### Frontend wiring completed
- [x] Added Console tab wiring in `client/src/App.jsx` using `client/src/components/ConsolePanel.jsx`.
- [x] Extended `client/src/components/ProjectPanel.jsx` with:
  - autonomy mode get/set UI
  - process start/stop/list controls
  - kill-switch control
- [x] Extended `client/src/components/ChatRoom.jsx` with:
  - active autonomy mode badge
  - channel kill-switch button
- [x] Added supporting styles in `client/src/App.css`.

### Verification (this session)
- [x] `python -m pytest -q tests` PASS (`35 passed`)
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS
- [x] `tools/runtime_smoke.py` PASS
- [x] `tools/startup_smoke.py` PASS
- [x] `tools/desktop_smoke.py` PASS
- [x] `tools/toolchain_smoke.py` PASS
- [x] `tools/personality_smoke.py` PASS

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

---

## SESSION 23 - Step 5 Desktop-Only Launcher + Dev Escape Hatch (2026-02-16)

### Launcher changes
- [x] Replaced `start.py` mode selection flow with desktop-only launch:
  - always launches `app.py`
  - no web/desktop prompt
  - no direct Vite startup path in user launcher.
- [x] Added `dev.py` as developer-only web mode launcher:
  - starts backend (`run.py`) + Vite dev server (`npm run dev`)
  - opens `http://localhost:5173`
  - Ctrl+C cleanup for child processes.

### Runtime smoke alignment
- [x] Updated `tools/startup_smoke.py` for desktop-first behavior:
  - validates port `8000` only (no `5173` requirement).

### Verification
- [x] `tools/startup_smoke.py` PASS
- [x] `tools/desktop_smoke.py` PASS
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS

---

## SESSION 24 - Step 6 Dashboard Agent Status by Role Type (2026-02-16)

### UX change
- [x] Updated `client/src/components/DashboardHome.jsx` Agent Status card:
  - removed backend/provider grouping from dashboard summary
  - added role-type grouping with explicit buckets:
    - `⚡ Technical`
    - `🎨 Creative`
    - `📋 Management`
    - `⭐ Leadership`
    - `🤖 System`
  - each group now shows member count + member names.

### Verification
- [x] `python -m pytest tests -q` PASS (`17 passed`)
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS

---

## SESSION 25 - Step 7 Audit Log Overhaul (2026-02-16)

### Backend audit APIs
- [x] Expanded `GET /api/audit` filters in `server/routes_api.py`:
  - `agent_id`
  - `tool_type`
  - `q` (search in command/args/output)
  - `date_from`
  - `date_to`
- [x] Added `GET /api/audit/count` for tab badge count.
- [x] Added clear endpoints:
  - `DELETE /api/audit/logs`
  - `DELETE /api/audit/decisions`
  - `DELETE /api/audit/all`

### Frontend audit UX
- [x] Rebuilt `client/src/components/AuditLog.jsx` with:
  - filter/search/date bar
  - clear buttons (logs / decisions / all) with confirmation
  - grouped entries by time bucket (collapsible)
  - severity color coding:
    - read/search = green
    - write/task = yellow
    - run = orange
    - non-zero exit = red
  - long output truncation with show more/show less.
- [x] Updated `client/src/App.jsx`:
  - Audit tab now shows badge count: `Audit (<count>)`
  - periodic refresh from `/api/audit/count`.
- [x] Updated `client/src/App.css` audit styles for new layout.

### Verification
- [x] `python -m pytest tests -q` PASS (`17 passed`)
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS

---

## SESSION 26 - Step 8 Final Rebuild + Smoke Verification (2026-02-16)

### Final verification run
- [x] `tools/runtime_smoke.py` PASS
- [x] `tools/startup_smoke.py` PASS
- [x] `tools/desktop_smoke.py` PASS
- [x] `tools/toolchain_smoke.py` PASS
- [x] `tools/personality_smoke.py` PASS
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS

### Notes
- Build warns about large JS chunk size (>500kB after minification), but build completes successfully.

---

## SESSION 27 - Clear Chat UX Hotfix (2026-02-16)

### Fix
- [x] Updated `client/src/components/ChatRoom.jsx` clear-chat flow to avoid duplicate
  `Chat history cleared.` messages when websocket broadcast and local state update happen together.

### Verification
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS

---

## SESSION 28 - Regression Coverage + Desktop Packaging Flow (2026-02-16)

### Added regression tests
- [x] Added `tests/test_chat_audit_api.py`:
  - verifies `DELETE /api/channels/{channel_id}/messages` clears history and leaves exactly one system notice
  - verifies audit filters (`agent_id`, `tool_type`, `q`, `date_from`, `date_to`)
  - verifies `GET /api/audit/count`
  - verifies clear endpoints:
    - `DELETE /api/audit/logs`
    - `DELETE /api/audit/decisions`
    - `DELETE /api/audit/all`
- [x] Added `tests/test_conversation_complexity.py`:
  - verifies simple/medium/complex turn policy outputs
  - verifies `process_message()` caps initial routed agents by complexity.

### Documentation sync
- [x] Updated `README.md` for current launcher reality:
  - `start.py` is desktop-first launcher
  - `dev.py` is web dev mode launcher
  - documented new clear-chat and audit APIs
  - documented standalone packaging output path.

### Standalone desktop packaging
- [x] Added one-command packaging script:
  - `build-desktop.cmd`
  - calls `tools/build_desktop_exe.py`
- [x] Added `tools/build_desktop_exe.py`:
  - validates/install-checks PyInstaller
  - builds one-dir desktop app for `app.py`
  - outputs executable:
    `C:\AI_WORKSPACE\ai-office\dist\AI Office\AI Office.exe`
- [x] Added generated-artifact ignores in `.gitignore`:
  - `build/`
  - `dist/`
  - `*.spec`
  - `docs/sprint-reports/test-sprint-*.md`

### Verification
- [x] `python -m pytest tests -q` PASS (`21 passed`)
- [x] `client/dev-lint.cmd` PASS
- [x] `client/dev-build.cmd` PASS
- [x] `build-desktop.cmd` PASS (PyInstaller build complete, executable created)

---

## SESSION 29 - Path Portability + Test Isolation Baseline (2026-02-17)

### Runtime path portability foundation
- [x] Added `server/runtime_paths.py` as centralized path/env source of truth:
  - app root from `Path(__file__).resolve()`
  - runtime storage defaults from `platformdirs` (`%LOCALAPPDATA%\\AIOffice`)
  - env overrides:
    - `AI_OFFICE_HOME`
    - `AI_OFFICE_PROJECTS_DIR`
    - `AI_OFFICE_DB_PATH`
    - `AI_OFFICE_MEMORY_DIR`
- [x] Refactored path/runtime env usage in:
  - `server/project_manager.py`
  - `server/build_runner.py`
  - `server/routes_api.py`
  - `server/database.py`
  - `server/memory.py`
  - `server/main.py`
  - `server/tool_gateway.py`
- [x] Removed user-specific Python path and repo-absolute assumptions from launchers/wrappers:
  - `start.py`
  - `app.py`
  - `dev.py`
  - `with-runtime.cmd`
  - `desktop-launch.cmd`
  - `build-desktop.cmd`
  - `tools/build_desktop_exe.py` (default Python now `sys.executable`)

### Test/data isolation
- [x] Added `tests/conftest.py` to force test-only runtime paths:
  - temp `AI_OFFICE_HOME`
  - temp `AI_OFFICE_PROJECTS_DIR`
  - temp `AI_OFFICE_MEMORY_DIR`
  - temp `AI_OFFICE_DB_PATH`
- [x] Updated cleanup scripts to use env/platformdirs DB resolution (no hardcoded DB paths):
  - `tools/clean_test_data.py`
  - `tools/clean_all.py`
  - `tools/nuke_data.py`

### Smoke script portability
- [x] Removed hardcoded Python path from:
  - `tools/runtime_smoke.py`
  - `tools/startup_smoke.py`
  - `tools/desktop_smoke.py`
  (now use `sys.executable` + centralized runtime PATH helper)

### Documentation
- [x] Updated `README.md` runtime command examples to remove user-specific absolute paths.
- [x] Documented runtime env override variables in `README.md`.

### Verification status
- [!] In this execution shell, `python`/`py` are not available, so backend/runtime checks could not be executed in-session.
- [x] `node` and `git` were available via `with-runtime.cmd`; frontend checks were runnable.
- [x] Code changes are staged in source; run validation once toolchain binaries are available in shell.

## 2026-02-17 — EPIC 2.3 Process Manager Hardening

### Backend changes
- `server/process_manager.py`
  - Added policy-aware process start validation via `evaluate_tool_policy(...)`.
  - Added command port extraction and collision guards (managed-process conflict + external listener check).
  - Process payload now includes `port`, `policy_mode`, and `permission_mode`.
  - Kill switch now resets project autonomy to `SAFE` **and** channel approval policy to `ask`.
  - Added `shutdown_all_processes()` plus an `atexit` fallback terminator for kill-on-exit safety.
- `server/main.py`
  - Lifespan shutdown now calls `process_manager.shutdown_all_processes()`.
- `server/models.py`
  - Extended `ProcessStartIn` with `agent_id`, `approved`, `task_id`.
  - Extended `ProcessInfoOut` with `port`, `policy_mode`, `permission_mode`.
- `server/routes_api.py`
  - `/api/process/start` now forwards `agent_id`, `approved`, and `task_id`.

### Frontend changes
- `client/src/components/ProjectPanel.jsx`
  - Added include-logs refresh mode (`/api/process/list/{channel}?include_logs=true`).
  - Added per-process log expand/collapse.
  - Added process metadata row (`port`, `policy`, `approval`).
  - Added quick actions: `Open URL` (when port is known), `Stop`, and `Stop All (Kill Switch)`.
- `client/src/components/ChatRoom.jsx`
  - Added header process summary badge (`Processes: X running`).
  - Added process refresh action and quick stop buttons for active processes.
  - Kill switch updates now refresh both autonomy and approval-mode status badges.

### Tests
- `tests/test_process_manager.py` expanded to cover:
  - process lifecycle + kill switch + permission reset to `ask`
  - port collision rejection
  - locked permission mode blocking process starts

### Verification
- `C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe -m pytest -q tests` ✅
- `C:\AI_WORKSPACE\ai-office\client\dev-lint.cmd` ✅
- `C:\AI_WORKSPACE\ai-office\client\dev-build.cmd` ✅
- `tools/runtime_smoke.py` ✅
- `tools/startup_smoke.py` ✅
- `tools/desktop_smoke.py` ✅
- `tools/toolchain_smoke.py` ✅
- `tools/personality_smoke.py` ✅

## 2026-02-17 — EPIC 3.1 Executor State Machine

### Core engine
- Replaced the autonomous worker internals with an explicit phase machine in `server/autonomous_worker.py`:
  - `PLAN -> GATE -> EXECUTE -> VERIFY -> DELIVER`
  - persisted phase events (`work_phase`) include task id/title, attempt, processed/error counters
  - per-step retry budget (`MAX_STEP_RETRIES`) and per-task verify retry budget (`MAX_TASK_RETRIES`)
  - deterministic task selection scoped by active `channel + project`
  - task context fields now surfaced in work status (`current_task_id`, `current_task_title`, `current_task_attempt`, `verify_summary`)
- Added gate approval APIs at worker layer:
  - `approve_current_gate(channel, auto_proceed=False)`
  - trusted + auto-proceed sessions bypass gate; ask-mode requires explicit approve per task

### Command handling
- Updated `/work` command flow in `server/agent_engine.py`:
  - new `/work approve` command to release the current gate
  - `/work status` now reports phase + awaiting_approval details

### Tests
- Added `tests/test_executor_state_machine.py` covering:
  - gate wait -> approve -> complete flow
  - verify retries -> blocked outcome flow

### Verification
- `C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe -m pytest -q tests` ✅ (`49 passed`)
- `C:\AI_WORKSPACE\ai-office\client\dev-lint.cmd` ✅
- `C:\AI_WORKSPACE\ai-office\client\dev-build.cmd` ✅
- `tools/runtime_smoke.py` ✅
- `tools/startup_smoke.py` ✅
- `tools/desktop_smoke.py` ✅
- `tools/toolchain_smoke.py` ✅
- `tools/personality_smoke.py` ✅

## 2026-02-17 - EPIC 2.3E Process Registry Persistence + Orphan Cleanup

### Backend changes
- `server/process_manager.py`
  - Added a per-session `session_id` and persisted process records to DB on start/stop/exit.
  - Added Windows process-tree termination via `taskkill /T /F` to prevent "ghost" child processes.
  - Added orphan discovery + cleanup helpers: `list_orphan_processes()` and `cleanup_orphan_processes()`.
  - `kill_switch()` now also terminates persisted orphans for the channel.
  - `shutdown_all_processes()` now also terminates any DB-marked running processes (covers crash/restart).
- `server/routes_api.py`
  - Added: `GET /api/process/orphans`
  - Added: `POST /api/process/orphans/cleanup`
- `server/main.py`
  - Startup now checks for orphan processes and logs a warning with the cleanup endpoints.

### Database changes
- `server/database.py`
  - Added `managed_processes` helpers:
    - `upsert_managed_process(...)`
    - `mark_managed_process_ended(...)`
    - `list_managed_processes(...)`

### Tests
- Added `tests/test_process_registry_recovery.py` to cover:
  - process start -> DB record exists
  - orphan record detection + cleanup terminates a detached running PID

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `with-runtime.cmd client/dev-lint.cmd` PASS
- `with-runtime.cmd client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-17 - EPIC 1.2 Permission Grants UX (Missing-Scope Prompts)

### Backend changes
- `server/policy.py`
  - When ASK-mode approvals are required, policy now surfaces `missing_scope` for scoped commands (pip/git) so the UI can offer targeted grants.
  - ASK-mode can approve a single pip/git action even if the scope is not permanently granted.
- `server/tool_gateway.py`
  - Approval request payload now includes `missing_scope` (if any).

### Frontend changes
- `client/src/components/ChatRoom.jsx`
  - Approval badge now uses `ui_mode` labels (`ASK|AUTO|LOCKED`) when available.
  - Approval modal now supports scoped grants:
    - `Grant <scope> 10 min + Approve` (creates a scoped grant via `/api/permissions/grant`)
    - `Grant <scope> for Project + Approve`
  - Kept the existing "AUTO window" trusted-session flow for non-scope approvals.

### Tests
- Added `tests/test_policy_scope_prompts.py` to assert pip scope prompts include `missing_scope=pip`.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `with-runtime.cmd client/dev-lint.cmd` PASS
- `with-runtime.cmd client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - P0-A Tool Parsing + Path Canonicalization

### Backend changes
- `server/tool_executor.py`
  - Tool headers now accept both `[TOOL:write]` and legacy `[TOOLwrite]` (missing colon), case-insensitive.
- `server/tool_gateway.py`
  - Added `canonicalize_tool_path()` and applied it to read/search/write paths so leading `@` and `./` do not create wrong directories (e.g. `@apps/...`).
  - Emits `console_event` `tool_path_canonicalized` when normalization changes a path.
- `server/app_builder.py`
  - `_sanitize_target_dir()` now strips leading `@` and `./` so app builder targets never land in `@apps`.

### Tests
- Added `tests/test_tool_parsing_legacy_and_at_paths.py`.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS
