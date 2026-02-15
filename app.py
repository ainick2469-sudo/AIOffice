"""AI Office desktop launcher with optional system tray controls."""

import os
import sys
import time
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
SYSTEM_ROOT = os.environ.get("SystemRoot", r"C:\Windows")
CMD_EXE = os.path.join(SYSTEM_ROOT, "System32", "cmd.exe")
RUNTIME_WRAPPER = os.path.join(APP_DIR, "with-runtime.cmd")
CLIENT_BUILD_CMD = os.path.join(APP_DIR, "client", "dev-build.cmd")


def _build_runtime_env():
    env = os.environ.copy()
    path_parts = [
        os.path.join(SYSTEM_ROOT, "System32"),
        SYSTEM_ROOT,
        r"C:\Program Files\nodejs",
        r"C:\Users\nickb\AppData\Local\Programs\Python\Python312",
    ]
    existing = env.get("PATH", "")
    env["PATH"] = ";".join(path_parts + [existing])
    return env


def check_build():
    """Check if frontend is built. Build if not."""
    dist = os.path.join(APP_DIR, "client-dist")
    if not os.path.exists(dist) or not os.path.exists(os.path.join(dist, "index.html")):
        logger.info("Frontend not built. Building now...")
        result = subprocess.run(
            [CMD_EXE, "/c", RUNTIME_WRAPPER, CLIENT_BUILD_CMD],
            cwd=APP_DIR,
            env=_build_runtime_env(),
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            logger.error("Build failed: %s", result.stdout or result.stderr)
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


class TrayController:
    """Manage the optional system tray icon for the desktop app."""

    def __init__(self):
        self.window = None
        self.icon = None
        self.enabled = False
        self.window_visible = True
        self._quit_requested = False
        self._pil_image = None
        self._pil_draw = None

    def attach_window(self, window):
        self.window = window

    def start(self):
        """Start tray icon in background. No-op if dependencies are missing."""
        try:
            import pystray
            from PIL import Image, ImageDraw
        except ImportError as exc:
            logger.warning("Tray support unavailable (%s). Install pystray and Pillow.", exc)
            return False

        self._pil_image = Image
        self._pil_draw = ImageDraw

        self.icon = pystray.Icon(
            "ai-office",
            self._make_icon_image(),
            "AI Office",
            menu=pystray.Menu(
                pystray.MenuItem("Show/Hide Window", self.toggle_window),
                pystray.MenuItem("Quit", self.quit_app),
            ),
        )

        thread = threading.Thread(target=self.icon.run, daemon=True, name="tray-icon")
        thread.start()
        self.enabled = True
        logger.info("System tray icon started.")
        return True

    def stop(self):
        if self.icon is not None:
            try:
                self.icon.stop()
            except Exception:
                logger.exception("Failed to stop tray icon cleanly.")

    def toggle_window(self, icon=None, item=None):
        """Tray callback: hide if visible, show if hidden."""
        if self.window is None:
            return

        try:
            if self.window_visible:
                self.window.hide()
                self.window_visible = False
                logger.info("Window hidden from tray.")
            else:
                self.window.show()
                # Some backends need restore after show to bring window forward.
                if hasattr(self.window, "restore"):
                    self.window.restore()
                self.window_visible = True
                logger.info("Window restored from tray.")
        except Exception:
            logger.exception("Failed to toggle window visibility.")

    def quit_app(self, icon=None, item=None):
        """Tray callback: quit app and server."""
        self._quit_requested = True
        logger.info("Quit selected from tray.")
        self.stop()

        if self.window is not None:
            try:
                self.window.destroy()
                return
            except Exception:
                logger.exception("Failed to destroy window from tray; forcing exit.")

        os._exit(0)

    def quit_requested(self):
        return self._quit_requested

    def _make_icon_image(self):
        """Create a simple fallback tray icon image."""
        image = self._pil_image.new("RGB", (64, 64), color=(24, 31, 42))
        draw = self._pil_draw.Draw(image)
        draw.rounded_rectangle((6, 6, 58, 58), radius=10, fill=(35, 98, 224))
        draw.rectangle((16, 20, 28, 44), fill=(255, 255, 255))
        draw.rectangle((34, 20, 48, 44), fill=(255, 255, 255))
        draw.rectangle((20, 26, 44, 38), fill=(35, 98, 224))
        return image


def main():
    """Launch AI Office desktop app."""
    logger.info("Starting AI Office Desktop...")

    # Step 1: Check frontend build
    check_build()

    # Step 2: Start backend server in background thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    # Step 3: Wait for server to be ready
    logger.info("Waiting for server...")
    if not wait_for_server():
        logger.error("Server failed to start.")
        sys.exit(1)
    logger.info("Server ready.")

    # Step 4: Open desktop window
    try:
        import webview

        tray = TrayController()
        logger.info("Opening AI Office window...")

        window = webview.create_window(
            title="AI Office",
            url="http://127.0.0.1:8000",
            width=1400,
            height=900,
            min_size=(800, 600),
            resizable=True,
            text_select=True,
        )

        tray.attach_window(window)
        tray.start()

        # Start webview (blocks until window is closed)
        webview.start(debug=False)
        tray.stop()

    except ImportError:
        logger.error("PyWebView is required for standalone desktop mode.")
        logger.error("Install dependencies from requirements.txt, then relaunch app.py.")
        sys.exit(1)

    logger.info("AI Office closed.")
    # Force kill everything
    os._exit(0)


if __name__ == "__main__":
    main()
