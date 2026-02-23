from pathlib import Path

from server import project_manager


HTML_CONTENT = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Office Web Scaffold</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="app">
      <h1>Web scaffold ready</h1>
      <p>Edit <code>app.js</code> and <code>styles.css</code> to start building.</p>
      <button id="ping">Click me</button>
      <pre id="output"></pre>
    </main>
    <script type="module" src="./app.js"></script>
  </body>
</html>
"""

CSS_CONTENT = """:root {
  color-scheme: dark light;
  font-family: Inter, system-ui, sans-serif;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #111827;
  color: #e5e7eb;
}

.app {
  width: min(640px, calc(100vw - 48px));
  border: 1px solid #334155;
  border-radius: 12px;
  padding: 24px;
  background: #0f172a;
}

button {
  border: 1px solid #3b82f6;
  background: #1d4ed8;
  color: #eff6ff;
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
}
"""

JS_CONTENT = """const output = document.getElementById('output');
const button = document.getElementById('ping');

button?.addEventListener('click', () => {
  const stamp = new Date().toLocaleTimeString();
  if (output) output.textContent = `Button clicked at ${stamp}`;
});
"""


async def scaffold_web_project(arg: str, context: dict):
  channel = str((context or {}).get("channel") or "main").strip() or "main"
  active = await project_manager.get_active_project(channel)
  root = Path(active["path"]).resolve()
  root.mkdir(parents=True, exist_ok=True)

  files = {
    "index.html": HTML_CONTENT,
    "styles.css": CSS_CONTENT,
    "app.js": JS_CONTENT,
  }
  written = []
  for rel, content in files.items():
    target = root / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    written.append(rel)

  project = active.get("project") or root.name
  return {
    "ok": True,
    "output": f"Created web scaffold in '{project}': {', '.join(written)}",
  }
