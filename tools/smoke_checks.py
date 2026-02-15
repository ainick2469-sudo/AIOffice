from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
sys.path.insert(0, str(ROOT))

import server.database as db
from server.main import app


def _set_openai_key(value: str) -> None:
    lines = []
    if ENV_PATH.exists():
        lines = ENV_PATH.read_text(encoding="utf-8").splitlines()

    out = []
    updated = False
    for line in lines:
        if line.startswith("OPENAI_API_KEY="):
            out.append(f"OPENAI_API_KEY={value}")
            updated = True
        else:
            out.append(line)

    if not updated:
        if out and out[-1].strip():
            out.append("")
        out.append(f"OPENAI_API_KEY={value}")

    ENV_PATH.write_text("\n".join(out) + "\n", encoding="utf-8")


async def _fresh_seed_has_codex() -> tuple[bool, int]:
    original_db = db.DB_PATH
    test_db = ROOT / "data" / "test_seed.db"
    if test_db.exists():
        test_db.unlink()

    db.DB_PATH = test_db
    try:
        await db.init_db()
        agents = await db.get_agents(active_only=False)
        has_codex = any(agent["id"] == "codex" for agent in agents)
        return has_codex, len(agents)
    finally:
        db.DB_PATH = original_db
        if test_db.exists():
            test_db.unlink()


def main() -> None:
    has_codex, count = asyncio.run(_fresh_seed_has_codex())
    print(f"SEED_CODEX_PRESENT={has_codex}")
    print(f"SEED_AGENT_COUNT={count}")

    client = TestClient(app)

    list_resp = client.get("/api/agents?active_only=false")
    list_ok = list_resp.status_code == 200 and any(a["id"] == "codex" for a in list_resp.json())
    print(f"API_LIST_HAS_CODEX={list_ok}")

    invalid_resp = client.patch("/api/agents/codex", json={"backend": "invalid-backend"})
    print(f"PATCH_INVALID_BACKEND_STATUS={invalid_resp.status_code}")

    valid_resp = client.patch("/api/agents/codex", json={"role": "Implementation Overseer"})
    valid_ok = valid_resp.status_code == 200 and valid_resp.json().get("role") == "Implementation Overseer"
    print(f"PATCH_VALID_UPDATE_OK={valid_ok}")

    original_env = ENV_PATH.read_text(encoding="utf-8") if ENV_PATH.exists() else ""
    try:
        _set_openai_key("SMOKE_TEST_PLACEHOLDER")
        status_true = client.get("/api/openai/status")
        print(f"OPENAI_STATUS_WITH_KEY={status_true.json().get('available')}")

        _set_openai_key("")
        status_false = client.get("/api/openai/status")
        print(f"OPENAI_STATUS_WITHOUT_KEY={status_false.json().get('available')}")
    finally:
        if original_env:
            ENV_PATH.write_text(original_env, encoding="utf-8")
        else:
            if ENV_PATH.exists():
                ENV_PATH.unlink()


if __name__ == "__main__":
    main()
