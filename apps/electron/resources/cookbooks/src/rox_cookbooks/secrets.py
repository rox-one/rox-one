from __future__ import annotations

import os
import re
from typing import Mapping

from .catalog import Catalog, CatalogItem


def env_for_item(
    catalog: Catalog,
    item: CatalogItem,
    store: Mapping[str, str] | None = None,
) -> dict[str, str]:
    source = store if store is not None else os.environ
    env: dict[str, str] = {}
    for key in item.required_secrets:
        env_name = catalog.secret_map[key]
        value = source.get(key) or source.get(env_name)
        if value:
            env[env_name] = value
    # Product policy: the ROX gateway (api.rox.one/v1) is the always-default
    # OpenAI-compatible provider for notebook code, so the catalog's
    # ``defaultEnv`` base URLs are layered over every item's kernel env.
    # ``setdefault`` means an explicit credential value — or any same-named key
    # already in ``env`` — always wins over a colliding default.
    for name, value in catalog.default_env.items():
        env.setdefault(name, value)
    return env


def missing_secrets(
    catalog: Catalog,
    item: CatalogItem,
    store: Mapping[str, str] | None = None,
) -> list[str]:
    source = store if store is not None else os.environ
    missing: list[str] = []
    for key in item.required_secrets:
        env_name = catalog.secret_map[key]
        if not (source.get(key) or source.get(env_name)):
            missing.append(key)
    return missing


_MISSING_ENV = re.compile(
    r"(KeyError|NoneType|api[_ ]?key|ANTHROPIC|OPENAI|PINECONE|WEAVIATE|LANGFUSE|"
    r"environment variable|os\.environ)",
    re.I,
)


def rewrite_missing_secret_error(
    catalog: Catalog,
    item: CatalogItem,
    traceback_text: str,
    store: Mapping[str, str] | None = None,
) -> str | None:
    missing = missing_secrets(catalog, item, store)
    if not missing:
        return None
    if not _MISSING_ENV.search(traceback_text) and "401" not in traceback_text:
        return None
    names = ", ".join(missing)
    return (
        f"Missing ROX credential(s): {names}. "
        "Add them in ROX credentials, then rerun this cell. "
        "Do not paste keys into the notebook."
    )


def redact_output(text: str, secret_values: list[str]) -> str:
    """Best-effort masking of known secret values in a cell output stream.

    Values are replaced longest-first so a secret that starts with another
    secret is masked whole instead of leaving its tail visible. Deterministic
    tie-break keeps the result stable for equal-length values.
    """
    out = text
    for value in sorted({v for v in secret_values if v}, key=lambda s: (-len(s), s)):
        out = out.replace(value, "***")
    return out


class RedactingOutputStream:
    """Incremental, line-buffered twin of :func:`redact_output` (wave 15).

    A streaming reader never sees a whole cell's output at once, so masking has
    to happen *as text arrives* without ever emitting a secret that a read
    boundary would otherwise split. ``feed`` therefore holds back two things:

    * the trailing partial line (no ``\\n`` yet) — a secret on that line may be
      completed by the next ``feed``;
    * ``holdback = max(len(v) for v in values if v) - 1`` characters of safety
      margin — only the "safe prefix" of the buffer is released, so a value that
      *starts* inside the released region but ends past it cannot leak either.

    Only complete lines (and, at ``flush``, the final remainder) are masked, via
    the same longest-first algorithm as :func:`redact_output`. ``feed`` returns
    the already-masked text that is safe to emit; ``flush`` returns whatever is
    still buffered, masked, at cell end / kill.
    """

    def __init__(self, secret_values: list[str]) -> None:
        self._values = [value for value in (secret_values or []) if value]
        holdback = max((len(value) for value in self._values), default=0) - 1
        self._holdback = holdback if holdback > 0 else 0
        self._buf = ""

    def _mask(self, text: str) -> str:
        return redact_output(text, self._values)

    def feed(self, text: str) -> str:
        """Append ``text``; return the masked, complete-line prefix that is safe."""
        if not text:
            return ""
        self._buf += text
        limit = len(self._buf) - self._holdback
        if limit <= 0:
            return ""
        cut = self._buf.rfind("\n", 0, limit)
        if cut == -1:
            return ""
        cut += 1
        chunk = self._buf[:cut]
        self._buf = self._buf[cut:]
        return self._mask(chunk)

    def flush(self) -> str:
        """Return the masked remainder (the held tail) and clear the buffer."""
        chunk = self._mask(self._buf)
        self._buf = ""
        return chunk


def redact_output_stream(secret_values: list[str]) -> RedactingOutputStream:
    """A fresh incremental redactor for one output stream (see the class above)."""
    return RedactingOutputStream(secret_values)
