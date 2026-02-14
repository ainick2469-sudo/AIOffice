"""AI Office — Desktop App Launcher.
Double-click to start. Close window to stop everything.
"""

import os
import sys
import time
import signal
import threading
import logging
import subprocess

# Ensure we're running from the right directory
APP_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(APP_DIR)

# Add app dir to path
sys.path.insert(0, APP_DIR)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("ai-office.app")


def check_build():
    """Check if frontend is built. Build if not."""
    dist = os.path.join(APP_DIR, "client-dist")
    if not os.path.exists(dist) or not os.path.exists(os.path.join(dist, "index.html")):
        logger.info("Frontend not built — building now...")
        client_dir = os.path.join(APP_DIR, "client")
        result = subprocess.run(
            ["npx", "vite", "build"],
            cwd=client_dir, shell=True,
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            logger.error(f"Build failed: {result.stderr}")
            sys.exit(1)
        logger.info("Frontend built successfully")


def start_server():
    """Start FastAPI server in a thread."""
    import uvicorn

    # Clear pycache to avoid stale imports
    cache_dir = os.path.join(APP_DIR, "server", "__pycache__")
    if os.path.exists(cache_dir):
        import shutil
        shutil.rmtree(cache_dir, ignore_errors=True)

    uvicorn.run(
        "server.main:app",
        host="127.0.0.1",
        port=8000,
        log_level="info",
        reload=False,  # No reload in production
    )


def wait_for_server(url="http://127.0.0.1:8000/api/health", timeout=30):
    """Wait for the server to be ready."""
    import urllib.request
    start = time.time()
    while time.time() - start < timeout:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def main():
    """Launch AI Office desktop app."""
    logger.info("🏢 Starting AI Office Desktop...")

    # Step 1: Check frontend build
    check_build()

    # Step 2: Start backend server in background thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    # Step 3: Wait for server to be ready
    logger.info("⏳ Waiting for server...")
    if not wait_for_server():
        logger.error("❌ Server failed to start!")
        sys.exit(1)
    logger.info("✅ Server ready")

    # Step 4: Open desktop window
    try:
        import webview
        logger.info("🖥️  Opening AI Office window...")

        window = webview.create_window(
            title="AI Office",
            url="http://127.0.0.1:8000",
            width=1400,
            height=900,
            min_size=(800, 600),
            resizable=True,
            text_select=True,
        )

        # Start webview (blocks until window is closed)
        webview.start(debug=False)

    except ImportError:
        # Fallback: open in browser if pywebview not available
        logger.warning("PyWebView not installed — opening in browser instead")
        import webbrowser
        webbrowser.open("http://127.0.0.1:8000")
        logger.info("Press Ctrl+C to stop the server")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass

    logger.info("🏢 AI Office closed.")
    # Force kill everything
    os._exit(0)


if __name__ == "__main__":
    main()
