# AI OFFICE — Handoff Prompt

You are picking up an ongoing project called **AI Office** — a local multi-agent team chat application. Read this entire prompt before doing anything.

---

## LATEST STATUS UPDATE (2026-02-15)
- Stage 1 + Stage 1.5 + Stage 2 core are implemented.
- Stage 3 major items are implemented (export/templates/performance/cost/branch context/theme/startup selector), with only deeper multi-branch orchestration polish remaining.
- Added collab core:
  - `/meeting`, `/vote`
  - reactions API + WS fanout
  - vote persistence into `decisions`
- Added execution engine:
  - `/project` lifecycle, channel-scoped active projects
  - channel-aware tool sandboxing
  - file context injection
  - post-write build/test/fix loop + Nova escalation
  - task status tags `[TASK:start|done|blocked]`
- Added Stage 2 operations:
  - `/work start|stop|status`
  - web research tools `[TOOL:web]`, `[TOOL:fetch]`
  - Git APIs and Git panel
  - `POST /api/execute` + inline Run button in code blocks
- Added Stage 3 support:
  - `/export`
  - project templates (`react`, `python`, `rust`)
  - agent performance metrics
  - API usage + budget threshold APIs
  - theme toggle
  - startup mode selector in `start.py --mode web|desktop`
- Latest checks pass:
  - `client/dev-lint.cmd`
  - `client/dev-build.cmd`
  - `python -m pytest tests -q`
  - `tools/runtime_smoke.py`
  - `tools/startup_smoke.py`
  - `tools/desktop_smoke.py`
  - `tools/toolchain_smoke.py`
  - `tools/personality_smoke.py`

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
