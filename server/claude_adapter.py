"""AI Office — Claude Adapter. Wraps claude_client to match ollama_client interface."""

import logging
from typing import Optional
from . import claude_client

logger = logging.getLogger("ai-office.claude-adapter")


def is_available() -> bool:
    return claude_client.is_available()


async def generate(
    prompt: str,
    system: str = "",
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str = None,
    channel: str = None,
    project_name: str = None,
) -> Optional[str]:
    """Generate using Claude API — matches ollama_client.generate interface."""
    messages = [{"role": "user", "content": prompt}]
    return await claude_client.chat(
        messages=messages,
        system=system,
        temperature=temperature,
        max_tokens=max_tokens,
        model=model,
        channel=channel,
        project_name=project_name,
    )
