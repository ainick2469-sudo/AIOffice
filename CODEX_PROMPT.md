# AI OFFICE — Codex Handoff Prompt

You are continuing work on **AI Office** — a local multi-agent team chat app you've already been working on. Read this fully before doing anything.

---

## PROJECT LOCATION
- **Path:** `C:\AI_WORKSPACE\ai-office`
- **GitHub:** https://github.com/ainick2469-sudo/AIOffice.git
- **Dev log:** `DEVLOG.md` in project root — full history of all work done
- **Your previous work:** You made major changes last session but NOTHING WAS COMMITTED TO GIT. 28 modified files + 15 new files are sitting unstaged. Your first job is to commit everything.

## HOW TO RUN
```
cd C:\AI_WORKSPACE\ai-office
python start.py
```
Frontend dev: http://localhost:5173 | Production: http://localhost:8000 | Desktop: `python app.py`

## WHAT YOU BUILT LAST SESSION (already on disk, not committed)
1. ✅ System tray icon (pystray + Pillow in app.py, TrayController class)
2. ✅ 4 new agents: Codex (OpenAI), Ops/⚙️ (DevOps), Mira/📝 (Scribe), Vera/🧭 (Critic)
3. ✅ Agent Config UI (AgentConfig.jsx — change models/prompts/backend from UI)
4. ✅ Dashboard Home (DashboardHome.jsx — overview of conversations, tasks, decisions)
5. ✅ Unread counts + sound notifications (Sidebar.jsx — polling + Web Audio ding)
6. ✅ App Builder workflow (app_builder.py + POST /api/app-builder/start)
7. ✅ OpenAI adapter (openai_client.py + openai_adapter.py for Codex agent)
8. ✅ Stability hardening (with-runtime.cmd, dev-build.cmd, dev-lint.cmd, desktop-launch.cmd)
9. ✅ 6 smoke tests (runtime, startup, desktop, toolchain, personality, smoke_checks)
10. ✅ 9-tab UI: Home, Chat, Tasks, Files, Search, Decisions, Audit, Controls, Agents
11. ✅ Anti-groupthink/dissent enforcement in agent_engine.py + router_agent.py
12. ✅ Ollama model recommendation + pull APIs

## CURRENT AGENT ROSTER (17 agents)
| ID | Name | Role | Backend | Model |
|----|------|------|---------|-------|
| router | Router | Message classifier | ollama | qwen3:1.7b |
| spark | Spark 💡 | Creative Ideator | ollama | qwen2.5:14b |
| architect | Ada 🏗️ | System Architect | ollama | qwen2.5:14b |
| builder | Max 🔨 | Builder / Programmer | ollama | qwen2.5-coder:32b |
| reviewer | Rex 🔍 | Code Reviewer | ollama | qwen2.5:14b |
| qa | Quinn 🧪 | QA / Testing | ollama | qwen2.5:14b |
| uiux | Uma 🎨 | UI/UX Designer | ollama | qwen2.5:14b |
| art | Iris 🎭 | Visual Design | ollama | qwen2.5:14b |
| producer | Pam 📋 | Producer / PM | ollama | qwen2.5:14b |
| lore | Leo 📖 | Lore / Narrative | ollama | qwen2.5:14b |
| director | Nova 🧠 | Director / Tech Lead | claude | claude-sonnet |
| researcher | Scout 🔭 | Deep Researcher | claude | claude-sonnet |
| sage | Sage 🌿 | Scope Guardian | ollama | qwen2.5:14b |
| codex | Codex C | Implementation Overseer | openai | gpt-4o-mini |
| ops | Ops ⚙️ | DevOps / Reliability | ollama | qwen2.5-coder:7b |
| scribe | Mira 📝 | Technical Writer | ollama | qwen2.5:7b |
| critic | Vera 🧭 | Formal Critic / Red Team | ollama | qwen3:8b |

## KNOWN ISSUES TO FIX
1. **Git uncommitted** — All your last session's work is unstaged. Commit it first: `git add -A && git commit -m "v0.7: Tray, dashboard, agent config, 4 new agents, app builder, smoke tests"`
2. **Teammate lists inconsistent** — Older agents (Spark through Sage) list 13 teammates. Newer agents (Ops, Mira, Vera) list 16 teammates including themselves. All 17 agents should list ALL 17 teammates in their system prompts.
3. **Ops uses qwen2.5-coder:7b, Mira uses qwen2.5:7b** — These are smaller models than the rest of the team. Consider bumping to qwen2.5:14b for consistency unless there's a performance reason.
4. **OpenAI key for Codex** — Verify OPENAI_API_KEY is in .env. If not, Codex agent will silently fail.
5. **ChatRoom.jsx grew to 530+ lines** — Verify it still renders correctly. Test sending a message, watching agent-to-agent conversation, and using the stop button.
6. **Frontend build** — After any frontend changes, run `npm run build` in client/ to update client-dist/ for production/desktop mode.

## WHAT STILL NEEDS TO BE BUILT

### 🔴 Priority (next batch)
1. **Message threading / reply-to** — Can't reply to specific messages. Need parent_id linking + thread view in ChatRoom. DB already has parent_id column in messages table.
2. **File sharing / drag-drop** — Can't share files with agents. Need drag-drop zone in ChatRoom, upload endpoint, file message type, preview rendering.
3. **Message reactions** — 👍👎🔥 on agent messages. New DB table (message_id, emoji, reactor). Display under messages.
4. **Online/offline status** — Show which agents are available in sidebar. Check Ollama model availability + Claude/OpenAI key presence.
5. **Timestamp grouping** — Don't show time on every message if they're seconds apart. Group by minute.

### 🟡 Important
6. **Meeting mode** — Structured "/meeting [topic]" command. All agents weigh in on topic, take turns, produce summary at end.
7. **Voting / consensus** — "/vote [question]" triggers all agents to vote yes/no/abstain with reasoning. Tally displayed.
8. **Git integration in UI** — Show git status, recent commits, diffs in a panel. Auto-commit option.
9. **Code execution panel** — "Run" button on code blocks in chat. Execute and show output inline.

### 🟢 Nice to Have
10. **Dark/light theme toggle**
11. **Bots creating their own tools**
12. **Export conversation to markdown**
13. **Startup mode selector (web vs desktop)**

## KEY FILES REFERENCE
**Backend:** server/agent_engine.py (conversation loop), server/router_agent.py (routing), server/routes_api.py (all endpoints), server/app_builder.py (app builder), server/tool_executor.py (tool parsing), server/tool_gateway.py (sandboxed tools)
**Frontend:** client/src/App.jsx (9-tab layout), client/src/components/ChatRoom.jsx (main chat), client/src/components/Sidebar.jsx (channels + unread), client/src/components/DashboardHome.jsx (home), client/src/components/AgentConfig.jsx (agent settings)
**Config:** agents/registry.json (17 agents), .env (API keys), tools/allowlist.json (permitted commands)

## RULES
- Commit to git FIRST before making new changes.
- Work in segments. Don't try to do everything at once.
- Test changes before declaring them done. Run the smoke tests.
- Update DEVLOG.md after each batch of work.
- All agents should have deep personality — no generic "helpful assistant" prompts.
- Agents should disagree and debate, not just agree with each other.
