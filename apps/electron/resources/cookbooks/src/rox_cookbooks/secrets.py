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
