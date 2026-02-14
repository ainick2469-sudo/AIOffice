# AI OFFICE — MVP Milestones & Acceptance Tests

## Phase 1: Chat Skeleton + DB + Main Room + DMs
**Goal**: Basic chat UI that sends/receives messages via WebSocket.

### Deliverables
- FastAPI server with WebSocket endpoint
- SQLite database auto-created on first run
- React UI with main room and DM sidebar
- Messages persist and reload on refresh

### Acceptance Tests
- [ ] `python server/main.py` starts server on localhost:8000
- [ ] Opening localhost:5173 shows chat UI
- [ ] User can type message in main room → appears in chat
- [ ] User can click agent name → opens DM channel
- [ ] Messages persist after page refresh
- [ ] WebSocket reconnects on disconnect

---

## Phase 2: Agent Registry + Routing + Agent Responses
**Goal**: Agents respond to messages based on topic classification.

### Deliverables
- Agent registry loaded from JSON
- Router agent classifies messages → selects relevant agents
- Selected agents generate responses via Ollama
- Agent responses appear in chat with distinct identity

### Acceptance Tests
- [ ] `GET /api/agents` returns all registered agents
- [ ] Sending "fix this bug" routes to Builder + QA
- [ ] Sending "make it look better" routes to UI/UX + Art
- [ ] Each agent response shows agent name + avatar color
- [ ] Router responds in <2 seconds (using qwen3:1.7b)
- [ ] Agent responses stream token-by-token

---

## Phase 3: Memory Distiller + Project State
**Goal**: System extracts and stores durable facts from conversations.

### Deliverables
- Memory distiller extracts facts after meaningful exchanges
- Per-agent memory files (JSONL)
- Shared project memory
- PROJECT_STATE.md auto-updated
- Memory context injected into agent prompts

### Acceptance Tests
- [ ] After 5+ message exchange, distiller extracts facts
- [ ] Facts appear in `memory/agents/<id>.jsonl`
- [ ] Shared facts appear in `memory/shared_memory.jsonl`
- [ ] Agent prompts include relevant memory context
- [ ] PROJECT_STATE.md reflects current state

---

## Phase 4: Tool Gateway (Read + Run)
**Goal**: Agents can read files and run allow-listed commands.

### Deliverables
- READ tools: read file, search files, list directory
- RUN tools: run tests, build, lint (allow-listed)
- Audit log for every tool call
- Approval prompt for elevated actions
- Audit log viewer in UI

### Acceptance Tests
- [ ] Agent can read a file within sandbox
- [ ] Agent CANNOT read outside sandbox
- [ ] Running `pytest` logs command + output + exit code
- [ ] Audit log shows all tool calls in UI
- [ ] Blocked command is rejected with log entry

---

## Phase 5: Release Gate (Multi-Agent Review)
**Goal**: Release requires sign-off from multiple agent roles.

### Deliverables
- Release gate workflow triggered by user or Producer
- Each role produces a review report
- Blockers return to Builder with tasks
- Improvement sweeps (2-3 passes)
- Release status visible in UI

### Acceptance Tests
- [ ] `POST /api/release-gate/start` triggers review
- [ ] Each agent produces structured review report
- [ ] Blocker from any agent blocks release
- [ ] Improvement tickets created from suggestions
- [ ] Release only marked ready when all sign off

---

## Phase 6: Write Tools + Diff Preview (Optional/Stretch)
**Goal**: Agents can write file changes with safety controls.

### Deliverables
- WRITE tools: create/edit files with diff preview
- Diff shown in UI before approval
- Rollback plan stored for each write
- Full audit trail

### Acceptance Tests
- [ ] Agent proposes file edit → diff shown in UI
- [ ] User approves → file written
- [ ] User rejects → no change
- [ ] Rollback command undoes last write
- [ ] Audit log shows diff + approval status
