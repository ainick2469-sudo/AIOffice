# AI OFFICE — Development Log
# Complete changelog from project inception to current state
# Last updated: 2026-02-18

---

## SESSION 39 - Header White Strip Root Cause + Frameless Desktop Chrome (2026-02-19)

### Repro note (Prompt #001)
- Repro steps: launch desktop app, switch to dark mode, compare in-app topbar styling with native window strip.
- White surface source: native OS title bar from framed pywebview window (in-app header already tokenized and dark-themed).
- Fix approach: move desktop window to frameless mode with custom in-app drag region + desktop window controls, and harden topbar CSS tokens/fallbacks.

### Delivery
- [x] `app.py`: frameless pywebview window, JS API bridge (`minimize`, `toggle_maximize`, `close`), compatibility fallback when `easy_drag` is unsupported.
- [x] `client/src/components/DesktopWindowControls.jsx`: desktop-only topbar controls wired to `window.pywebview.api`.
- [x] `client/src/App.jsx` + `client/src/App.css`: drag-region split, token-first topbar styling, color-mix fallbacks via `@supports`, consolidated duplicate topbar/split-pane CSS blocks.

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

## 2026-02-19 | Prompt #20: Home creation flow (Discuss -> Plan -> Build) with full-prompt capture

### Home flow and draft lifecycle
- Refactored Home creation to avoid instant Workspace navigation on submit.
- `Create` now stores a durable creation draft and enters explicit creation mode in Home.
- Added `CreationPipeline` UI to run the three phases:
  - `Discuss` (brainstorm + summary)
  - `Plan` (spec confirmation with completeness gate)
  - `Build` (project creation only after explicit approval)
- Startup now restores persisted creation drafts into Home instead of auto-redirecting to Workspace.

### Full prompt capture and preservation
- Hardened wizard prompt handling in `CreateProjectWizard.jsx`:
  - controlled textarea + ref-backed submit source (prevents stale closure reads)
  - no silent truncation, multiline preserved
  - Ctrl+Enter advances step; Enter remains newline
- Template selection no longer overwrites typed prompt text; template is treated as hint metadata.
- Creation submit uses `rawRequest` when available, preserving the exact original prompt text through project creation request payload.

### New UI guardrails
- Added explicit guard when attempting to leave Home for Workspace with an uncreated draft:
  - keep working in Home, or discard draft and continue.
- Added "Back to Describe" and "Start Over" controls inside creation pipeline without clearing unrelated app state.

### Tests
- Updated `tests/test_project_create_from_prompt_api.py`:
  - Added multiline prompt regression test asserting prompt text is preserved in generated spec markdown.

## 2026-02-19 | Prompt #19: Workspace split divider reliability hardening

### Reproduction note
- Reproduced unreliable resize behavior in Split mode by inspecting the active divider path (`SplitPane.jsx`) and exercising drag across pane boundaries/preview iframe. The drag loop depended on divider-level pointer handlers only, so when capture failed or a pointer crossed high-interference surfaces (notably embedded preview iframe/overlay stacks), resize could stall or stop mid-drag. Visual affordance/z-index was also too subtle for consistent hit-testing confidence.

### Fixes
- Rebuilt the active `SplitPane` drag loop for reliability:
  - pointer capture retained, plus window-level pointermove/up/cancel fallback handlers
  - drag lifecycle cleanup centralized (listeners, capture release, RAF cancellation)
  - drag-time body classes hardened (`splitpane-dragging*` + `is-resizing`)
  - temporary iframe pointer-event suppression during drag to prevent capture interference
  - requestAnimationFrame-based drag updates to reduce jitter under rapid pointer movement.
- Added stronger UX feedback and hit reliability:
  - divider remains 10px, elevated z-index, hover highlight, and clear resize cursor
  - live drag tooltip with percentage split (`Primary: xx% | Secondary: yy%`)
  - double-click divider reset persists immediately.
- Added local ratio persistence at divider level:
  - key format now follows per-project + layout preset + orientation scope:
    - `ai-office:paneSizes:<project>:<layoutPreset>:<orientation>:<splitId>`
  - invalid persisted values are ignored and fall back to clamped defaults.
- Unified split implementation usage:
  - retired unused `client/src/components/PaneSplit.jsx` so workspace uses one splitter path only.
- Workspace composition (`WorkspaceShell.jsx`) now provides explicit persist keys + semantic labels for all active split layouts (split/full-ide variants).

### How to verify manually
- Open Workspace in `Split` and drag divider repeatedly; resizing should remain active even when cursor leaves divider.
- Drag while preview iframe is visible; iframe should not block resizing.
- Reload and switch projects/layout presets; previous split ratios should restore.
- Double-click divider; ratio should reset to default for the active layout.

## 2026-02-18 - Project Display Name (Rename Support)

### Backend changes
- `server/routes_api.py`
  - `GET /api/projects` now includes `display_name` for each project when set.
  - Added `PUT /api/projects/{name}/display-name` to persist a UI display name (stored in settings, does not rename folders).

### Tests
- Added `tests/test_project_display_name_api.py`.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS

## 2026-02-18 - Project Create From Prompt + Import API

### Backend changes
- `server/models.py`
  - Added `ProjectCreateFromPromptIn`.
- `server/routes_api.py`
  - Added `POST /api/projects/create_from_prompt`:
    - creates a new project
    - creates/switches a deterministic project chat channel (`proj-<project_name>`)
    - seeds a DRAFT spec + idea bank (spec gate enforced)
    - seeds initial scoped tasks (channel + project)
  - Added `POST /api/projects/import`:
    - accepts `zip_file` upload (zip-first) and optional folder-style `files` upload
    - extracts into the active channel workspace repo (`.../<project>/<channel>/repo`)
    - runs stack detection against the imported repo root
    - seeds a DRAFT spec + ingestion tasks
    - writes a deterministic `docs/PROJECT_BRIEF.md`
  - Enriched `GET /api/projects` to include:
    - `channel_id` (`proj-<name>`)
    - best-effort `detected_kind(s)` from build config

### Tests
- Added:
  - `tests/test_project_create_from_prompt_api.py`
  - `tests/test_project_import_api.py`

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
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

## 2026-02-18 - P0-B Pending Approvals Reload + Expiry

### Backend changes
- `server/database.py`
  - `approval_requests` now stores: `project_name`, `branch`, `expires_at` for UI filtering + countdown.
  - Added helpers:
    - `list_pending_approval_requests(...)`
    - `expire_approval_request(...)`
- `server/tool_gateway.py`
  - Approval requests now include `project_name`, `branch`, `expires_at` and persist those fields.
  - Default approval TTL: `AI_OFFICE_APPROVAL_TTL_SECONDS` (default 600).
- `server/tool_executor.py`
  - Approval waits now use the same TTL env var.
  - On timeout, requests are marked `expired` and websocket broadcasts `approval_expired`.
- `server/routes_api.py`
  - Added `GET /api/approvals/pending` for reconnect-safe pending approvals reload.

### Frontend changes
- `client/src/components/ChatRoom.jsx`
  - Reloads pending approvals on channel load + websocket reconnect.
  - Header now shows a `Pending: N` chip that opens a pending approvals panel.
  - Approval modal now shows expiry countdown when `expires_at` is present.
- `client/src/App.css`
  - Added styles for the pending approvals panel.

### Tests
- Added:
  - `tests/test_approvals_pending_api.py`
  - `tests/test_approval_timeout_expires.py`

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - P0-C Better Blocked Command Guidance

### Backend changes
- `server/policy.py`
  - When legacy string `[TOOL:run]` commands are blocked for shell chaining/redirection, the error now clearly points agents to use `[TOOL:start_process]` for long-running servers or structured argv `[TOOL:run] {"cmd":[...],...}`.

### Agent prompt guidance
- `agents/registry.json`
  - Added an "IMPORTANT TOOL RULES" block to `builder` and `codex` to reduce `&`/shell chaining confusion and steer toward `start_process` + structured argv run payloads.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - P1-A Erase Memory Banks (Stats + Scoped Wipe)

### Backend changes
- `server/memory.py`
  - Added `get_memory_stats(project)` and `erase_memory(project, scopes)` with project-scoped index cleanup.
- `server/database.py`
  - Added helpers for scoped cleanup:
    - `clear_tasks_for_scope(channel, project_name)`
    - `clear_approval_requests_for_scope(channel, project_name)`
- `server/routes_api.py`
  - Added:
    - `GET /api/memory/stats?project=...`
    - `POST /api/memory/erase` (supports optional clears for tasks/approvals/messages)
  - Placed routes above `/api/memory/{agent_id}` to avoid route shadowing.
- `server/models.py`
  - Added `MemoryEraseIn` request model.

### Frontend changes
- `client/src/components/Controls.jsx`
  - Added "Erase Memory Banks" UI: memory stats + scoped wipe + optional clear toggles.

### Tests
- Added `tests/test_memory_stats_and_erase.py`.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - P1-B Spec / Idea Bank + Hard Spec Gate

### Backend changes
- `server/spec_bank.py`
  - New persistent, versioned markdown storage under `AI_OFFICE_HOME/specs/<project>/`:
    - `current_spec.md`, `idea_bank.md`, `history/spec-*.md`, `history/ideas-*.md`
- `server/database.py`
  - Added `spec_states` table (per `channel` + `project_name`) with `none|draft|approved` status + `spec_version`.
  - Added helpers: `get_spec_state(...)`, `set_spec_state(...)`.
- `server/routes_api.py`
  - Added:
    - `GET /api/spec/current?channel=...`
    - `POST /api/spec/current` (save spec -> DRAFT)
    - `POST /api/spec/approve` (confirm text: `APPROVE SPEC`)
    - `GET /api/spec/history?project=...`
- `server/agent_engine.py`
  - Enforced spec gate: when spec status is `draft`, mutating tools (`write`, `run`, `start_process`, `create_skill`, plugin tools) are blocked and a system message explains how to approve.
- `server/app_builder.py`
  - App Builder now seeds an initial spec skeleton + idea bank and marks spec state `draft` so tools are gated until approval.

### Frontend changes
- `client/src/components/SpecPanel.jsx`
  - New Spec / Idea Bank editor with save + approve flow and history list.
- `client/src/App.jsx`
  - Added a Spec tab.
- `client/src/components/ChatRoom.jsx`
  - Chat header now shows `Spec: NONE/DRAFT/APPROVED` chip and shows an Approve button when in DRAFT.
- `client/src/App.css`
  - Added `.convo-status.warn` style for DRAFT spec chip.

### Tests
- Added `tests/test_spec_bank_and_gate.py`.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - P2 Execution Status Panel (Chat Dock)

### Frontend changes
- `client/src/components/StatusPanel.jsx`
  - New right-side status dock for the Chat tab that continuously surfaces:
    - active project + branch
    - spec state
    - pending approvals
    - running processes (with stop/open controls)
    - recent tool calls (audit)
    - recent console events
- `client/src/components/ChatRoom.jsx`
  - Added a `Show/Hide Status` toggle and embeds `StatusPanel` alongside the message list.
  - Persists dock visibility in `localStorage` (`ai-office-status-panel-open`).
- `client/src/App.css`
  - Added status dock styling and responsive behavior.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - Docs: Tool/Approval/Spec/Memory How-To

- `README.md`
  - Added a short "How To Use" section documenting:
    - canonical + legacy tool headers (including `[TOOLwrite]`)
    - approvals + pending queue + TTL
    - spec-first hard gate + approval flow
    - memory banks erase controls

## 2026-02-18 - P0.1 Per-Agent Credentials Vault (DB + API)

### Backend changes
- `server/secrets_vault.py`
  - Added local secret encryption helpers.
  - Windows: DPAPI (CryptProtectData/CryptUnprotectData).
  - Fallback: base64 plaintext with a warning (keeps app functional on non-Windows or if DPAPI fails).
- `server/database.py`
  - Added `agent_credentials` table for per-agent OpenAI/Claude credentials.
  - Added helpers:
    - `upsert_agent_credential`, `get_agent_credential_meta`, `get_agent_api_key` (internal),
      `clear_agent_credential`, `has_any_backend_key`.
- `server/models.py`
  - Added `AgentCredentialIn`, `AgentCredentialMetaOut`.
- `server/routes_api.py`
  - Added credential endpoints:
    - `GET /api/agents/{agent_id}/credentials`
    - `POST /api/agents/{agent_id}/credentials`
    - `DELETE /api/agents/{agent_id}/credentials`
  - Added backend status endpoints that treat stored credentials as available:
    - `GET /api/openai/status`
    - `GET /api/claude/status`
  - Updated startup health backend availability to include stored credentials.

### Test/dev hygiene
- `.gitignore`
  - Ignore `apps/` (local artifacts like `apps/runtime-smoke-app` should not be committed).
- `tools/toolchain_smoke.py`
  - Stabilized by forcing `channel=main` active project to `ai-office` (prevents cross-test project switching from breaking the smoke run).

### Tests
- `tests/test_agent_credentials.py`
  - Covers credential set/get/delete, last4 masking, and backend status reflecting vault keys.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - P0.2 Per-Agent Credentials Wired Into OpenAI/Claude Calls

### Backend changes
- `server/openai_client.py`
  - `chat(...)` now accepts optional `api_key` and `base_url` overrides (per-agent).
  - Test safety: when `AI_OFFICE_TESTING=1`, `.env` is ignored for keys.
- `server/openai_adapter.py`
  - Threads `api_key` and `base_url` through to `openai_client.chat(...)`.
- `server/claude_client.py`
  - Refactored to remove import-time global API key.
  - `chat(...)` now accepts optional `api_key` and `base_url` overrides.
  - Test safety: when `AI_OFFICE_TESTING=1`, `.env` is ignored for keys.
- `server/claude_adapter.py`
  - Threads `api_key` and `base_url` through to `claude_client.chat(...)`.
- `server/agent_engine.py`
  - Remote backends (`openai`/`claude`) now fetch per-agent credentials from `agent_credentials` and pass overrides to adapters.
  - If no key is configured (neither per-agent nor env), returns a clear, user-visible error message and emits a `backend_unavailable` console event.

### Tests
- `tests/test_agent_engine_uses_credential_overrides.py`
  - Verifies `agent_engine` passes per-agent OpenAI `api_key` + `base_url` into the adapter call.
- `tests/test_backend_unavailable_message.py`
  - Verifies a helpful message is returned when OpenAI backend is selected but no key exists anywhere.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - P0.3 Codex Defaults + Repair Flow

### Backend changes
- `agents/registry.json`
  - Updated `codex` defaults to `backend=openai`, `model=gpt-4o-mini` for fresh DB seeds.
- `server/routes_api.py`
  - Added `POST /api/agents/repair` to safely upgrade Codex only when it matches the legacy signature:
    - `backend=ollama` and `model=qwen2.5:14b` → `backend=openai`, `model=gpt-4o-mini`
  - Normalized agent responses for `GET /api/agents/{agent_id}` and `PATCH /api/agents/{agent_id}` by setting `response_model=AgentOut`
    (so `active` consistently serializes as a boolean).

### Frontend changes
- `client/src/components/AgentConfig.jsx`
  - Added "Repair Codex Defaults" button.
  - When switching backends, nudges the model field to a sane default if the current model obviously belongs to a different provider.

### Tests
- `tests/test_agents_update_backend.py`
- `tests/test_agents_repair_codex_defaults.py`

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - P0.4 Task Board Scoped By Default (Project + Channel)

### Frontend changes
- `client/src/components/TaskBoard.jsx`
  - Default task fetch is now scoped to the active `project_name` + `channel`.
  - Added a scope selector: "This Project" (default) vs "All Projects".
  - Task creation now includes `channel` + `project_name` in the POST body (explicit scoping).

### Tests
- `tests/test_tasks_list_filters.py`
  - Confirms `/api/tasks` filter behavior for `channel` and `project_name`.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - P0.5 Embedded Preview Tab (Iframe + Process Logs)

### Backend changes
- `server/models.py`
  - Extended `BuildConfigIn` with `preview_cmd` and `preview_port`.
- `server/build_runner.py`
  - Persists `preview_cmd` and `preview_port` in `.ai-office/config.json` per project.

### Frontend changes
- `client/src/components/PreviewPanel.jsx`
  - New Preview tab UI:
    - Start/Stop/Restart preview process
    - Embedded iframe to `http://127.0.0.1:<port>`
    - Live process logs (polls `include_logs=true`)
    - Editable preview command + preferred port persisted to build config
    - Clear guidance when no port is detected (add `--port ####` / `-p ####`)
- `client/src/App.jsx`
  - Added `Preview` tab.
- `client/src/App.css`
  - Preview panel layout + iframe/log styling.

### Tests
- `tests/test_build_config_preview_fields.py`
  - Confirms preview config fields round-trip via build-config API.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - P0.6 Agent Credentials UI (Per-Agent Keys)

### Frontend changes
- `client/src/components/AgentConfig.jsx`
  - Added per-agent Credentials section when backend is `openai` or `claude`:
    - Save masked API key + optional base_url
    - Clear credentials
    - Shows whether a key is present and the masked last4

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - P1.1 Checkpoints (Create/List/Restore/Delete)

### Backend changes
- `server/checkpoints.py` (new)
  - Adds checkpoint helpers for git-backed checkpoints (commit + `checkpoint/...` tag) with zip fallback if no `.git`.
  - Restore is destructive and requires explicit confirm text: `RESTORE`.
- `server/routes_api.py`
  - Added new endpoints:
    - `GET /api/projects/{name}/checkpoints`
    - `POST /api/projects/{name}/checkpoints`
    - `POST /api/projects/{name}/checkpoints/restore`
    - `DELETE /api/projects/{name}/checkpoints/{checkpoint_id}`
- `server/models.py`
  - Added `CheckpointCreateIn`, `CheckpointRestoreIn`, `CheckpointOut`.

### Frontend changes
- `client/src/components/GitPanel.jsx`
  - Added a Checkpoints section to create/list/restore/delete checkpoints from the Git tab.

### Tests
- `tests/test_checkpoints_api.py`
  - Covers create/list/restore/delete via API on a temp project.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - P1.2 Oracle Tab (Project Search + Send Snippet)

### Backend changes
- `server/project_search.py` (new)
  - Adds a dependency-free, grep-like text search with safety caps and ignore rules.
- `server/routes_api.py`
  - Added Oracle search endpoints:
    - `GET /api/oracle/search?channel=...&q=...`
    - `GET /api/projects/{name}/search?q=...` (best-effort project search)
  - Updated file viewer endpoints to be channel/project scoped:
    - `GET /api/files/tree` now accepts `channel` and uses the active project sandbox root.
    - `GET /api/files/read` now accepts `channel` and reads from the active project sandbox root.

### Frontend changes
- `client/src/components/OraclePanel.jsx` (new)
  - UI for searching within the active project.
  - Actions per result: Open (jump to Files) and Send to Chat (prefills chat input with a snippet reference).
- `client/src/App.jsx`
  - Added `Oracle` tab.
  - Added minimal cross-panel wiring:
    - Oracle -> Files open request
    - Oracle -> Chat prefill
- `client/src/components/ChatRoom.jsx`
  - Accepts `prefillText` + `onPrefillConsumed` to support cross-panel snippet injection.
- `client/src/components/FileViewer.jsx`
  - Accepts `channel` and scopes browsing/reads to the active project.
  - Supports `openRequest` to open a file at/around a specific line (snippet view).

### Tests
- `tests/test_oracle_search_api.py`
  - Confirms Oracle search returns hits within the active project scope.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - P1.3 Blueprint Tab (Spec -> Architecture Map)

### Backend changes
- `server/blueprint_bank.py` (new)
  - Stores `blueprint-current.json` alongside spec artifacts and keeps history snapshots.
  - Generates a lightweight `{nodes, edges}` graph from the current spec markdown.
- `server/routes_api.py`
  - Added endpoints:
    - `GET /api/blueprint/current?channel=...`
    - `POST /api/blueprint/regenerate?channel=...`
  - Regeneration emits `blueprint_regenerated` console events for traceability.

### Frontend changes
- `client/src/components/BlueprintPanel.jsx` (new)
  - Renders a simple SVG graph of the blueprint.
  - Clicking a node jumps to Oracle search using the node's `search_terms`.
- `client/src/App.jsx`
  - Added `Blueprint` tab and Oracle prefill wiring.
- `client/src/components/OraclePanel.jsx`
  - Added `prefillQuery` support so other panels can open Oracle with a prepared query.

### Tests
- `tests/test_blueprint_api.py`
  - Saves a spec, regenerates blueprint, and validates shape via API.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 - Channel Workspace Build/Test CWD Fix

### Background
- Tool writes land in the active channel workspace repo (`.../<project>/<channel>/repo`), but build/test/run previously executed in the project root (`WORKSPACE_ROOT/<project>`).
- This caused verification loops and manual build commands to validate stale files (or the wrong directory) for non-app projects.

### Backend changes
- `server/build_runner.py`
  - Added `root_override` support for config auto-detection.
  - Added `cwd_override` support for `run_build`, `run_test`, and `run_start`.
- `server/project_manager.py`
  - Build config detection now prefers the active channel repo path.
- `server/routes_api.py`
  - `/api/projects/{name}/build`, `/test`, `/run` now accept optional `channel` and execute in that channel's sandbox root.
- `server/verification_loop.py`
  - Post-write verification now runs build/test in the active channel repo path.
- `server/agent_engine.py`
  - Sprint report and `/build run` / `/test run` / `/run start` now execute build/test/run in the active channel repo path.
- `server/autonomous_worker.py`
  - Autonomous verification now executes build/test in the active channel repo path.

### Tests
- Updated:
  - `tests/test_verification_loop.py`
  - `tests/test_warroom_mode.py`

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS
## 2026-02-18 | Project-first Work OS shell migration (P0 pass)
- Added project metadata persistence (last_opened_at, preview_focus_mode, layout_preset) and surfaced it through /api/projects.
- Added POST /api/agents/{agent_id}/credentials/test for per-agent OpenAI/Claude connection checks with latency reporting.
- Added channel_id aliases on create/import flows and metadata-aware project listing fields.
- Replaced legacy top-tab shell with new Home/Workspace/Settings structure, Create Home prompt flow, Projects sidebar, Workspace shell, layout presets, and preview focus mode.
- Added Codex mismatch startup banner with one-click repair and AgentConfig credential test UX.

## 2026-02-18 | Codex/OpenAI provider routing hardening + chat lock cleanup
- Added provider management API surface:
  - `GET /api/providers`
  - `POST /api/providers`
  - `POST /api/providers/test`
- Extended agent update model + persistence for `provider_key_ref` and `base_url` so runtime routing is per-agent and durable.
- Added provider config/secret storage tables and startup seed/migration path for codex defaults (`ollama/qwen2.5:14b` -> `openai/gpt-4o-mini`).
- Updated runtime credential resolution order in `server/agent_engine.py`:
  - agent credential -> provider key ref secret -> env fallback
  - base URL override resolution (agent -> credential -> provider config).
- Added `ProviderSettings` UI in Settings and wired AgentConfig with explicit provider key ref/base URL controls.
- Removed duplicate `/api/openai/status` and `/api/claude/status` route registrations so status responses are deterministic and include provider metadata.
- Fixed chat escape/back behavior wiring in workspace shell (`Back to Workspace` now returns Chat subview to Builder).
- Added regression coverage:
  - `tests/test_provider_endpoints.py`
  - `tests/test_codex_default_migration.py`
  - `tests/test_agent_engine_provider_key_routing.py`
  - Updated `tests/test_backend_unavailable_message.py` to clear provider secrets during the unavailable-backend assertion.

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-18 | Core reliability pass: provider diagnostics, no silent Ollama fallback, calmer workspace

### Provider and routing reliability
- Switched provider and credential connection tests to probe-based diagnostics instead of relying on generation:
  - `POST /api/providers/test`
  - `POST /api/agents/{agent_id}/credentials/test`
- Added structured test details in API models (`details`) so UI can show concrete failures (status code, URL, timeout, parsed provider error).
- Extended OpenAI and Claude clients/adapters with:
  - `probe_connection(...)`
  - `get_last_error()`
  - richer error extraction for non-200 responses and empty payloads.
- Hardened runtime error surfacing in `server/agent_engine.py`:
  - OpenAI/Claude empty responses now return explicit backend error text from adapter/client state.
  - Unknown backend values are treated as misconfiguration (explicit error), not silently routed to Ollama.
- Strengthened Codex backend enforcement:
  - Startup migration now upgrades any `codex` agent with `backend=ollama` to `openai/gpt-4o-mini` + `openai_default`.
  - `/api/agents/repair` now upgrades any `codex` Ollama config (not only legacy model signature).
  - App startup mismatch banner triggers whenever codex backend is Ollama.

### Chat lock + approvals UX hardening
- Added approval modal escape hatch in `ChatRoom`:
  - `Not now` dismiss action.
  - Esc now snoozes current approval instead of immediately re-opening it.
  - snoozed approvals stay in queue and can be reopened manually from Pending list.
- This prevents modal trap behavior while preserving approval audit flow.

### Workspace/UI calmness pass
- Refined workspace shell presets and controls:
  - true `split`, `full-ide`, `focus` behavior
  - split mode can collapse/show chat pane
  - full-ide retains left/right collapse controls
  - focus keeps preview-primary with optional chat drawer.
- Added calmer, denser visual treatment:
  - dark top header blending (reduced strip/shadow effect)
  - compact tab row, breadcrumb/meta styling, toned pane surfaces
  - compact chat mode spacing/typography adjustments in builder layouts.
- Added lightweight virtualization for projects list rendering in sidebar.

### Tests updated for new contracts
- Updated provider test suites to patch probe path:
  - `tests/test_provider_endpoints.py`
  - `tests/test_agent_credentials_test_endpoint.py`
- Updated pane-layout tests to current preset keys (`split`, `files-preview`):
  - `tests/test_project_ui_state_pane_layout.py`
  - `tests/test_project_ui_state_invalid_pane_layout.py`
- Updated brainstorm test to mock Ollama availability with the stricter backend check:
  - `tests/test_brainstorm_mode.py`

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `with-runtime.cmd client/dev-lint.cmd` PASS
- `with-runtime.cmd client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` FAIL (no local service listening on expected smoke port in this run)
- `with-runtime.cmd python tools/desktop_smoke.py` FAIL (`PORT_8000_READY=False`, `HEALTH_OK=False` in this run)

## 2026-02-19 | Prompt #17: Codex/OpenAI key flow hardening + registry sync overrides

### Backend routing and key pipeline
- Added provider runtime resolver: `server/provider_config.py`
  - DB settings first (`*.api_key_enc`, `*.base_url`, `*.model_default`)
  - then provider secret vault (`provider_secrets` via key_ref)
  - then env/.env fallback.
  - 10s in-memory TTL cache with explicit invalidation.
- Updated OpenAI and Claude clients to resolve runtime config through provider resolver:
  - `server/openai_client.py`
  - `server/claude_client.py`
- Updated agent credential resolution path:
  - `server/agent_engine.py` now uses unified provider resolver and emits explicit backend error events with actionable key hints.
  - No silent OpenAI->Ollama fallback path introduced.

### Codex default enforcement and registry sync
- Added per-field override tracking for agents:
  - new `agents.user_overrides` migration-safe column
  - `update_agent(..., mark_override=True)` marks edited fields as user-overridden.
- Added registry sync with override protection:
  - startup sync in `init_db()`
  - new API endpoint: `POST /api/agents/sync-registry?force=true|false`
  - non-force sync updates only non-overridden fields.
- Hardened codex migration behavior:
  - startup migration now repairs only known legacy Ollama codex signatures when backend/model are not user-overridden.
  - `POST /api/agents/repair` now uses legacy signature guard and sets `provider_key_ref=openai_default`.

### Provider settings contract and status clarity
- Added additive settings endpoints:
  - `GET /api/settings/providers`
  - `POST /api/settings/providers`
- Added model types:
  - `ProviderSettingsIn`, `ProviderSettingsOut`, `ProviderSettingsProviderOut`.
- Provider status endpoints now use unified runtime resolver:
  - `GET /api/openai/status`
  - `GET /api/claude/status`
  - include key source/masked key + credential availability.
- Improved provider test errors:
  - `POST /api/providers/test` now returns explicit hints/details for missing keys/network/base URL errors.
- Added console observability events for provider setting updates.

### UI updates for key flow and Codex visibility
- Added Settings API Keys panel:
  - `client/src/components/settings/ApiKeysPanel.jsx`
  - integrated in `client/src/components/settings/SettingsShell.jsx`
  - supports save/test for OpenAI + Claude, masked key display, fallback toggle.
- Updated AgentConfig visibility:
  - codex row now shows API readiness badge
  - explicit warning banners when OpenAI/Claude keys are missing.
- Updated codex mismatch detection in `client/src/App.jsx` to legacy signature guard (`ollama + legacy qwen`), reducing false positives.

### Security cleanup
- Sanitized local `.env` placeholders (no real key values retained in workspace file).
- Added startup env safety warnings in `server/main.py` for placeholder or likely exposed key patterns (without printing keys).
- Clarified startup Ollama warning text to avoid implying total outage when cloud providers are configured.

### Tests
- Added:
  - `tests/test_settings_providers_endpoint.py`
  - `tests/test_agents_sync_registry.py`
- Updated:
  - `tests/test_codex_default_migration.py`
  - `tests/test_agent_engine_provider_key_routing.py`

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-19 | Prompt #18: GPT-5.2/Opus defaults + Responses API routing + explicit fallback behavior

### Backend model defaults and runtime behavior
- Updated registry and migrations to align defaults:
  - Codex default model now `gpt-5.2-codex`
  - OpenAI provider default now `gpt-5.2`
  - Claude provider default now `claude-opus-4-6`
- Added provider default model migration guardrails in `server/database.py` so legacy defaults (`gpt-4o-mini`, Sonnet variants) are upgraded when not explicitly overridden.
- Implemented OpenAI Responses client (`server/openai_responses.py`) and routed GPT-5.x models through `/v1/responses` in `server/openai_client.py`.
- Added explicit HTTP error mapping for OpenAI Responses (401/403 key invalid, 404 model unavailable, timeout/service failures).
- Added response provenance metadata plumbing:
  - message `meta_json` persistence in DB
  - runtime metadata queued in `server/agent_engine.py` and saved with agent messages
  - includes provider/model/credential_source and fallback marker.

### No-silent-fallback enforcement
- `server/agent_engine.py` now enforces explicit behavior:
  - OpenAI/Claude failures return actionable error text with Settings path when fallback is disabled.
  - Ollama fallback runs only when `providers.fallback_to_ollama=true`.
  - fallback responses are explicitly labeled `(FALLBACK: OLLAMA)` and emit console events.

### Settings + Agent UI updates
- Updated Settings API key UX in `client/src/components/settings/ApiKeysPanel.jsx`:
  - OpenAI model choices include `gpt-5.2` / `gpt-5.2-codex`
  - Claude model choices include `claude-opus-4-6`
  - OpenAI reasoning effort control (`low|medium|high`)
  - improved diagnostics copy/details handling from provider tests.
- Rebuilt `client/src/components/settings/AgentConfigDrawer.jsx` for explicit credential source control:
  - Provider defaults vs per-agent override
  - save/test/clear override credential flow
  - effective runtime badge and key-missing warnings.
- Updated legacy config defaults in:
  - `client/src/components/AgentConfig.jsx`
  - `client/src/components/ProviderSettings.jsx`
  - `client/src/components/settings/ProviderCard.jsx`
- Added chat-level runtime provenance line in `client/src/components/ChatRoom.jsx` and `client/src/App.css`.

### Tests
- Added:
  - `tests/test_openai_responses.py` (output parsing + 401/404 mapping)
  - `tests/test_agent_engine_no_silent_fallback.py` (fallback disabled/enabled behavior)
- Extended:
  - `tests/test_agent_engine_provider_key_routing.py` (agent override beats provider default)
- Updated defaults/expectations to GPT-5.2/Opus in:
  - `tests/test_provider_endpoints.py`
  - `tests/test_agent_credentials_test_endpoint.py`
  - `tests/test_agents_repair_codex_defaults.py`
  - `tests/test_codex_default_migration.py`
  - `tests/test_backend_unavailable_message.py`
  - `tests/test_settings_providers_endpoint.py`

### Verification
- `with-runtime.cmd python -m pytest -q tests` PASS
- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `with-runtime.cmd python tools/runtime_smoke.py` PASS
- `with-runtime.cmd python tools/startup_smoke.py` PASS
- `with-runtime.cmd python tools/desktop_smoke.py` PASS
- `with-runtime.cmd python tools/toolchain_smoke.py` PASS
- `with-runtime.cmd python tools/personality_smoke.py` PASS

## 2026-02-19 | Prompt #21: Provider/model catalog + explicit model defaults + standardized diagnostics

### Backend changes
- Added `server/provider_models.py` as the single model catalog source:
  - OpenAI default: `gpt-5.2` (`GPT-5.2 Thinking`)
  - Claude default: `claude-opus-4-6` (`Claude Opus 4.6`)
  - Codex alias catalog (`Codex (via OpenAI)`) with default `gpt-5.2-codex`
- Extended `server/provider_config.py`:
  - catalog-driven default model resolution
  - new `model_catalog_snapshot()` with provider/model availability metadata
- Extended `server/routes_api.py`:
  - new `GET /api/settings/models`
  - upgraded `POST /api/providers/test` with standardized error codes:
    - `PROVIDER_UNREACHABLE`
    - `AUTH_INVALID`
    - `QUOTA_EXCEEDED`
    - `MODEL_UNAVAILABLE`
    - `UNKNOWN_ERROR`
  - actionable `hint` field and structured details for diagnostics
- Updated `server/database.py`:
  - provider normalization via catalog aliases
  - seed/migration/default-provider-model logic now driven from catalog
- Updated `server/models.py`:
  - provider request literals include `anthropic` alias
  - provider test output includes `error_code` + `hint`
  - new models for `/api/settings/models` response contract

### Frontend changes
- Settings now reads model options from backend catalog instead of hardcoded lists:
  - `client/src/components/settings/SettingsShell.jsx`
  - `client/src/components/settings/ApiKeysPanel.jsx`
  - `client/src/components/settings/AgentConfigDrawer.jsx`
- `ApiKeysPanel` now:
  - shows friendly model labels from backend
  - surfaces standardized test errors/hints
  - records diagnostics payloads for export/copy
- `AgentConfigDrawer` now:
  - uses backend model catalog for model picker entries/labels
  - keeps custom model support without forcing legacy defaults

### Tests
- Updated `tests/test_provider_endpoints.py`:
  - validates `/api/settings/models` defaults and friendly labels
  - validates provider test error-code mapping (quota example)

### Verification
- `with-runtime.cmd python -m pytest` PASS (`95 passed`)
- `with-runtime.cmd npm --prefix client run build` PASS

## 2026-02-19 | Prompt #23: Workspace de-clutter with activity bar, pinnable panes, focus mode, and sidebar collapse

### Workspace shell redesign
- Rebuilt `client/src/components/WorkspaceShell.jsx` around a calmer IDE model:
  - primary view selected from a left activity bar
  - optional secondary pane only when explicitly pinned and layout is `Split`
  - `Full IDE` now behaves as primary-only (no always-on secondary clutter)
- Added per-project workspace UI persistence in localStorage:
  - primary view
  - pinned secondary view
  - focus mode mirror state
  - split pane sizes (via split-pane persisted keys)
- Added keyboard navigation in Build mode:
  - `Ctrl+1..6` for Chat/Files/Git/Tasks/Spec/Preview
  - `Ctrl+,` opens Settings
  - `Ctrl+Shift+F` toggles Focus Mode
- Added first-run workspace coachmark and reset-layout action.

### Activity bar and sidebar
- Updated `client/src/components/ActivityBar.jsx`:
  - supports Settings entry
  - shortcut hints in tooltips
  - compact mode support.
- Reworked `client/src/components/ProjectsSidebar.jsx`:
  - collapse/expand behavior
  - collapsed slim rail mode
  - project search
  - pin/unpin project affordance
  - virtualization retained for expanded list.
- Wired sidebar collapse state through `client/src/App.jsx` and persisted per project.

### Preview UX in workspace
- Updated `client/src/components/PreviewPanel.jsx` and `client/src/styles/preview.css`:
  - added in-panel device width presets (mobile/tablet/desktop)
  - added explicit Reload and Open controls in Live Preview header
  - wrapped iframe in a framed stage for clearer visual hierarchy.

### Styling and layout consistency
- Added extensive workspace layout styles in `client/src/App.css` for:
  - activity bar rail
  - view pane headers/actions
  - coachmark card
  - split-pane visuals/cursor/drag feedback
  - collapsed and expanded project sidebar modes.

### Verification
- `cd client && npm run build` PASS
- `with-runtime.cmd python -m pytest` PASS (`95 passed`)

## 2026-02-19 | Prompt #24 (V2): Chrome/theme unification + split reliability + Home draft preservation

### App chrome + theme unification
- Updated `client/src/App.css` top chrome styling to use the same dark surface tokens as workspace panels:
  - blended topbar gradient from `--panel/--bg1`
  - subtle divider + shadow token usage
  - no hard light strip behavior in dark mode
- Added explicit compact-menu styling (`.app-header-compact-menu`, popover, rows) so responsive header controls render with themed surfaces instead of browser defaults.
- Updated `client/index.html` with dark first-paint fallback (`data-theme="dark"` + body background/text) to avoid white flash before React mounts.

### Home “chat to create” message capture + discuss-first pipeline
- Fixed `client/src/App.jsx` draft update normalization:
  - `updateCreationDraft` now always passes through `buildCreationDraft(...)` (including functional updaters) so full prompt/raw request fields stay canonical.
- Wired draft seed persistence into project creation:
  - `createProjectFromDraft` now calls `persistDraftSeedToProjectSpec(...)` before draft clear/navigation.
  - original request is preserved in seeded Spec/Idea Bank payloads.
- Updated `client/src/components/CreationPipeline.jsx` discuss CTA label to `Proceed to Build` for the explicit discuss->plan->build handoff.
- Enhanced `client/src/components/discuss/DraftDiscussView.jsx` with a compact auto-generated intake summary (clarifying bullets) and explicit actions:
  - `Proceed to Build`
  - `More Ideas`
  - `Edit Prompt in Home`

### Split/layout reliability and regression safety
- Confirmed active workspace uses unified `SplitPane` implementation and persisted pane keys.
- Fixed `client/src/App.jsx` structural issue where sidebar persistence `useEffect` hooks had drifted outside the component; hooks restored inside component lifecycle.
- `Reset Layout` path remains wired to clear persisted pane-size keys (`ai-office:paneSizes:*`) for recovery from corrupted state.

### Verification
- `cd client && npm run build` PASS
- `with-runtime.cmd python -m pytest -q tests` PASS (`95 passed`, warnings only)

## 2026-02-19 | Prompt #25: Reliable Home -> Create -> Discuss -> Spec -> Build pipeline

### Creation draft model + persistence hardening
- Expanded `client/src/lib/storage/creationDraft.js` to support durable draft identity and richer pipeline state:
  - per-draft storage keys (`aiOffice.creationDraft:<draftId>`) plus current draft pointer
  - `draftId`, `seedPrompt`, `projectName`, `stackHint`, `brainstormMessages`, `specDraft`, and `phase` aliases
  - explicit phase mapping (`DISCUSS`, `SPEC`, `READY_TO_BUILD`, `BUILDING`)
  - helper support for listing drafts and loading by draft id.

### Dedicated create routing and no premature workspace jump
- Refactored `client/src/App.jsx` to parse/push app paths:
  - `/` -> Home
  - `/create` and `/create/:draftId` -> Create flow
  - `/workspace` -> Workspace
  - `/settings` -> Settings
- Home submit now routes to `/create/:draftId` and never creates a project directly.
- Create route loads draft by id and resumes safely after refresh.
- Added a dev-only creation draft JSON inspector (`Creation Draft Debug`) while on create route.

### Discuss -> Spec -> Build gating improvements
- Updated `client/src/components/CreateProjectWizard.jsx`:
  - prompt capture safety guard (state vs ref mismatch check)
  - explicit submit validation (`Prompt not captured, try again.` + console diagnostics)
  - Enter/Shift+Enter behavior changed to:
    - Enter = continue
    - Shift+Enter = newline
  - draft seed now created with explicit phase metadata before routing.
- Updated `client/src/components/CreationPipeline.jsx`:
  - spec approval no longer starts build immediately
  - `Approve Spec` transitions to `READY_TO_BUILD`
  - separate explicit `Start Build` action is now the only trigger for project creation/scaffolding.
- Updated `client/src/components/discuss/DraftDiscussView.jsx`:
  - added `Generate ideas` action wired to new brainstorm API
  - brainstorm output updates draft summary + `brainstormMessages`
  - retained lightweight `More Ideas` flow.

### Home/Create UX refinements
- Updated `client/src/components/CreateHome.jsx`:
  - create-only mode for dedicated `/create` flow
  - `Resume Draft` card on Home to continue existing draft without loss.
- Added supporting styles in `client/src/App.css` and `client/src/styles/draft-discuss.css`.

### Backend creation draft + brainstorm/spec APIs
- Extended `server/database.py` with migration-safe `creation_drafts` table and CRUD helpers:
  - `upsert_creation_draft`
  - `get_creation_draft`
  - `list_creation_drafts`
- Added new models in `server/models.py`:
  - `CreationDraftIn/Out`
  - `CreationBrainstormIn/Out`
  - `CreationSpecIn/Out`
- Added new routes in `server/routes_api.py`:
  - `POST /api/creation/draft`
  - `GET /api/creation/draft/{draft_id}`
  - `PUT /api/creation/draft/{draft_id}`
  - `POST /api/creation/brainstorm`
  - `POST /api/creation/spec`
- Brainstorm/spec generation is deterministic and structured (scope, assumptions, risks, questions, milestones, DoD) to support beginner-safe pipeline progression.

### Tests
- Added `tests/test_creation_flow_api.py` covering:
  - draft round trip with multiline seed prompt preservation
  - draft phase transitions (`DISCUSS` -> `READY_TO_BUILD`)
  - no project side-effects from draft-only API usage
  - brainstorm/spec endpoint behavior.

### Verification
- `with-runtime.cmd python -m pytest -q tests/test_creation_flow_api.py` PASS
- `with-runtime.cmd python -m pytest -q tests` PASS (warnings only)
- `cd client && npm run build` PASS
## 2026-02-19 - Prompt #004 Create Project UX Simplification
- Rebuilt the Create Project wizard into a cleaner 3-step flow: Describe > Review > Create with simplified copy and clearer step intent.
- Replaced starter templates with a curated set (Blank Guided, React app, FastAPI API starter, Dashboard, Python CLI, Import Existing Project) and richer metadata (stack preset, bullets, recommended badge).
- Upgraded template cards and import UX: import is now a focused expandable path and auto-expands when the Import template is selected.
- Improved Review + Summary confidence surfaces: editable name, stack override, template summary, command preview, target path, and potential issue hints.
- Wired Create step to project creation handler with destination hinting (Workspace/Spec/Preview), while preserving Discuss-first as an explicit secondary action.
- Updated styles for calmer layout hierarchy, tighter spacing, and responsive summary behavior.
## 2026-02-19 - Prompt #005 Preview UX Simplification
- Preview UI overload: too many panels visible at once.
- User doesn't know what to click first.
- URL detection is hidden behind logs.
- Refactored Preview into tabs (Preview, Logs, Advanced, Design) with a unified top bar and 1-click Start Preview command resolution.
- Added manual URL override flow, reduced duplicate URL actions, and made iframe the primary surface while running.
- Logs now request include_logs only when Logs tab is active and support pause/resume updates.

## 2026-02-19 - Prompt #006 Settings "Fix My Setup"
- Added a new General-tab setup checklist that derives status from existing providers, local diagnostics, agents, and active project context.
- Added one-click jump actions (`Providers`, `Providers > Test`, `Agents`, `Workspace`) with localStorage focus targeting.
- Implemented section highlight + auto-scroll behavior in Providers, Agents, and Advanced views for actionable routing.
- Reduced Settings dead space by restructuring General into compact summary, checklist block, and collapsible beginner/reset controls.
## 2026-02-19 - Prompt #007 Workspace declutter + delayed tooltips
- Added a global delayed tooltip layer (`data-tooltip`) with a 1400ms delay, anchored positioning, and dismiss on leave/scroll/escape/route plus workspace mode/view changes.
- Applied actionable tooltips across high-impact controls in Workspace toolbar, Activity bar, Discuss actions, Office Board labels/actions, and compact Chat header controls.
- Reworked Discuss mode defaults for calmer first load: participants collapsed by default, Office Board hidden by default, and full-width chat when the board is closed.
- Added persisted Discuss UI state per project (`participants-collapsed`, `board-open`) and optional auto-open of Office Board once per session when saved board content already exists.
- Added Office Board inline guidance and content-change events so Discuss can react to board content presence without backend changes.
- Added `ChatEmptyState` and filtered runtime-smoke artifacts from visible conversation rendering to avoid fake conversation noise.
- Simplified compact Chat header hierarchy and protected channel title rendering so error-like channel names no longer appear as room titles.
## 2026-02-19 - Prompt #008 Discuss as Office Meeting flow
- Reframed Discuss as an explicit “Office Meeting” pipeline with compact step pills: Brainstorm -> Capture -> Handoff -> Build.
- Added deterministic brainstorm prompt formatting requirements and UI-side parser for `Goals`, `Open Questions`, `Decisions`, `Next Actions`, and `Risks`.
- Wired structured brainstorm capture so valid agent responses auto-populate Meeting Output and open the board; parse failures show a warning with `Re-run with structure`.
- Upgraded Office Board into “Meeting Output (Office Board)” with new `Next Actions` and optional/collapsible `Risks` sections.
- Added Office Board one-click actions: `Send to Spec`, `Send to Tasks`, and `Clear`, each with delayed tooltip guidance.
- Implemented frontend-only handoff storage:
  - `ai-office:spec-draft:<projectId>` (plus SpecPanel-compatible draft cache key)
  - `ai-office:tasks-draft:<projectId>`
- Added Discuss start-build guard: empty board triggers confirmation modal (`Capture first` / `Build anyway`); populated board auto-handoffs to Spec before switching to Build.
- Added optional visible-message callback from ChatRoom so Discuss can observe agent replies and process structured brainstorm outputs without backend changes.
## 2026-02-19 - Prompt #009 Theme Gallery + Scheme Cycling
- Added a layered theme system: `data-theme` for light/dark and `data-scheme` for curated color schemes, applied at root and persisted per user.
- Added theme catalog module (`midnight`, `slate`, `nord`, `ember`, `forest`, `violet`, `rose`, `sand`) with normalization and cycling helpers.
- Added scheme token overrides in `styles/schemes.css` so accent/focus/status tokens change globally without per-component hardcoded colors.
- Added legacy-safe theme key migration and new persistence keys:
  - `ai-office:themeMode`
  - `ai-office:themeScheme`
- Updated Settings > Appearance with a Theme Gallery grid, instant apply on click, and a `Cycle Theme` action.
- Added one-click header cycle button (`🎨`) with tooltip and compact-menu parity.
- Updated Settings summary to show current mode + scheme and passed scheme controls through Settings shell.
## 2026-02-19 - Prompt #010 Stabilize App Shell (history + mode/scheme + full-window)
- Repro: fresh launch on Home, pressing Back could route to Workspace due custom fallback routing; theme mode/scheme persistence used mixed keys and wrapper attributes; Workspace felt boxed because shell/canvas padding framed panes.
- Root cause: `App.jsx` used in-memory nav fallback instead of marked history state, scheme storage used legacy key naming, and multiple `App.css` shell layers applied outer canvas padding.
- Fix: introduced marked browser history state contract (`__aiOfficeNav`, `topTab`, `workspaceTab`, `draftId`, `navIndex`) with safe back behavior, switched to canonical theme keys (`ai-office:themeMode`, `ai-office:colorScheme`) with legacy read/write compatibility, kept theme attributes on `document.documentElement` only, and removed outer workspace canvas/shell padding so layout fills the window under the header.
## 2026-02-19 - Startup freeze perf investigation
- Repro path investigated: cold launch -> Home idle 10s. Prior behavior analysis showed high-frequency timers in `client/src/components/Sidebar.jsx` and `client/src/components/DashboardHome.jsx`.
- Baseline request pressure (12-channel fixture, 10s window):
  - Sidebar: ~29 requests (polling `/api/channels`, `/api/agents`, 3 provider status endpoints, plus per-channel `/api/messages/{channel}?limit=100` unread sync at t0 and t+5s).
  - DashboardHome: ~19 requests (7 summary endpoints + per-channel `/api/conversation/{channel}` loop).
  - Total startup pressure: ~48 requests / 10s before any user action.
- Top spam endpoints before fix:
  1. `/api/messages/{channel}?limit=100`
  2. `/api/conversation/{channel}`
  3. `/api/process/list/{channel}` (from adjacent legacy panels when mounted)
  4. `/api/channels`
  5. `/api/agents`
- Fix summary:
  - Added cheap summary APIs: `GET /api/channels/activity` and `GET /api/dashboard/summary`.
  - Sidebar unread now uses activity snapshots + local seen message ids (`New` badge), no history downloads and no 5s unread storm.
  - DashboardHome now loads one summary payload and lazy-loads heavy cards only on demand.
  - Added `useVisibilityInterval` and abort/dedupe guards to stop hidden-tab polling and overlap.
  - Added dev-only startup request meters for Home/Sidebar to validate first-10s request counts in browser console.

## 2026-02-19 - Regression triage (last 2 hours)
- Suspect commit: `f8a4a5e` (`perf-stop-startup-request-storms-sidebar-unread-dashboard-batching-visibility-aware-polling`).
- Files touched in suspect range:
  - `client/src/App.jsx`
  - `client/src/App.css`
  - `client/src/components/DashboardHome.jsx`
  - `client/src/components/Sidebar.jsx`
- Symptom mapping:
  - Infinite `Loading workspace...` hang: global app render was still hard-gated by `loading` in `App.jsx` with no timeout/abort safety.
  - Back/Home confusion: history state was updated, but startup failure path still left users stuck behind workspace loader and made navigation feel broken.
  - Theme/scheme inconsistency reports: app state could appear stale while stuck in boot gate, making mode/scheme changes look non-functional.
  - Maximize/fullscreen complaints: desktop controls had brittle runtime detection and broken glyph rendering, so maximize/restore affordance was unreliable.

## 2026-02-19 - Prompt #010 retail startup hotfix (unbrick + bounded boot)
- Replaced blocking startup gate with a bounded boot state machine in `client/src/App.jsx`:
  - `bootState: idle | booting | ready | partial | error`
  - step-level status for `projects`, `active workspace`, and `providers`
  - global hard timeout (`10s`) and per-request timeout (`8s`) with abort.
- Added `client/src/utils/fetchWithTimeout.js` and moved startup-critical requests to timeout + typed error handling (`TIMEOUT`, `NETWORK`, `HTTP`, `ABORT`).
- Startup is now non-blocking:
  - Home/Create/Settings render immediately during boot.
  - Workspace uses a local loader card with step status + timer + actions (`Retry`, `Open Settings`, `Continue to Home`).
  - Added top startup banner for `partial/error` states; no silent infinite loading.
- Removed Home auto-polling by default in `client/src/components/DashboardHome.jsx` (manual refresh only).
- Desktop maximize/fullscreen affordance hardened in `client/src/components/DesktopWindowControls.jsx`:
  - desktop API is checked live (not once at first render)
  - control glyphs replaced with stable ASCII labels.
- Before/After first-10s request pressure (dev startup meter + endpoint audit):
  - Before: ~48 requests / 10s under cold start stress path.
  - After: 3 startup API requests on Home boot (`/api/projects`, `/api/projects/active/main`, `/api/providers`) and no Home polling interval by default.

## 2026-02-22 - Round 4 Phase 0 hardening (db verify + policy unification + token budgets)
- Added explicit schema verification in `server/database.py`:
  - Parses table DDL fragments from `SCHEMA`
  - Creates any missing required tables individually
  - Verifies required tables before and after migrations with a high-signal log (`Database: X/26 tables verified`)
  - Raises runtime errors with missing/failed table names instead of silently continuing.
- Unified command authorization to `server/policy.py` as the single authority:
  - Removed duplicate allow/block command lists and stale `_is_command_allowed` logic from `server/tool_gateway.py`
  - Added quote-aware shell-meta detection (`find_unquoted_shell_meta`) to block only unquoted chaining/redirection operators.
- Expanded SAFE-mode command patterns in `server/policy.py` for practical local dev workflows (python/py/pytest/pip/npm/npx/mkdir/cat/echo/local curl) while retaining blocked-pattern guards.
- Increased generation token budgets in `server/agent_engine.py`:
  - builder/codex/architect: OpenAI/Claude 2400, Ollama 1600
  - other roles: OpenAI/Claude 800, Ollama 600
  - applied to direct backend calls and Ollama fallback path.
- Added coverage in `tests/test_policy_command_shape.py` for quote-aware shell parsing and SAFE-mode practical command allowance after approval.

## 2026-02-23 - Round 4 workspace simplification + console integration
- Simplified workspace information architecture to a calmer default:
  - Activity bar now defaults to three primary views (`Chat`, `Files`, `Preview`).
  - Advanced views (`Spec`, `Tasks`, `Git`) moved behind workspace actions while remaining directly reachable.
  - Removed the Discuss/Build mode switch from the workspace toolbar.
- Rebuilt `client/src/components/WorkspaceShell.jsx` around one primary build surface with optional split secondary pane.
- Integrated `client/src/components/ConsolePanel.jsx` into workspace as a collapsible bottom dock:
  - Open/closed state persists per project.
  - A lightweight probe (`/api/console/events/{channel}?limit=20`) auto-opens the dock when error/critical events are detected.
- Added first-message quick-start affordances to empty chat:
  - `client/src/components/chat/ChatEmptyState.jsx` now exposes starter prompt chips.
  - `client/src/components/ChatRoom.jsx` pre-fills and focuses the composer from starter chips.
