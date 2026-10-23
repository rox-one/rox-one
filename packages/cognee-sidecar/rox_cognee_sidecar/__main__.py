from __future__ import annotations

import asyncio
import os
import sys

from .server import MAX_LINE_BYTES, serve


async def _amain() -> int:
    # Protocol frames must be the only bytes on the real stdout. Capture it
    # before redirecting sys.stdout so cognee/fastembed/hf prints cannot
    # interleave with JSON-RPC. Fake backend is for tests only — the host
    # must never set ROX_COGNEE_FAKE_BACKEND in production.
    real_out = sys.stdout.buffer
    sys.stdout = sys.stderr

    if os.environ.get("ROX_COGNEE_FAKE_BACKEND") == "1":
        from .fake_backend import FakeBackend

        backend = FakeBackend()
    else:
        from .cognee_backend import CogneeBackend
        from .config import SidecarConfig

        backend = CogneeBackend(SidecarConfig.from_env())
    loop = asyncio.get_running_loop()
    stdin = sys.stdin.buffer

    # Thread-based reads work on every platform (Windows' Proactor loop has no
    # connect_read_pipe for stdin).
    async def read_line() -> bytes:
        return await loop.run_in_executor(None, stdin.readline, MAX_LINE_BYTES + 1)

    await serve(backend, read_line, out=real_out)
    return 0


def main() -> None:
    try:
        sys.exit(asyncio.run(_amain()))
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:  # noqa: BLE001
        print(f"[rox-cognee] fatal: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
