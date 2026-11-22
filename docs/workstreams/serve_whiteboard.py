#!/usr/bin/env python3
"""Serve the Rox workstream whiteboard from this directory.

Standard library only. Defaults to http://127.0.0.1:8799/whiteboard.html.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import signal
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8799
HOST = "127.0.0.1"
PAGE = "/whiteboard.html"
NO_STORE_SUFFIXES = (".html", ".js", ".css", ".json")


class WhiteboardHandler(http.server.SimpleHTTPRequestHandler):
    """Static file handler with no-store headers for app assets."""

    server_version = "RoxWhiteboard/1.0"
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
    }

    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0].split("#", 1)[0].lower()
        if path.endswith(NO_STORE_SUFFIXES):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        try:
            code = int(args[1])
        except (IndexError, TypeError, ValueError):
            code = 0
        if code >= 400:
            sys.stderr.write("  %s\n" % (fmt % args))
            sys.stderr.flush()

    def log_error(self, fmt: str, *args) -> None:
        self.log_message(fmt, *args)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve the Rox workstream whiteboard on localhost."
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help="TCP port to listen on (default: %(default)s)",
    )
    parser.add_argument(
        "--no-open",
        action="store_true",
        help="do not open the page in the default browser",
    )
    args = parser.parse_args(argv)
    if not (1 <= args.port <= 65535):
        parser.error("--port must be between 1 and 65535")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    url = f"http://{HOST}:{args.port}{PAGE}"

    if not (ROOT / PAGE.lstrip("/")).is_file():
        print(
            f"warning: {PAGE.lstrip('/')} is not in {ROOT} yet; serving the directory anyway",
            file=sys.stderr,
        )

    handler = functools.partial(WhiteboardHandler, directory=str(ROOT))
    try:
        server = http.server.ThreadingHTTPServer((HOST, args.port), handler)
    except OSError as exc:
        print(f"error: cannot listen on {HOST}:{args.port}: {exc}", file=sys.stderr)
        print("hint: choose another port with --port", file=sys.stderr)
        return 1

    server.daemon_threads = True

    def _terminate(signum, frame):  # noqa: ARG001 - signal handler signature
        raise KeyboardInterrupt

    previous_sigterm = signal.signal(signal.SIGTERM, _terminate)

    print("Rox workstream whiteboard")
    print(f"serving {ROOT}")
    print(url, flush=True)
    print("Ctrl+C to stop", flush=True)

    if not args.no_open:
        opener = threading.Timer(0.4, lambda: webbrowser.open(url))
        opener.daemon = True
        opener.start()

    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nstopping", flush=True)
    finally:
        server.server_close()
        signal.signal(signal.SIGTERM, previous_sigterm)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
