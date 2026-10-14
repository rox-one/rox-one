from __future__ import annotations

from .catalog import Catalog, CatalogItem


def _haystack(item: CatalogItem) -> str:
    return " ".join(
        [item.id, item.title, item.vendor, item.kind, *item.topics, *item.tags]
    ).lower()


def search_items(catalog: Catalog, query: str) -> list[CatalogItem]:
    """Free-text search over id, title, vendor, kind, topics and tags.

    Every whitespace-separated token must appear somewhere in the item's
    haystack (AND). An empty or whitespace-only query returns every item.
    """
    tokens = query.lower().split()
    if not tokens:
        return list(catalog.items)
    hits: list[CatalogItem] = []
    for item in catalog.items:
        hay = _haystack(item)
        if all(token in hay for token in tokens):
            hits.append(item)
    return hits


def items_by_topic(catalog: Catalog, topic: str) -> list[CatalogItem]:
    """Items declared under ``topic``; an unknown topic returns ``[]``."""
    return catalog.items_for_topic(topic)


def group_by_topic(catalog: Catalog) -> dict[str, list[CatalogItem]]:
    """Map every catalog topic to its items, preserving declared topic order.

    Topics with no items are present with an empty list, so callers can
    distinguish "known topic, nothing filed" from a missing key.
    """
    groups: dict[str, list[CatalogItem]] = {topic: [] for topic in catalog.topics}
    for item in catalog.items:
        for topic in item.topics:
            groups.setdefault(topic, []).append(item)
    return groups
