"""Run a deterministic baseline conversation for Segment 2 quality checks."""

import asyncio
import time
from pathlib import Path

from server import ollama_client
from server.agent_engine import get_conversation_status, process_message
from server.database import get_messages, init_db, insert_message


async def main():
    channel = f"seg2-quality-baseline-{int(time.time())}"
    prompt = "hey team, what should we build today?"

    original_generate = ollama_client.generate

    async def fake_generate(*args, **kwargs):
        system = str(kwargs.get("system", "") or "")
        if "Respond ONLY with JSON" in system:
            return '{"agents":["builder","architect","producer"]}'
        if "=== FOLLOWUP RULES ===" in system:
            return "I agree, that sounds good."
        return "I agree we should build a focus tracker app."

    ollama_client.generate = fake_generate
    try:
        await init_db()
        await insert_message(channel=channel, sender="user", content=prompt, msg_type="message")
        await process_message(channel, prompt)

        saw_active = False
        for _ in range(30):
            status = get_conversation_status(channel)
            if status.get("active"):
                saw_active = True
            if saw_active and not status.get("active"):
                break
            await asyncio.sleep(1)
        await asyncio.sleep(1)

        messages = await get_messages(channel, limit=120)
        output = ["# Segment 2 Baseline Conversation", "", f"Channel: {channel}", f"Prompt: {prompt}", ""]
        for msg in messages:
            content = (msg.get("content") or "").replace("\n", " ")
            output.append(f"- {msg.get('sender')}: {content}")

        out_path = Path("C:/AI_WORKSPACE/ai-office/tests/segment2_conversation_baseline.md")
        out_path.write_text("\n".join(output), encoding="utf-8")
        print("BASELINE_LOG_WRITTEN", out_path)
        print("BASELINE_TOTAL_MESSAGES", len(messages))
    finally:
        ollama_client.generate = original_generate


if __name__ == "__main__":
    asyncio.run(main())
