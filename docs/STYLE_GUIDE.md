# AI OFFICE — Style Guide

## UI Theme
- **Style**: Clean, minimal, professional (Slack-like)
- **Colors**: Dark sidebar (#1E1E2E), light content area (#FAFAFA)
- **Font**: System font stack (Inter if available)
- **Spacing**: Generous whitespace, 8px grid

## Agent Identity
- Each agent has a unique color and emoji (see registry.json)
- Agent messages show: emoji + name + role badge + timestamp
- User messages are right-aligned, agent messages left-aligned

## Message Types
- **Normal**: Standard chat bubble
- **Task**: Yellow border, task icon
- **Decision**: Blue border, lock icon, pinned
- **Tool Request**: Orange border, gear icon
- **Tool Result**: Green/red border based on success
- **Review**: Purple border, checklist icon

## Layout
- Left sidebar: channel list (Main Room + DM channels)
- Center: chat area with message feed
- Right sidebar: panels (Tasks, Decisions, Audit, State) — collapsible
