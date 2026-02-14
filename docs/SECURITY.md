# AI OFFICE — Security & Permissions

## Threat Model
1. **Sandbox Escape**: Agent tries to access files outside workspace
   - Mitigation: All paths validated against `C:\AI_WORKSPACE\ai-office`
2. **Destructive Commands**: Agent runs `rm -rf`, registry edits, etc.
   - Mitigation: Allow-list of commands; anything not listed is blocked
3. **Secret Leakage**: API keys in logs or chat
   - Mitigation: .env loaded server-side only; output redaction filter
4. **Runaway Loops**: Office Pulse triggers infinite agent conversations
   - Mitigation: Max 1 msg/agent/pulse, max 1 pulse/interval, idle detection
5. **Prompt Injection**: Malicious content in messages manipulates agents
   - Mitigation: Agent system prompts are fixed; user input is clearly delimited

## Permission Tiers
| Tier | Capabilities | Agents |
|------|-------------|--------|
| **read** | Read files, search, list dirs | architect, reviewer, uiux, art, producer, lore, router |
| **run** | Above + run allow-listed commands | qa |
| **write** | Above + write files (with diff + approval) | builder |

## Tool Allow-List
### READ operations (no approval needed)
- Read file within sandbox
- List directory within sandbox
- Search files by name/content within sandbox

### RUN operations (logged, no approval for allow-listed)
- `pytest` / `python -m pytest`
- `npm test` / `npm run build` / `npm run lint`
- `python -m py_compile <file>`

### WRITE operations (REQUIRE approval)
- Create new file (show content preview)
- Edit file (show diff before/after)
- Each write stores rollback backup

## Audit Log
Every tool call records:
- `timestamp`, `agent_id`, `tool_type`, `command`, `args`, `output`, `exit_code`, `approved_by`

## Environment Variables (.env)
- `CLAUDE_API_KEY` — Optional, for Claude integration
- `OLLAMA_HOST` — Default: http://localhost:11434
- `WORKSPACE_PATH` — Default: C:\AI_WORKSPACE\ai-office
- Never logged, never printed, never sent to frontend
