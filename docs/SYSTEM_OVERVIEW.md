# AI OFFICE — System Overview

## What Is It?
A local multi-agent team chat application where a human user collaborates with
a staff of specialized AI agents in a Slack-like interface. Each agent has a
persistent identity, role-specific memory, and the system auto-routes messages
to the right experts.

## Core Experience
- **Main Room**: Group chat where all agents can participate
- **DMs**: Private 1-on-1 channels between user and any agent
- **Panels**: Tasks board, Decisions log, Audit viewer, Project State

## Agents (Core Staff)
| ID | Name | Role | Model |
|----|------|------|-------|
| router | Router | Message classification & agent selection | qwen3:1.7b |
| architect | Ada (Architect) | System design, architecture decisions | qwen2.5:14b |
| builder | Max (Builder) | Code implementation, debugging | qwen2.5-coder:32b |
| reviewer | Rex (Reviewer) | Code review, security, quality | qwen2.5:14b |
| qa | Quinn (QA) | Testing, edge cases, regression | qwen2.5:14b |
| uiux | Uma (UI/UX) | Usability, flow, clarity | qwen2.5:14b |
| art | Iris (Art/Visual) | Aesthetic consistency, visual design | qwen2.5:14b |
| producer | Pam (Producer) | Project mgmt, prioritization, releases | qwen2.5:14b |
| lore | Leo (Lore) | Story, world-building, narrative | qwen2.5:14b |

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    BROWSER (React/Vite)                  │
│  ┌──────────┐ ┌────────┐ ┌───────┐ ┌──────┐ ┌────────┐ │
│  │Main Room │ │  DMs   │ │Tasks  │ │Audit │ │ProjState│ │
│  └────┬─────┘ └───┬────┘ └───┬───┘ └──┬───┘ └───┬────┘ │
│       └───────────┴──────────┴────────┴─────────┘       │
│                        WebSocket                         │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────┐
│                  FASTAPI SERVER (Python)                  │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Chat API │  │ Agent Engine │  │  Tool Gateway      │  │
│  │ /ws      │  │              │  │  ┌─────────────┐   │  │
│  │ /api/... │  │ ┌──────────┐ │  │  │ READ tools  │   │  │
│  └────┬─────┘  │ │ Router   │ │  │  │ RUN tools   │   │  │
│       │        │ │(qwen3:1.7)│ │  │  │ WRITE tools │   │  │
│       │        │ └─────┬────┘ │  │  └──────┬──────┘   │  │
│       │        │       │      │  │         │          │  │
│       │        │ ┌─────┴────┐ │  │  ┌──────┴──────┐   │  │
│       │        │ │Agent Pool│ │  │  │ Audit Logger │   │  │
│       │        │ │(Ollama)  │ │  │  └─────────────┘   │  │
│       │        │ └──────────┘ │  └───────────────────┘  │
│       │        └──────────────┘                          │
│  ┌────┴────────────────────────────────────────────┐    │
│  │              SQLite Database                      │    │
│  │  messages | tasks | decisions | tool_logs | agents│    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │           Memory System (JSONL files)             │    │
│  │  shared_memory | per-agent memories | distiller   │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │           Office Pulse (Scheduler)                │    │
│  │  Timed checks | QA smoke | Review scan | Tickets  │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────┐
│                  OLLAMA SERVER (localhost:11434)          │
│  qwen3:1.7b | qwen2.5:14b | qwen2.5-coder:32b          │
│              | qwen2.5:32b (fallback)                    │
└──────────────────────────────────────────────────────────┘
```

## Data Flow
1. User sends message via WebSocket
2. Router (qwen3:1.7b) classifies intent → selects 2-4 agents
3. Selected agents generate responses via Ollama
4. Responses streamed back to UI via WebSocket
5. Memory Distiller extracts durable facts after meaningful exchanges
6. Tool Gateway handles any file/command actions with audit logging

## Key Safety Properties
- All tool actions require explicit approval for writes
- Audit log captures every tool call with who/when/what/output
- Sandbox restricted to C:\AI_WORKSPACE\ai-office
- No secrets in logs or responses
- Office Pulse has strict limits (max 1 msg/agent/pulse, no infinite loops)
