# AI OFFICE — Handoff Prompt

You are picking up an ongoing project called **AI Office** — a local multi-agent team chat application. Read this entire prompt before doing anything.

---

## LATEST STATUS UPDATE (2026-02-17)
- Baseline snapshot locked and tagged:
  - commit: `5f18d9c`
  - tag: `baseline-2026-02-17-prof1`
- EPIC 0 portability/test determinism hardening added:
  - canonical runtime exports via `server/runtime_config.py`
  - `WORKSPACE_ROOT` env support (`AI_OFFICE_WORKSPACE_ROOT`, legacy `AI_OFFICE_PROJECTS_DIR`)
  - one-command setup scripts:
    - `scripts/dev_setup.ps1`
    - `scripts/dev_setup.cmd`
  - test isolation helper `tests/helpers/temp_db.py`
  - `pytest.ini` with deterministic defaults
  - `server/database.py` now respects `AI_OFFICE_TESTING=1` for forced temp DB routing
- EPIC 1 permission/autonomy governance added:
  - channel permission policy API (`locked|ask|trusted`) with trusted-session expiry
  - approval request persistence + websocket handshake (`approval_request` / `approval_resolved`)
  - tool executor now pauses on approval-required calls and resumes on response
  - audit logs now include approval metadata (`channel`, `task_id`, `approval_request_id`, `policy_mode`, `reason`)
  - audit export/filter extension (`/api/audit/export`, channel/task/risk filters)
  - ChatRoom approval modal and trust-window selector
  - new tests:
    - `tests/test_permission_policy_api.py`
    - `tests/test_tool_approval_handshake.py`
    - `tests/test_trusted_mode_expiry.py`
- EPIC 2 foundation pass added:
  - task schema now includes `channel` + `project_name` scoping
  - task create/list APIs now accept channel/project filters
  - new `server/runtime_manager.py` for channel workspace venv/runtime rewriting
  - non-app project paths now resolve to channel workspace `repo` directories
  - channel workspace structure now materialized with `repo/artifacts/skills/venv/logs`
  - policy scopes now enforced for `run`/`write` plus `pip`/`git` mutations
- Portability, env overrides, and test isolation are active:
  - centralized runtime path module (`server/runtime_paths.py`)
  - env override contract (`AI_OFFICE_HOME`, `AI_OFFICE_DB_PATH`, `AI_OFFICE_MEMORY_DIR`, `AI_OFFICE_PROJECTS_DIR`)
  - `tests/conftest.py` enforces temp DB/memory/projects and bootstraps isolated DB schema
- Autonomy/process/observability upgrades are implemented:
  - autonomy policy engine (`server/policy.py`)
  - channel process manager + kill switch (`server/process_manager.py`)
  - verification loop extraction (`server/verification_loop.py`)
  - console event persistence + API (`/api/console/events/{channel}`)
  - skills plugin loader + create/reload APIs
- Frontend wiring completed:
  - Console tab in `client/src/App.jsx`
  - Project autonomy/process controls + branch/merge controls in `client/src/components/ProjectPanel.jsx`
  - branch-aware task board controls in `client/src/components/TaskBoard.jsx`
  - branch-aware Git panel merge workflow in `client/src/components/GitPanel.jsx`
  - kill switch + autonomy badge + `Project @ branch` header in `client/src/components/ChatRoom.jsx`
- Multi-branch orchestration polish is now implemented:
  - DB: task `branch` field + `channel_branches` state table
  - APIs:
    - `GET /api/projects/{name}/branches`
    - `POST /api/projects/{name}/branches/switch`
    - `POST /api/projects/{name}/merge-preview`
    - `POST /api/projects/{name}/merge-apply`
  - task filtering: `GET /api/tasks?branch=<name>`
  - branch-aware task defaulting on `POST /api/tasks`
- Added new backend tests:
  - `test_autonomy_policy.py`
  - `test_process_manager.py`
  - `test_verification_loop.py`
  - `test_tool_format_compliance.py`
  - `test_skills_plugin_loader.py`
  - `test_create_skill_tool.py`
  - `test_project_scoped_memory.py`
  - `test_console_events_api.py`
  - `test_branch_context_api.py`
  - `test_task_branch_assignment.py`
  - `test_merge_preview_api.py`
  - `test_merge_apply_conflict_handling.py`
  - `test_project_switch_branch_persistence.py`
  - `test_agent_branch_prompt_context.py`
- Latest checks pass:
  - `python -m pytest -q tests` (`52 passed`)
  - `client/dev-lint.cmd`
  - `client/dev-build.cmd`
  - `tools/runtime_smoke.py`
  - `tools/startup_smoke.py`
  - `tools/desktop_smoke.py`
  - `tools/toolchain_smoke.py`
  - `tools/personality_smoke.py`
- EPIC 2.3 process manager hardening completed:
  - process starts are now policy-aware (autonomy + channel permission policy)
  - process start blocks on port collisions (managed + external)
  - process payload includes `port`, `policy_mode`, `permission_mode`
  - kill switch now resets both project autonomy (`SAFE`) and channel approvals (`ask`)
  - shutdown lifecycle now stops all managed channel processes
  - UI process controls upgraded with logs/port quick-open/status badges in ProjectPanel + ChatRoom
- Updated process test coverage in `tests/test_process_manager.py`:
  - lifecycle + kill switch permission reset
  - collision guard
  - locked-mode policy block
- EPIC 3.1 executor state machine completed:
  - `server/autonomous_worker.py` now runs explicit `PLAN -> GATE -> EXECUTE -> VERIFY -> DELIVER`
  - phase transitions persist as console `work_phase` events with task/attempt metadata
  - per-step retries + per-task verify retry budget implemented
  - task execution now scoped by active `channel + project` in worker selection
  - `/work approve` command support added in `server/agent_engine.py`
  - trusted + auto-proceed sessions skip gate; ask mode requires explicit gate approval
- Added state-machine tests:
  - `tests/test_executor_state_machine.py`
- Debuggability improvements added:
  - `POST /api/debug/bundle` returns a redacted zip with console/tool/task/process/permission snapshots
  - Debug tab added in UI for one-click bundle export
  - Copy UX: per-message copy, console copy (JSON/Markdown), audit entry copy (JSON)
  - `with-runtime.cmd` now prefers Python 3.12 so `with-runtime.cmd python -m pytest` is reproducible
  - new test: `tests/test_debug_bundle_export.py`
- Permission grants API added:
  - `POST /api/permissions/grant`
  - `POST /api/permissions/revoke`
  - new test: `tests/test_permission_grants_api.py`
- Tool run execution modernized:
  - `server/tool_gateway.py` now runs commands via `create_subprocess_exec(*argv)` (no shell by default)
  - `POST /api/tools/run` supports structured `{cmd:[...], cwd, env, timeout}` payloads
  - `npm`/`npx` executed via `node` + `npm-cli.js`/`npx-cli.js` for reliability
  - new test: `tests/test_tool_run_argv_exec.py`
- Process tool tags added (agent-usable background process control):
  - `[TOOL:start_process]`, `[TOOL:stop_process]`, `[TOOL:list_processes]`, `[TOOL:tail_process_logs]`
- Current backend test count: `52 passed`

---

## WHAT IT IS
A Slack/Discord-like app where the user collaborates with 17 configured agents (including router) in a group chat. Agents have distinct personalities, talk to each other (not just respond to the user), and can use tools to read/write files and run commands. Backend is FastAPI + SQLite + WebSocket. Frontend is React/Vite. Desktop wrapper is PyWebView. AI is powered by local Ollama models + Claude/OpenAI APIs for premium agents.

## WHERE IT LIVES
- **Project:** `C:\AI_WORKSPACE\ai-office`
- **GitHub:** https://github.com/ainick2469-sudo/AIOffice.git
- **Dev log:** `C:\AI_WORKSPACE\ai-office\DEVLOG.md` ← READ THIS FIRST. It has the complete history of every feature built across 7 sessions.
- **System overview:** `C:\AI_WORKSPACE\ai-office\docs\SYSTEM_OVERVIEW.md`
- **Agent registry:** `C:\AI_WORKSPACE\ai-office\agents\registry.json` (all 14 agents with full personality prompts)

## HOW TO RUN
```
cd C:\AI_WORKSPACE\ai-office
python start.py
```
Frontend dev: http://localhost:5173 | Production: http://localhost:8000

## TECH STACK
- **Backend:** Python 3.12, FastAPI, aiosqlite, WebSocket, uvicorn
- **Frontend:** React 19, Vite, react-markdown, react-syntax-highlighter
- **Desktop:** PyWebView
- **AI Models:** Ollama (qwen3:1.7b router, qwen2.5:14b most agents, qwen2.5-coder:32b for Max) + Anthropic Claude API (Nova, Scout)
- **API key:** Already in `.env` file

## THE 17 AGENTS
| ID | Name | Role | Backend |
|----|------|------|---------|
| router | Router | Message classifier | ollama/qwen3:1.7b |
| spark | Spark 💡 | Creative Ideator | ollama |
| architect | Ada 🏗️ | System Architect | ollama |
| builder | Max 🔨 | Builder / Programmer | ollama/qwen2.5-coder:32b |
| reviewer | Rex 🔍 | Code Reviewer (skeptical) | ollama |
| qa | Quinn 🧪 | QA / Testing (methodical) | ollama |
| uiux | Uma 🎨 | UI/UX Designer | ollama |
| art | Iris 🎭 | Visual Design | ollama |
| producer | Pam 📋 | Producer / PM (pragmatic) | ollama |
| lore | Leo 📖 | Lore / Narrative | ollama |
| director | Nova 🧠 | Director / Tech Lead | claude |
| researcher | Scout 🔭 | Deep Researcher | claude |
| sage | Sage 🌿 | Scope Guardian / Realist | ollama |
| codex | Codex | Implementation Overseer | openai |
| ops | Ops ⚙️ | DevOps / Reliability | ollama |
| scribe | Mira 📝 | Technical Writer | ollama |
| critic | Vera 🧭 | Formal Critic / Red Team | ollama |

All agents have deep, distinct personalities with anti-sycophancy rules. They disagree, debate, and challenge each other. Rex finds problems. Quinn asks "what if this breaks?" Sage calls out scope creep. Spark throws wild ideas. Read registry.json for full prompts.

## KEY BACKEND FILES
- `server/agent_engine.py` — The heart. Living conversation loop. Agents respond to user AND each other. 1000 msg cap. User can interrupt anytime.
- `server/router_agent.py` — LLM routing (qwen3:1.7b) + keyword fallback. Picks 2-4 agents per message.
- `server/tool_executor.py` — Parses [TOOL:read/run/search/write] from agent messages, executes them.
- `server/tool_gateway.py` — Sandboxed file/command tools. Everything restricted to project directory.
- `server/claude_client.py` — Anthropic API client for Nova and Scout.
- `server/database.py` — SQLite schema: messages, tasks, decisions, tool_logs, agents.
- `server/routes_api.py` — All 25+ REST endpoints.
- `server/distiller.py` — Extracts durable facts from conversations into memory.
- `server/memory.py` — JSONL memory read/write (shared + per-agent).

## KEY FRONTEND FILES
- `client/src/App.jsx` — multi-tab workspace: Home, Chat, Tasks, Files, Search, Decisions, Audit, Controls, Projects, Git, Agents
- `client/src/components/ChatRoom.jsx` — Main chat with conversation status + stop button
- `client/src/components/Sidebar.jsx` — Channels, DMs, staff list
- `client/src/components/AgentConfig.jsx` — Agent backend/model/prompt/status editor
- `client/src/components/TaskBoard.jsx` — Kanban board (Backlog → In Progress → Review → Done)
- `client/src/components/FileViewer.jsx` — Browse + preview project files
- `client/src/components/MessageContent.jsx` — Markdown + syntax highlighting
- `client/src/components/ProjectPanel.jsx` — project lifecycle + build/test/run config panel
- `client/src/components/GitPanel.jsx` — project git status/log/diff + commit/branch controls
- `client/src/hooks/useWebSocket.js` — WebSocket with auto-reconnect

## WHAT'S ALREADY DONE (don't rebuild these)
✅ Multi-agent chat (main room + DMs)
✅ Agent-to-agent conversation (living loop)
✅ User interrupt system
✅ 14 agents with deep personalities
✅ Memory system (shared + per-agent JSONL + distiller)
✅ Tool gateway (read/search/run/write, sandboxed, audited)
✅ Markdown rendering + syntax highlighting
✅ Task board (Kanban UI + CRUD API)
✅ File viewer (browse + preview)
✅ Search panel (cross-channel)
✅ Agent profiles
✅ Decision log panel
✅ Release gate (multi-agent review)
✅ Office Pulse (scheduled check-ins)
✅ Claude API integration
✅ OpenAI API integration (Codex)
✅ Channel auto-naming
✅ Desktop app (PyWebView)
✅ Anti-sycophancy personality rules
✅ Agent config API + UI

## WHAT NEEDS TO BE BUILT NEXT

### 🔴 High Priority
1. **Stage 0 git baseline** in an environment with git available:
   - baseline commit
   - baseline tag
   - branch from clean snapshot.
2. **Multi-branch task orchestration polish**:
   - branch-specific task assignment UX
   - safer merge workflows and conflict surfacing.

### 🟡 Important
3. **Router/conversation quality tuning**:
   - reduce repetitive follow-up loops
   - improve deterministic responder diversity over long discussions.
4. **Cost dashboard enhancements**:
   - richer model/provider breakdowns
   - configurable warning tiers and optional hard stop controls per channel/project.
5. **Agent config UX upgrades**:
   - prompt templates
   - edit history / rollback metadata.

### 🟢 Nice to Have
6. **Dashboard expansion** for branch/project aware KPIs and trend charts.
7. **Execute panel hardening**:
   - add richer sandbox policy controls and richer output rendering.
8. **Theme and startup polish**:
   - persist/startup preference controls in settings UI.

## KNOWN ISSUES
- Router sometimes still favors Pam for general messages — may need prompt tuning
- Conversation quality varies — some rounds agents repeat themselves
- Frontend dev server is Vite (port 5173), production build served by FastAPI (port 8000) — make sure to rebuild (`npm run build`) after frontend changes if testing via app.py
- Clear `__pycache__` if routes 404 after backend edits
- Database resets when you delete `data/office.db` — memories persist in `memory/*.jsonl`

## RULES
- Work in segments, not marathons. Don't try to do everything in one response.
- Don't rebuild things that already work. Read DEVLOG.md first.
- Test changes before declaring them done.
- Commit to git after meaningful batches of work.
- The user wants this to feel like a REAL office — agents should have friction, debate, personality. Not a yes-bot farm.
 
---  
 
## SESSION 9 UPDATE (2026-02-15) 
 
- App Builder workflow was added and is live. 
  - API: POST /api/app-builder/start 
  - UI: Controls tab to App Builder section 
  - Seeds tasks, posts structured kickoff, and starts agent conversation loop. 
- Tool run now supports subdirectory targeting. 
  - Example: [TOOL:run] @client npm run build 
- Command policy expanded for full app delivery (npm install/ci/dev/build/test + scaffold). 
- Shell chaining and redirection are blocked in tool-run commands. 
- Validation status: runtime/startup/desktop/toolchain smoke and frontend lint/build all pass.
 
## SESSION 10 UPDATE (2026-02-15) 
- Added new staff: Ops (DevOps), Mira (Scribe), Vera (Critic). 
- Added Ollama model readiness APIs: GET /api/ollama/models/recommendations and POST /api/ollama/models/pull. 
- Controls tab now includes model readiness + pull missing models action. 
- Added CLI helper: tools/pull_staff_models.py. 
- Routing/engine now include ops/scribe/critic in selection and anti-groupthink logic.

## SESSION 39 UPDATE (2026-02-17)

- Process lifecycle reliability (no "python ghosts"):
  - Persist process records in DB (`managed_processes`) on start/stop/exit.
  - Windows termination now uses `taskkill /T /F` as needed to kill process trees.
  - New APIs:
    - `GET /api/process/orphans`
    - `POST /api/process/orphans/cleanup`
  - Startup logs when orphan processes are detected (so the user can clean up).
- Tests: added `tests/test_process_registry_recovery.py`.
- Verification: backend `pytest`, all smoke scripts, and frontend lint/build pass (run via `with-runtime.cmd` to avoid PATH fragility).

## SESSION 40 UPDATE (2026-02-17)

- Permission grants UX (targeted approvals instead of broad trust sessions):
  - Policy now surfaces `missing_scope` for pip/git actions even before approval in ASK mode.
  - Tool approval requests now include `missing_scope`.
  - Chat approval modal now supports:
    - Grant scope for 10 minutes + approve
    - Grant scope for project + approve
  - Approval badge uses `ASK|AUTO|LOCKED` (via `ui_mode`) when available.
- Tests: added `tests/test_policy_scope_prompts.py`.
- Verification: backend `pytest`, all smoke scripts, and frontend lint/build pass.

## SESSION 41 UPDATE (2026-02-18)

- Tool parsing + path canonicalization hardening:
  - Tool headers now accept both canonical `[TOOL:write]` and legacy `[TOOLwrite]` (missing colon), case-insensitive.
  - File paths passed to tools are canonicalized so leading `@`/`./` cannot create wrong roots like `@apps/...`.
  - Console now emits `tool_path_canonicalized` when a tool path is normalized.
  - App Builder target dir sanitization strips leading `@`/`./` to avoid `@apps` outputs.
- Tests: added `tests/test_tool_parsing_legacy_and_at_paths.py`.
- Verification: backend `pytest`, all smoke scripts, and frontend lint/build pass.

## SESSION 42 UPDATE (2026-02-18)

- Pending approvals reliability (no more missed modals/timeouts):
  - Approval requests now persist `project_name`, `branch`, `expires_at` and include them in websocket payloads.
  - New API: `GET /api/approvals/pending` so the UI can reload pending approvals on reconnect/channel load.
  - Approval timeouts now mark requests as `expired` and broadcast `approval_expired` for UI cleanup.
  - Approval waits use `AI_OFFICE_APPROVAL_TTL_SECONDS` (default 600 seconds).
- UI: Chat header shows `Pending: N` chip and a pending approvals panel; modal shows expiry countdown.
- Tests: added `tests/test_approvals_pending_api.py` and `tests/test_approval_timeout_expires.py`.
- Verification: backend `pytest`, all smoke scripts, and frontend lint/build pass.

## SESSION 43 UPDATE (2026-02-18)

- Blocked command guidance improvements (reduce `&` / shell chaining failures):
  - Legacy string `[TOOL:run]` blocks now explain the correct alternatives:
    - Use `[TOOL:start_process]` for long-running servers/processes.
    - Use structured argv `[TOOL:run] {"cmd":[...],...}` for tricky quoting/semicolons (ex: `python -c ...`).
- Agent prompt guidance:
  - Updated `builder` and `codex` prompts with an "IMPORTANT TOOL RULES" block reinforcing `start_process` + structured argv usage.
- Verification: backend `pytest`, all smoke scripts, and frontend lint/build pass.

## SESSION 44 UPDATE (2026-02-18)

- Erase Memory Banks (project-scoped, selectable wipe):
  - New APIs:
    - `GET /api/memory/stats?project=...`
    - `POST /api/memory/erase` (scopes: facts/decisions/daily/agent_logs/index + optional clears for tasks/approvals/messages)
  - Controls tab now includes Memory Banks stats + scoped wipe UI (type `ERASE` to confirm).
  - Route ordering fixed so `/api/memory/stats` is not shadowed by `/api/memory/{agent_id}`.
- Tests: added `tests/test_memory_stats_and_erase.py`.
- Verification: backend `pytest`, all smoke scripts, and frontend lint/build pass.

## SESSION 45 UPDATE (2026-02-18)

- Spec / Idea Bank + spec-first tool gating:
  - New APIs:
    - `GET /api/spec/current?channel=...`
    - `POST /api/spec/current` (save -> `draft`)
    - `POST /api/spec/approve` (requires confirm text: `APPROVE SPEC`)
    - `GET /api/spec/history?project=...`
  - New DB table: `spec_states` (scoped by `channel` + `project_name`).
  - Engine spec gate: when spec is `draft`, mutating tools are blocked until spec approval.
  - App Builder now seeds an initial spec skeleton + idea bank and marks spec as `draft`.
  - UI: new Spec tab + chat header Spec chip + Approve button.
- Tests: added `tests/test_spec_bank_and_gate.py`.
- Verification: backend `pytest`, all smoke scripts, and frontend lint/build pass.

## SESSION 46 UPDATE (2026-02-18)

- Execution Status dock (Chat tab):
  - New right-side status panel that surfaces, in one place:
    - active project + branch
    - spec state
    - pending approvals
    - running processes (stop/open controls)
    - recent tool calls (audit)
    - recent console events
  - Chat header now has a `Show/Hide Status` toggle (visibility persisted via `localStorage`).
- Verification: backend `pytest`, all smoke scripts, and frontend lint/build pass.
