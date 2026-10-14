from __future__ import annotations

import asyncio
import os
import sys

from .server import serve


async def _amain() -> int:
    if os.environ.get("ROX_COGNEE_FAKE_BACKEND") == "1":
        from .fake_backend import FakeBackend

        backend = FakeBackend()
    else:
        from .cognee_backend import CogneeBackend
        from .config import SidecarConfig

        backend = CogneeBackend(SidecarConfig.from_env())
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader(limit=16 * 1024 * 1024)
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    await serve(backend, reader.readline)
    return 0


def main() -> None:
    try:
        sys.exit(asyncio.run(_amain()))
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:  # noqa: BLE001
        print(f"[rox-cognee] fatal: {type(e).__name__}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
