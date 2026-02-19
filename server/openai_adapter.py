"""AI Office OpenAI adapter to match ollama_client.generate interface."""

from typing import Optional
from . import openai_client


def is_available() -> bool:
    return openai_client.is_available()


def get_last_error() -> str:
    return openai_client.get_last_error()


async def generate(
    prompt: str,
    system: str = "",
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
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
        api_key=api_key,
        base_url=base_url,
        channel=channel,
        project_name=project_name,
    )


async def probe_connection(
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    timeout_seconds: int = 15,
) -> dict:
    return await openai_client.probe_connection(
        model=model,
        api_key=api_key,
        base_url=base_url,
        timeout_seconds=timeout_seconds,
    )
