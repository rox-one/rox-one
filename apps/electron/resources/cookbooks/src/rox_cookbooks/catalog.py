from __future__ import annotations

import json
import re
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

VENDORS = frozenset(
    {"openai", "anthropic", "pinecone", "weaviate", "langfuse", "langchain"}
)
KINDS = frozenset({"ipynb", "md"})
# Tag marking an item that the v1 Python-kernel Lab cannot run (GPU, Docker, ...).
UNSUPPORTED_TAG = "unsupported"
# Item ids reach HTML ``data-id`` attributes and workspace directory names, so
# they are restricted to a conservative charset: a lowercase alphanumeric first
# character, then lowercase alphanumerics, dots, underscores or dashes.
ITEM_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*$")


class CatalogError(ValueError):
    pass


@dataclass(frozen=True)
class CatalogItem:
    id: str
    title: str
    vendor: str
    topics: tuple[str, ...]
    kind: str
    path: str
    required_secrets: tuple[str, ...]
    dependencies: tuple[str, ...]
    # Optional catalog fields. Kept last so existing positional construction and
    # catalog.json payloads without these keys stay valid.
    tags: tuple[str, ...] = ()
    # Display-level status for an item whose source file is missing: the catalog
    # still loads (spec: "Catalog file missing" -> card disabled) and the UI
    # renders the card as disabled instead of refusing the whole catalog.
    # ``load_catalog`` sets both fields.
    disabled: bool = False
    disabled_reason: str = ""

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> CatalogItem:
        python = raw.get("python") or {}
        return cls(
            id=str(raw["id"]),
            title=str(raw["title"]),
            vendor=str(raw["vendor"]),
            topics=tuple(raw.get("topics") or ()),
            kind=str(raw["kind"]),
            path=str(raw["path"]),
            required_secrets=tuple(raw.get("requiredSecrets") or ()),
            dependencies=tuple(python.get("dependencies") or ()),
            tags=tuple(raw.get("tags") or ()),
        )

    @property
    def supported(self) -> bool:
        """False when the item needs more than the v1 local Python kernel.

        The v1 Lab runs only a local Python kernel, so GPU/Docker items are
        tagged ``unsupported`` and must not be offered a Run action.
        """
        return UNSUPPORTED_TAG not in self.tags


@dataclass
class Catalog:
    version: int
    revision: str
    secret_map: dict[str, str]
    topics: tuple[str, ...]
    items: tuple[CatalogItem, ...]
    root: Path
    # Declared tag vocabulary (catalog.json ``tags``). Item tags must be drawn
    # from it, mirroring how ``topics`` constrains ``CatalogItem.topics``.
    tags: tuple[str, ...] = ()

    def item(self, item_id: str) -> CatalogItem:
        for it in self.items:
            if it.id == item_id:
                return it
        raise CatalogError(f"unknown item: {item_id}")

    def source_path(self, item: CatalogItem) -> Path:
        return (self.root / item.path).resolve()

    def items_for_topic(self, topic: str) -> list[CatalogItem]:
        """Items carrying ``topic``; an unknown or empty topic yields ``[]``."""
        key = topic.strip().lower()
        if not key:
            return []
        return [it for it in self.items if key in {t.lower() for t in it.topics}]


def default_catalog_root() -> Path:
    return Path(__file__).resolve().parents[2] / "resources" / "cookbooks"


def load_catalog(root: Path | None = None) -> Catalog:
    root = (root or default_catalog_root()).resolve()
    data = json.loads((root / "catalog.json").read_text(encoding="utf-8"))
    catalog = Catalog(
        version=int(data["version"]),
        revision=str(data["revision"]),
        secret_map=dict(data.get("secretMap") or {}),
        topics=tuple(data.get("topics") or ()),
        items=tuple(
            _with_file_status(CatalogItem.from_dict(x), root)
            for x in data.get("items") or []
        ),
        root=root,
        tags=tuple(data.get("tags") or ()),
    )
    validate_catalog(catalog)
    return catalog


def _with_file_status(item: CatalogItem, root: Path) -> CatalogItem:
    """Return ``item`` marked disabled when its source file is missing.

    A single missing fixture file must not empty the whole catalog, so the item
    stays in place and is flagged for the UI instead of raising.
    """
    if (root / item.path).resolve().is_file():
        return item
    return replace(item, disabled=True, disabled_reason="file missing")


def validate_catalog(catalog: Catalog) -> None:
    if catalog.version != 1:
        raise CatalogError(f"unsupported catalog version {catalog.version}")
    ids: set[str] = set()
    vendors_seen: set[str] = set()
    topic_set = set(catalog.topics)
    tag_set = set(catalog.tags)
    for item in catalog.items:
        if not ITEM_ID_PATTERN.fullmatch(item.id):
            raise CatalogError(f"invalid id: {item.id!r}")
        if item.id in ids:
            raise CatalogError(f"duplicate id: {item.id}")
        ids.add(item.id)
        if item.vendor not in VENDORS:
            raise CatalogError(f"unknown vendor: {item.vendor}")
        vendors_seen.add(item.vendor)
        if item.kind not in KINDS:
            raise CatalogError(f"unknown kind: {item.kind}")
        for topic in item.topics:
            if topic not in topic_set:
                raise CatalogError(f"undeclared topic {topic} on {item.id}")
        if len(set(item.tags)) != len(item.tags):
            raise CatalogError(f"duplicate tag on {item.id}")
        for tag in item.tags:
            if tag not in tag_set:
                raise CatalogError(f"undeclared tag {tag} on {item.id}")
        for secret in item.required_secrets:
            if secret not in catalog.secret_map:
                raise CatalogError(f"unmapped secret {secret} on {item.id}")
        src = catalog.source_path(item)
        # A missing file disables the item (``load_catalog`` sets ``disabled``);
        # it must not empty the catalog. Path-shape checks still apply.
        if src.suffix.lstrip(".") != item.kind:
            raise CatalogError(f"kind/path mismatch for {item.id}")
        if catalog.root not in src.parents:
            raise CatalogError(f"path escapes catalog root: {item.path}")
    missing_vendors = VENDORS - vendors_seen
    if missing_vendors:
        raise CatalogError(f"catalog missing vendors: {sorted(missing_vendors)}")
