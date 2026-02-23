from pathlib import Path
import json

from server import project_manager


PACKAGE_JSON = {
  "name": "ai-office-react-app",
  "private": True,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.2",
    "vite": "^5.4.8"
  }
}

APP_JSX = """export default function App() {
  return (
    <main style={{ padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1>React starter ready</h1>
      <p>Edit <code>src/App.jsx</code> to begin.</p>
    </main>
  );
}
"""

MAIN_JSX = """import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
"""

INDEX_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Office React Starter</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
"""

VITE_CONFIG = """import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
"""

STYLES_CSS = """body {
  margin: 0;
  background: #0f172a;
  color: #e2e8f0;
}

code {
  background: #1e293b;
  border-radius: 4px;
  padding: 0 6px;
}
"""


async def scaffold_react_app(arg: str, context: dict):
  channel = str((context or {}).get("channel") or "main").strip() or "main"
  active = await project_manager.get_active_project(channel)
  root = Path(active["path"]).resolve()
  root.mkdir(parents=True, exist_ok=True)

  file_map = {
    "package.json": json.dumps(PACKAGE_JSON, indent=2) + "\n",
    "index.html": INDEX_HTML,
    "vite.config.js": VITE_CONFIG,
    "src/App.jsx": APP_JSX,
    "src/main.jsx": MAIN_JSX,
    "src/styles.css": STYLES_CSS,
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
      f"Created React starter in '{project}' with {len(written)} files. "
      "Next: run `npm install` then `npm run dev`."
    ),
  }
