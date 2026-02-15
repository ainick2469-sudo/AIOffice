"""AI Office OpenAI adapter to match ollama_client.generate interface."""

from typing import Optional
from . import openai_client


def is_available() -> bool:
    return openai_client.is_available()


async def generate(
    prompt: str,
    system: str = "",
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str = None,
    channel: str = None,
    project_name: str = None,
) -> Optional[str]:
    messages = [{"role": "user", "content": prompt}]
    return await openai_client.chat(
        messages=messages,
        system=system,
        temperature=temperature,
        max_tokens=max_tokens,
        model=model,
        channel=channel,
        project_name=project_name,
    )
