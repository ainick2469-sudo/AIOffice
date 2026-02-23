from pathlib import Path

from server import project_manager


MAIN_PY = """def greet(name: str = "world") -> str:
  return f"hello {name}"


if __name__ == "__main__":
  print(greet())
"""

REQUIREMENTS = """pytest>=8.0.0
"""

TEST_MAIN = """from main import greet


def test_greet_default():
  assert greet() == "hello world"
"""


async def scaffold_python_project(arg: str, context: dict):
  channel = str((context or {}).get("channel") or "main").strip() or "main"
  active = await project_manager.get_active_project(channel)
  root = Path(active["path"]).resolve()
  root.mkdir(parents=True, exist_ok=True)

  file_map = {
    "main.py": MAIN_PY,
    "requirements.txt": REQUIREMENTS,
    "tests/test_main.py": TEST_MAIN,
  }
  written = []
  for rel_path, content in file_map.items():
    target = root / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    written.append(rel_path)

  project = active.get("project") or root.name
  return {
    "ok": True,
    "output": (
      f"Created Python starter in '{project}': {', '.join(written)}. "
      "Next: `pip install -r requirements.txt` then `pytest`."
    ),
  }
