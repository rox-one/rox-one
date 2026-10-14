"""Catalog UI for the ROX Cookbooks Lab.

This is the headless surface behind the ROX sidebar: it lists, searches and
groups catalog items by topic, and annotates each card with the secret status
chips that the UI renders (have / missing, never a value).

The CLI is intentionally thin; the same functions back the Electron renderer:

    PYTHONPATH=src python3 -m rox_cookbooks.ui list
    PYTHONPATH=src python3 -m rox_cookbooks.ui search rag
    PYTHONPATH=src python3 -m rox_cookbooks.ui group-by-topic
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

from .catalog import Catalog, CatalogItem, load_catalog
from .copies import CookbookCopies, CopyError
from .kernel import discover_pythons, execute_code
from .notebooks import Notebook
from .search import group_by_topic, items_by_topic, search_items
from .secrets import env_for_item, missing_secrets


@dataclass(frozen=True)
class SecretChip:
    """A single credential status chip for a catalog card.

    ``key`` is the ROX credential key from ``catalog.secretMap`` and ``env`` is
    the kernel environment variable it maps to. Only presence is carried here;
    the value itself is never read into the UI.
    """

    key: str
    env: str
    present: bool

    @property
    def status(self) -> str:
        return "have" if self.present else "missing"

    def render(self) -> str:
        return f"[{self.status}] {self.key}"


def secret_chips(
    catalog: Catalog,
    item: CatalogItem,
    store: Mapping[str, str] | None = None,
) -> list[SecretChip]:
    """Status chips for an item's required secrets, in catalog order."""
    missing = set(missing_secrets(catalog, item, store))
    return [
        SecretChip(key=key, env=catalog.secret_map[key], present=key not in missing)
        for key in item.required_secrets
    ]


def catalog_cards(
    catalog: Catalog,
    store: Mapping[str, str] | None = None,
) -> list[dict]:
    cards = []
    for item in catalog.items:
        chips = secret_chips(catalog, item, store)
        cards.append(
            {
                "id": item.id,
                "title": item.title,
                "vendor": item.vendor,
                "topics": list(item.topics),
                "kind": item.kind,
                "tags": list(item.tags),
                "secretsMissing": [c.key for c in chips if not c.present],
                "secretsHave": [c.key for c in chips if c.present],
                # Display-only status; the catalog itself always loads.
                "disabled": item.disabled,
                "disabledReason": item.disabled_reason,
            }
        )
    return cards


def format_item(
    catalog: Catalog,
    item: CatalogItem,
    store: Mapping[str, str] | None = None,
) -> str:
    """One-line card: title, vendor, kind, topics, chips, disabled marker."""
    chips = secret_chips(catalog, item, store)
    chip_text = " ".join(chip.render() for chip in chips) if chips else "[no secrets]"
    topics = ", ".join(item.topics) if item.topics else "-"
    marker = f" [{item.disabled_reason}]" if item.disabled else ""
    return f"{item.title} ({item.id}) | {item.vendor} | {item.kind} | topics: {topics} | {chip_text}{marker}"


def render_items(
    catalog: Catalog,
    items: Sequence[CatalogItem],
    store: Mapping[str, str] | None = None,
) -> str:
    return "\n".join(format_item(catalog, item, store) for item in items)


def render_topic_groups(
    catalog: Catalog,
    groups: Mapping[str, Sequence[CatalogItem]],
    store: Mapping[str, str] | None = None,
) -> str:
    blocks: list[str] = []
    for topic, items in groups.items():
        blocks.append(f"## {topic} ({len(items)})")
        blocks.extend(
            "  " + format_item(catalog, item, store) for item in items
        )
    return "\n".join(blocks)


def load_store(path: str | Path | None) -> dict[str, str] | None:
    """Load a credential-status store: a JSON object of key -> value.

    Values are used only to decide presence; they are never printed. ``None``
    means "probe the real process environment".

    A missing (or otherwise unreadable) file is an empty store: pointing
    ``--store`` at a path that does not exist yet must not crash startup.
    Malformed JSON is an error.
    """
    if path is None:
        return None
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError:
        return {}
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"store file is not valid JSON: {path}") from exc
    if not isinstance(data, dict):
        raise ValueError("store file must contain a JSON object")
    return {str(k): str(v) for k, v in data.items()}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rox-cookbooks",
        description="Catalog UI for the ROX Cookbooks Lab.",
    )
    parser.add_argument(
        "--catalog-root",
        default=None,
        help="catalog directory (defaults to the bundled resources/cookbooks)",
    )
    parser.add_argument(
        "--store",
        default=None,
        help="JSON file mapping credential keys to values (status only)",
    )
    parser.add_argument(
        "--workspace",
        default=None,
        help="workspace root for personal copies (open/run/reset)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    list_cmd = sub.add_parser("list", help="list catalog items")
    list_cmd.add_argument("--topic", default=None, help="only items in this topic")

    search_cmd = sub.add_parser("search", help="search items by term")
    search_cmd.add_argument("query", nargs="?", default="", help="search text")

    group_cmd = sub.add_parser(
        "group-by-topic",
        aliases=["topics"],
        help="group items by topic",
    )
    group_cmd.add_argument("--topic", default=None, help="only this topic")

    sub.add_parser("cards", help="JSON catalog cards (secret ids only)")

    open_cmd = sub.add_parser("open", help="copy item into workspace")
    open_cmd.add_argument("item_id")
    open_cmd.add_argument("--new-copy", action="store_true")

    run_cmd = sub.add_parser("run", help="run a code cell in the workspace copy")
    run_cmd.add_argument("item_id")
    run_cmd.add_argument("--cell", type=int, default=None, help="code cell index (nth code cell, 0-based)")
    run_cmd.add_argument("--timeout", type=float, default=60.0)

    reset_cmd = sub.add_parser("reset", help="restore copy from catalog")
    reset_cmd.add_argument("item_id")
    reset_cmd.add_argument("--confirm", action="store_true")
    reset_cmd.add_argument("--wipe", action="store_true")

    banner_cmd = sub.add_parser("banner", help="missing credential ids for an item")
    banner_cmd.add_argument("item_id")

    sub.add_parser("pythons", help="discover local CPython interpreters")

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    catalog = load_catalog(Path(args.catalog_root) if args.catalog_root else None)
    store = load_store(args.store)

    if args.command == "list":
        items = (
            items_by_topic(catalog, args.topic)
            if args.topic
            else list(catalog.items)
        )
        print(render_items(catalog, items, store))
        return 0

    if args.command == "search":
        print(render_items(catalog, search_items(catalog, args.query), store))
        return 0

    if args.command in ("group-by-topic", "topics"):
        groups = group_by_topic(catalog)
        if args.topic:
            groups = {args.topic: groups.get(args.topic, [])}
        print(render_topic_groups(catalog, groups, store))
        return 0

    if args.command == "cards":
        print(json.dumps(catalog_cards(catalog, store), indent=2))
        return 0

    workspace = Path(args.workspace) if args.workspace else Path.cwd() / ".rox-cookbooks-workspace"
    copies = CookbookCopies(workspace, catalog)

    if args.command == "open":
        copy = copies.open(args.item_id, new_copy=args.new_copy)
        print(str(copy.document))
        return 0

    if args.command == "run":
        item = catalog.item(args.item_id)
        if not item.supported:
            print(f"unsupported: {item.id} (tagged unsupported; no Run)", file=sys.stderr)
            return 3
        if item.kind != "ipynb":
            print(f"no kernel: {item.id} is markdown", file=sys.stderr)
            return 4
        copy = copies.open(args.item_id)
        nb = Notebook.open(copy)
        code_indexes = [i for i, c in enumerate(nb.cells) if nb.cell_type(i) == "code"]
        if not code_indexes:
            print("no code cells", file=sys.stderr)
            return 5
        idx = code_indexes[0] if args.cell is None else code_indexes[args.cell]
        env = env_for_item(catalog, item, store)
        result = execute_code(
            copy,
            nb.source(idx),
            env=env,
            timeout=args.timeout,
            catalog=catalog,
            item=item,
            store=store if store is not None else {},
        )
        missing = missing_secrets(catalog, item, store if store is not None else {})
        if missing:
            print("banner: missing " + ", ".join(missing), file=sys.stderr)
        print(json.dumps({k: result[k] for k in result if k != "install_log"}, default=str))
        return 0 if result.get("ok") else 1

    if args.command == "reset":
        copy = copies.open(args.item_id)
        try:
            copies.reset(copy, confirm=args.confirm, wipe_outputs=args.wipe)
        except CopyError as exc:
            print(str(exc), file=sys.stderr)
            return 6
        print(str(copy.document))
        return 0

    if args.command == "banner":
        item = catalog.item(args.item_id)
        print(json.dumps({"missing": missing_secrets(catalog, item, store if store is not None else {})}))
        return 0

    if args.command == "pythons":
        print("\n".join(str(p) for p in discover_pythons()))
        return 0

    return 2


if __name__ == "__main__":
    sys.exit(main())
