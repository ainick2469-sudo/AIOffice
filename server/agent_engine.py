"""AI Office — Agent Engine v2. Living conversation ecosystem.

Agents respond to the user AND to each other. Conversations flow naturally.
User can jump in anytime. Cap at 1000 messages.
"""

import asyncio
import logging
import os
import random
import re
from pathlib import Path
from typing import Optional
from . import ollama_client
from .router_agent import route
from .database import get_agent, get_agents, get_messages, insert_message, get_channel_name, set_channel_name
from .websocket import manager
from .memory import read_all_memory_for_agent
from .distiller import maybe_distill
from .tool_executor import parse_tool_calls, execute_tool_calls
from . import claude_adapter

logger = logging.getLogger("ai-office.engine")

CONTEXT_WINDOW = 20
MAX_MESSAGES = 1000
PAUSE_BETWEEN_AGENTS = 1.5  # seconds — feels natural
PAUSE_BETWEEN_ROUNDS = 3.0  # seconds — breathing room

# Active conversation tracking
_active: dict[str, bool] = {}
_msg_count: dict[str, int] = {}
_user_interrupt: dict[str, str] = {}

ALL_AGENT_IDS = ["spark", "architect", "builder", "reviewer", "qa", "uiux", "art", "producer", "lore", "director", "researcher", "sage"]
AGENT_NAMES = {
    "spark": "Spark", "architect": "Ada", "builder": "Max",
    "reviewer": "Rex", "qa": "Quinn", "uiux": "Uma",
    "art": "Iris", "producer": "Pam", "lore": "Leo",
    "director": "Nova", "researcher": "Scout", "sage": "Sage",
}

# Cache project tree (refreshed every 60s)
_project_tree_cache = {"tree": "", "time": 0}

def _get_project_tree() -> str:
    """Get real project file tree for grounding agents."""
    import time
    now = time.time()
    if _project_tree_cache["tree"] and now - _project_tree_cache["time"] < 60:
        return _project_tree_cache["tree"]
    sandbox = Path("C:/AI_WORKSPACE/ai-office")
    skip = {"node_modules", ".git", "__pycache__", "client-dist", ".venv", "data"}
    lines = []
    for root, dirs, files in os.walk(sandbox):
        dirs[:] = [d for d in dirs if d not in skip]
        depth = str(Path(root)).replace(str(sandbox), "").count(os.sep)
        if depth > 3:
            continue
        rel = Path(root).relative_to(sandbox)
        indent = "  " * depth
        if rel != Path("."):
            lines.append(f"{indent}{rel.name}/")
        for f in sorted(files)[:15]:
            lines.append(f"{indent}  {f}")
    tree = "\n".join(lines[:80])
    _project_tree_cache["tree"] = tree
    _project_tree_cache["time"] = now
    return tree


async def _build_context(channel: str) -> str:
    """Build conversation context as natural chat transcript."""
    messages = await get_messages(channel, limit=CONTEXT_WINDOW)
    lines = []
    for msg in messages:
        if msg["sender"] == "user":
            name = "User"
        elif msg["sender"] == "system":
            name = "System"
        else:
            name = AGENT_NAMES.get(msg["sender"], msg["sender"])
        lines.append(f"{name}: {msg['content']}")
    return "\n\n".join(lines)


def _build_system(agent: dict, channel: str, is_followup: bool) -> str:
    """Build system prompt. Tells agent to be themselves, not a bot."""
    s = agent.get("system_prompt", "You are a helpful team member.")
    s += "\n\nYou are in a team chat with other AI agents and a human user."
    s += "\nWrite naturally — just your message, no name prefix, no brackets."
    s += "\nDO NOT start your message with your name or role in brackets."
    s += "\nRefer to teammates by name: 'I like Spark's idea' or 'Ada, what about...'"
    s += "\nKeep it concise: 2-4 sentences unless detail is needed."

    if is_followup:
        s += "\n\nYou're following up on an ongoing conversation."
        s += "\nOnly speak if you have something NEW to add — a different angle, a question, a concern, or building on what someone said."
        s += "\nIf you have nothing meaningful to add, respond with exactly: PASS"
        s += "\nDo NOT just agree or restate what was already said."

    # Tool instructions for agents with permissions
    perms = agent.get("permissions", "read")
    if perms in ("read", "run", "write"):
        s += "\n\nYou have access to tools. Use them when it would help the conversation:"
        s += "\n  [TOOL:read] path/to/file — Read a file"
        s += "\n  [TOOL:search] *.py — Search for files"
        if perms in ("run", "write"):
            s += "\n  [TOOL:run] command — Run an allowed command (pytest, git status, npm test, etc)"
        if perms == "write":
            s += "\n  [TOOL:write] path/to/file"
            s += "\n  ```"
            s += "\n  file content here"
            s += "\n  ```"
        s += "\nUse tools when the team is discussing something you can look up or verify."
        s += "\nDon't just talk about code — read it, check it, reference real files."
        s += "\nAll file paths are relative to the project root (C:/AI_WORKSPACE/ai-office)."
        s += "\nHere are the REAL files in this project right now:"
        s += f"\n```\n{_get_project_tree()}\n```"
        s += "\nONLY reference files that actually exist above, or create new ones with [TOOL:write]."
        s += "\nWhen creating new files for a project, put them in a subfolder (e.g. app/, src/, etc)."

    # Memory
    memories = read_all_memory_for_agent(agent["id"], limit=12)
    if memories:
        mem_text = "\n".join(f"- {m.get('content', '')}" for m in memories[-8:])
        s += f"\n\nThings you remember:\n{mem_text}"

    return s


async def _generate(agent: dict, channel: str, is_followup: bool = False) -> Optional[str]:
    """Generate one agent's response. Routes to Ollama or Claude based on backend."""
    context = await _build_context(channel)
    system = _build_system(agent, channel, is_followup)

    prompt = f"Here's the conversation so far:\n\n{context}\n\nNow respond as {agent['display_name']}:"

    backend = agent.get("backend", "ollama")

    try:
        if backend == "claude":
            response = await claude_adapter.generate(
                prompt=prompt,
                system=system,
                temperature=0.7,
                max_tokens=600,
                model=agent.get("model", "claude-sonnet-4-20250514"),
            )
        else:
            response = await ollama_client.generate(
                model=agent["model"],
                prompt=prompt,
                system=system,
                temperature=0.75,
                max_tokens=400,
            )
        if not response:
            return None

        # Clean up
        response = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL).strip()

        # Strip self-prefixing like "[producer]:" or "Pam:" or "**Pam**:"
        name = agent["display_name"]
        for prefix in [f"[{agent['id']}]: ", f"[{agent['id']}]:", f"{name}: ", f"{name}:", f"**{name}**: ", f"**{name}**:"]:
            if response.startswith(prefix):
                response = response[len(prefix):].strip()

        if response.upper().strip() in ("PASS", "[PASS]", "PASS."):
            return None
        # Strip leading PASS if followed by real content
        if response.upper().startswith("PASS"):
            response = re.sub(r'^PASS\.?\s*\n*', '', response, flags=re.IGNORECASE).strip()
            if not response or len(response) < 3:
                return None
        if len(response.strip()) < 3:
            return None

        return response.strip()
    except Exception as e:
        logger.error(f"Agent {agent['id']} failed: {e}")
        return None


async def _send(agent: dict, channel: str, content: str):
    """Save + broadcast an agent message, then execute any tool calls."""
    saved = await insert_message(channel=channel, sender=agent["id"], content=content, msg_type="message")
    await manager.broadcast(channel, {"type": "chat", "message": saved})
    logger.info(f"  [{agent['display_name']}] {content[:80]}")

    # Check for tool calls in the message
    tool_calls = parse_tool_calls(content)
    if tool_calls:
        logger.info(f"  [{agent['display_name']}] executing {len(tool_calls)} tool call(s)")
        await execute_tool_calls(agent["id"], tool_calls, channel)

    return saved


async def _typing(agent: dict, channel: str):
    """Show typing indicator."""
    await manager.broadcast(channel, {
        "type": "typing",
        "agent_id": agent["id"],
        "display_name": agent["display_name"],
    })


def _mentions(text: str) -> list[str]:
    """Find agent names mentioned in text."""
    found = []
    lower = text.lower()
    for aid, name in AGENT_NAMES.items():
        if name.lower() in lower:
            found.append(aid)
    return found


def _invites_response(text: str) -> bool:
    """Does this message invite others to respond?"""
    triggers = [
        "?", "thoughts", "think", "ideas", "what do you",
        "anyone", "team", "everyone", "how about", "what if",
        "could we", "should we", "let's", "suggest", "opinion",
        "agree", "disagree", "feedback", "input", "weigh in",
        "what about", "right?", "guys",
    ]
    lower = text.lower()
    return any(t in lower for t in triggers)


def _pick_next(last_sender: str, last_text: str, already_spoke: set) -> list[str]:
    """Pick who talks next. Deterministic + some randomness."""
    candidates = []

    # Mentioned agents always get to talk
    for aid in _mentions(last_text):
        if aid != last_sender and aid not in already_spoke:
            candidates.append(aid)

    # If the message invites response, add more
    if _invites_response(last_text) or not candidates:
        pool = [a for a in ALL_AGENT_IDS if a != last_sender and a not in already_spoke and a != "router"]
        random.shuffle(pool)
        for a in pool[:2]:
            if a not in candidates:
                candidates.append(a)

    return candidates[:3]


async def _conversation_loop(channel: str, initial_agents: list[str]):
    """The living conversation. Agents respond, then react to each other."""
    count = 0
    _active[channel] = True
    _msg_count[channel] = 0

    try:
        # ROUND 1: Initial responders (to user's message)
        spoke_this_convo = set()
        for aid in initial_agents:
            if not _active.get(channel):
                return
            if channel in _user_interrupt:
                break

            agent = await get_agent(aid)
            if not agent or not agent.get("active"):
                continue

            await _typing(agent, channel)
            response = await _generate(agent, channel, is_followup=False)

            if response:
                await _send(agent, channel, response)
                spoke_this_convo.add(aid)
                count += 1
                _msg_count[channel] = count
                await asyncio.sleep(PAUSE_BETWEEN_AGENTS)

        # CONTINUATION ROUNDS: Agents respond to each other
        consecutive_silence = 0
        max_silence = 2  # Stop after 2 rounds where nobody has anything to say

        while count < MAX_MESSAGES and _active.get(channel) and consecutive_silence < max_silence:
            await asyncio.sleep(PAUSE_BETWEEN_ROUNDS)

            # Check for user interrupt
            if channel in _user_interrupt:
                new_msg = _user_interrupt.pop(channel)
                logger.info(f"User jumped in: {new_msg[:60]}")
                # Re-route for user's new message
                new_agents = await route(new_msg)
                spoke_this_convo.clear()  # Reset — fresh round
                for aid in new_agents:
                    if not _active.get(channel):
                        return
                    if channel in _user_interrupt:
                        break
                    agent = await get_agent(aid)
                    if not agent or not agent.get("active"):
                        continue
                    await _typing(agent, channel)
                    response = await _generate(agent, channel, is_followup=False)
                    if response:
                        await _send(agent, channel, response)
                        spoke_this_convo.add(aid)
                        count += 1
                        _msg_count[channel] = count
                        await asyncio.sleep(PAUSE_BETWEEN_AGENTS)
                consecutive_silence = 0
                continue

            # Get last message to decide who follows up
            recent = await get_messages(channel, limit=3)
            if not recent:
                break

            last = recent[-1]

            # If user was the last speaker, wait — they might keep typing
            if last["sender"] == "user":
                await asyncio.sleep(2)
                recent2 = await get_messages(channel, limit=1)
                if recent2 and recent2[-1]["sender"] == "user":
                    new_agents = await route(recent2[-1]["content"])
                    spoke_this_convo.clear()
                    for aid in new_agents:
                        if not _active.get(channel):
                            return
                        agent = await get_agent(aid)
                        if not agent or not agent.get("active"):
                            continue
                        await _typing(agent, channel)
                        response = await _generate(agent, channel, is_followup=False)
                        if response:
                            await _send(agent, channel, response)
                            spoke_this_convo.add(aid)
                            count += 1
                            _msg_count[channel] = count
                            await asyncio.sleep(PAUSE_BETWEEN_AGENTS)
                    consecutive_silence = 0
                    continue

            # Pick who responds next
            next_agents = _pick_next(last["sender"], last["content"], spoke_this_convo)

            anyone_spoke = False
            for aid in next_agents:
                if not _active.get(channel):
                    return
                if channel in _user_interrupt:
                    break

                agent = await get_agent(aid)
                if not agent or not agent.get("active"):
                    continue

                await _typing(agent, channel)
                response = await _generate(agent, channel, is_followup=True)

                if response:
                    await _send(agent, channel, response)
                    spoke_this_convo.add(aid)
                    count += 1
                    _msg_count[channel] = count
                    anyone_spoke = True
                    consecutive_silence = 0
                    await asyncio.sleep(PAUSE_BETWEEN_AGENTS)

            if not anyone_spoke:
                consecutive_silence += 1
                logger.info(f"Round quiet ({consecutive_silence}/{max_silence})")

            # Distill every 8 messages
            if count % 8 == 0 and count > 0:
                try:
                    await maybe_distill(channel)
                except Exception:
                    pass

    except Exception as e:
        logger.error(f"Conversation loop error: {e}")
    finally:
        logger.info(f"Conversation ended: {count} messages in #{channel}")
        try:
            await maybe_distill(channel)
        except Exception:
            pass
        _active.pop(channel, None)
        _msg_count.pop(channel, None)


_user_msg_count: dict[str, int] = {}  # track user messages per channel for auto-naming
_named_channels: set = set()  # channels that have been auto-named


async def _auto_name_channel(channel: str):
    """After 3 user messages, auto-generate a topic name for the channel."""
    if channel in _named_channels or channel.startswith("dm:"):
        return

    count = _user_msg_count.get(channel, 0)
    if count < 3:
        return

    # Check if already named in DB
    existing = await get_channel_name(channel)
    if existing:
        _named_channels.add(channel)
        return

    # Get recent messages to summarize
    messages = await get_messages(channel, limit=10)
    if not messages:
        return

    transcript = "\n".join(f"{m['sender']}: {m['content'][:100]}" for m in messages)

    try:
        name = await ollama_client.generate(
            model="qwen3:1.7b",
            prompt=f"Read this conversation and write a SHORT topic name (3-6 words max, no quotes, no punctuation). Examples: 'Game Audio Architecture', 'Login Page Redesign', 'API Rate Limiting Plan'.\n\n{transcript}\n\n/no_think\nTopic name:",
            system="You generate short topic names. Reply with ONLY the topic name, nothing else. No quotes. No explanation.",
            temperature=0.3,
            max_tokens=20,
        )
        if name:
            name = name.strip().strip('"').strip("'").strip()
            # Remove think tags if present
            name = re.sub(r'<think>.*?</think>', '', name, flags=re.DOTALL).strip()
            if 2 < len(name) < 60:
                await set_channel_name(channel, name)
                _named_channels.add(channel)
                # Broadcast rename to all clients
                await manager.broadcast(channel, {
                    "type": "channel_rename",
                    "channel": channel,
                    "name": name,
                })
                logger.info(f"Auto-named #{channel} -> '{name}'")
    except Exception as e:
        logger.error(f"Auto-name failed: {e}")


async def process_message(channel: str, user_message: str):
    """Main entry: start or interrupt a conversation."""
    logger.info(f"Processing: [{channel}] {user_message[:80]}")

    # Track user messages for auto-naming
    _user_msg_count[channel] = _user_msg_count.get(channel, 0) + 1
    asyncio.create_task(_auto_name_channel(channel))

    # DM: simple 1-on-1
    if channel.startswith("dm:"):
        agent_id = channel.replace("dm:", "")
        agent = await get_agent(agent_id)
        if not agent:
            return
        await _typing(agent, channel)
        response = await _generate(agent, channel)
        if response:
            await _send(agent, channel, response)
        try:
            await maybe_distill(channel)
        except Exception:
            pass
        return

    # Main room
    if channel in _active and _active[channel]:
        # Conversation running — interrupt it
        logger.info(f"User interrupt in #{channel}")
        _user_interrupt[channel] = user_message
        return

    # Start new conversation
    logger.info(f"New conversation in #{channel}")
    initial_agents = await route(user_message)
    logger.info(f"Initial agents: {initial_agents}")
    asyncio.create_task(_conversation_loop(channel, initial_agents))


async def stop_conversation(channel: str) -> bool:
    """Force stop."""
    if channel in _active:
        _active[channel] = False
        logger.info(f"Force stopped #{channel}")
        return True
    return False


def get_conversation_status(channel: str) -> dict:
    return {
        "active": _active.get(channel, False),
        "message_count": _msg_count.get(channel, 0),
        "max_messages": MAX_MESSAGES,
    }
