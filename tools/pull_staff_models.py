from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server import ollama_client  # noqa: E402


def _recommended_models() -> list[str]:
    registry_path = ROOT / "agents" / "registry.json"
    data = json.loads(registry_path.read_text(encoding="utf-8"))
    seen = set()
    ordered = []
    for agent in data.get("agents", []):
        if agent.get("backend") != "ollama" or not agent.get("active", True):
            continue
        model = (agent.get("model") or "").strip()
        if model and model not in seen:
            ordered.append(model)
            seen.add(model)
    return ordered


async def main() -> int:
    models = _recommended_models()
    print(f"RECOMMENDED_MODELS={models}")

    if not await ollama_client.is_available():
        print("PULL_SKIPPED: Ollama is not reachable on http://127.0.0.1:11434")
        return 1

    installed = set(await ollama_client.list_models())
    missing = [m for m in models if m not in installed]
    print(f"MISSING_MODELS={missing}")

    if not missing:
        print("PULL_NOOP: all recommended models already installed")
        return 0

    failures = []
    for model_name in missing:
        result = await ollama_client.pull_model(model_name)
        if result.get("ok"):
            print(f"PULL_OK: {model_name}")
        else:
            failures.append(result)
            print(f"PULL_FAIL: {model_name} -> {result.get('error', 'unknown')}")

    if failures:
        print(f"PULL_PARTIAL: {len(missing) - len(failures)} succeeded, {len(failures)} failed")
        return 1

    print(f"PULL_DONE: {len(missing)} model(s) pulled")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
