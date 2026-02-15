# AI Office - Project State

Last updated: 2026-02-15

## Status

- Stage 0 baseline commit/tag: pending in this shell because `git` is not installed/visible.
- Stage 1 Collab Core: implemented (`/meeting`, `/vote`, reactions, decisions persistence, collab status surfaces).
- Stage 1.5 Execution Engine: implemented (project workspaces, channel tool scoping, file context injection, build/test/fix loop, task-tag automation, escalation logic).
- Stage 2 core: implemented (`/work`, web research tools, Git panel/APIs, inline code execute endpoint + UI).
- Stage 3 partial: implemented export/templates/performance/cost tracking/branch context/theme/startup selector; remaining work is deeper multi-branch task orchestration polish.

## Runtime Baseline (Windows)

- Python: `C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe`
- Frontend wrappers:
  - `C:\AI_WORKSPACE\ai-office\client\dev-build.cmd`
  - `C:\AI_WORKSPACE\ai-office\client\dev-lint.cmd`
  - `C:\AI_WORKSPACE\ai-office\client\tools\with-node.cmd`
- Root wrapper: `C:\AI_WORKSPACE\ai-office\with-runtime.cmd`

## Current Staff / Backends

- Total agents configured: 17 (including router)
- Backends:
  - Ollama: core local team
  - Claude: `director`, `researcher`
  - OpenAI: `codex`
- Canonical source: `C:\AI_WORKSPACE\ai-office\agents\registry.json`

## Key UI Surfaces

- Home dashboard (conversations/tasks/decisions/performance/cost)
- Chat (threads, reactions, collab mode badge, active project badge, work indicator)
- Tasks
- Files
- Search
- Decisions
- Audit
- Controls (app builder, model readiness, API budget)
- Projects
- Git
- Agents (config editor)

## Key APIs (Expanded)

- Collaboration:
  - `POST /api/messages/{message_id}/reactions`
  - `GET /api/messages/{message_id}/reactions`
  - `GET /api/collab-mode/{channel}`
- Projects:
  - `POST /api/projects`
  - `GET /api/projects`
  - `POST /api/projects/switch`
  - `GET /api/projects/active/{channel}`
  - `DELETE /api/projects/{name}`
  - `GET /api/projects/status/{channel}`
- Build:
  - `GET /api/projects/{name}/build-config`
  - `PUT /api/projects/{name}/build-config`
  - `POST /api/projects/{name}/build`
  - `POST /api/projects/{name}/test`
  - `POST /api/projects/{name}/run`
- Work mode:
  - `POST /api/work/start`
  - `POST /api/work/stop`
  - `GET /api/work/status/{channel}`
- Web tools:
  - `POST /api/tools/web`
  - `POST /api/tools/fetch`
- Git:
  - `GET /api/projects/{name}/git/status`
  - `GET /api/projects/{name}/git/log`
  - `GET /api/projects/{name}/git/diff`
  - `POST /api/projects/{name}/git/commit`
  - `POST /api/projects/{name}/git/branch`
  - `POST /api/projects/{name}/git/merge`
- Execute:
  - `POST /api/execute`
- Usage/perf:
  - `GET /api/performance/agents`
  - `GET /api/usage`
  - `GET /api/usage/summary`
  - `GET /api/usage/budget`
  - `PUT /api/usage/budget`

## Verification Snapshot

Most recent checks in this sprint run:

- `client/dev-lint.cmd` PASS
- `client/dev-build.cmd` PASS
- `python -m compileall server` PASS
- `python -m pytest tests -q` PASS
- `tools/runtime_smoke.py` PASS
- `tools/startup_smoke.py` PASS
- `tools/desktop_smoke.py` PASS
- `tools/toolchain_smoke.py` PASS
- `tools/personality_smoke.py` PASS

## Security Reminder

If an API key appears in chat/logs/screenshots/commits, rotate immediately and replace in `C:\AI_WORKSPACE\ai-office\.env`.
