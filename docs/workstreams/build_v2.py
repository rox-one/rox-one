#!/usr/bin/env python3
"""Merge the ten-direction Russian fragments into task-board-v2.json.

The fragments are written by content workers under /tmp/rox-v2/:
  research-applied.json, engineering-product.json, cloud-security.json,
  enterprise-gtm.json, ecosystem-hardware.json, meta.json

The merge is structural: it flattens directions into divisions/groups/tasks,
computes waves from dependencies, marks wave-1 tasks ready, and rejects a
fragment that breaks the shape. It does not rewrite the human text.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRAGMENTS = Path("/tmp/rox-v2")
OUT = ROOT / "task-board-v2.json"

FRAGMENT_FILES = [
    "research-applied.json",
    "engineering-product.json",
    "cloud-security.json",
    "enterprise-gtm.json",
    "ecosystem-hardware.json",
]
META_FILE = "meta.json"

EXPECTED_PREFIX = {
    "research": "RES",
    "applied-ai": "AAI",
    "engineering": "ENG",
    "product": "PRD",
    "cloud": "CLD",
    "security": "SEC",
    "enterprise": "ENT",
    "gtm": "GTM",
    "ecosystem": "ECO",
    "hardware": "HW",
}

EXPECTED_DIRECTIONS = [
    ("research", "Исследования", "Research"),
    ("applied-ai", "Прикладной ИИ", "Applied AI"),
    ("engineering", "Инженерия", "Engineering"),
    ("product", "Продукт", "Product"),
    ("cloud", "Облако", "Cloud"),
    ("security", "Безопасность и доверие", "Security & Trust"),
    ("enterprise", "Корпоративный бизнес", "Enterprise"),
    ("gtm", "Рынок и рост", "Go-to-Market"),
    ("ecosystem", "Экосистема", "Ecosystem"),
    ("hardware", "Железо и устройства", "Hardware & Devices"),
]


def load(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def has_cyrillic(text: str) -> bool:
    return bool(re.search(r"[А-Яа-яЁё]", text or ""))


def fail(messages: list[str]) -> None:
    print("V2 INVALID", file=sys.stderr)
    for message in messages:
        print(f"- {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> int:
    errors: list[str] = []
    directions: list[dict] = []

    for name in FRAGMENT_FILES:
        path = FRAGMENTS / name
        if not path.is_file():
            fail([f"missing fragment: {path}"])
        data = load(path)
        found = data.get("directions") if isinstance(data, dict) else None
        if not isinstance(found, list):
            errors.append(f"{name}: missing directions array")
            continue
        directions.extend(found)

    meta_path = FRAGMENTS / META_FILE
    if not meta_path.is_file():
        fail([f"missing meta fragment: {meta_path}"])
    meta = load(meta_path)

    if len(directions) != 10:
        errors.append(f"expected 10 directions, found {len(directions)}")

    divisions: list[dict] = []
    groups: list[dict] = []
    tasks: list[dict] = []
    seen_ids: set[str] = set()
    seen_titles: Counter[str] = Counter()

    direction_by_slug = {item[0]: item for item in EXPECTED_DIRECTIONS}
    for direction in directions:
        slug = str(direction.get("slug", "")).strip()
        if slug not in direction_by_slug:
            errors.append(f"unknown direction slug: {slug!r}")
            continue
        expected_slug, expected_name, expected_en = direction_by_slug[slug]
        name = str(direction.get("name", "")).strip()
        name_en = str(direction.get("nameEn", "")).strip()
        mission = str(direction.get("mission", "")).strip()
        if name != expected_name:
            errors.append(f"{slug}: name is {name!r}, expected {expected_name!r}")
        if name_en != expected_en:
            errors.append(f"{slug}: nameEn is {name_en!r}, expected {expected_en!r}")
        if not has_cyrillic(mission):
            errors.append(f"{slug}: mission is not Russian")
        raw_groups = direction.get("groups")
        if not isinstance(raw_groups, list) or len(raw_groups) != 3:
            errors.append(f"{slug}: expected 3 groups, found {len(raw_groups) if isinstance(raw_groups, list) else 'not a list'}")
            raw_groups = []
        group_names: list[str] = []
        for group in raw_groups:
            group_name = str(group.get("name", "")).strip()
            group_en = str(group.get("nameEn", "")).strip()
            outcome = str(group.get("outcome", "")).strip()
            if not group_name or not has_cyrillic(group_name):
                errors.append(f"{slug}: empty or non-Russian group name")
            if group_name in group_names:
                errors.append(f"{slug}: duplicate group {group_name!r}")
            group_names.append(group_name)
            if not has_cyrillic(outcome):
                errors.append(f"{slug}/{group_name}: outcome is not Russian")
            groups.append({
                "name": group_name,
                "nameEn": group_en,
                "division": name,
                "outcome": outcome,
            })
            raw_tasks = group.get("tasks")
            if not isinstance(raw_tasks, list) or len(raw_tasks) != 2:
                errors.append(f"{slug}/{group_name}: expected 2 tasks, found {len(raw_tasks) if isinstance(raw_tasks, list) else 'not a list'}")
                raw_tasks = []
            for task in raw_tasks:
                task_id = str(task.get("id", "")).strip()
                prefix = EXPECTED_PREFIX[slug]
                if not re.fullmatch(rf"{prefix}-\d{{2}}", task_id):
                    errors.append(f"{slug}: bad task id {task_id!r}, expected {prefix}-NN")
                if task_id in seen_ids:
                    errors.append(f"duplicate task id: {task_id}")
                seen_ids.add(task_id)
                title = str(task.get("title", "")).strip()
                why = str(task.get("whyNow", "")).strip()
                acceptance = str(task.get("acceptance", "")).strip()
                roles = task.get("roles")
                checks = task.get("acceptanceChecks")
                depends = task.get("dependsOn")
                source = str(task.get("source", "")).strip()
                if not has_cyrillic(title):
                    errors.append(f"{task_id}: title is not Russian")
                if not has_cyrillic(why):
                    errors.append(f"{task_id}: whyNow is not Russian")
                if not has_cyrillic(acceptance):
                    errors.append(f"{task_id}: acceptance is not Russian")
                if not isinstance(roles, list) or not 2 <= len(roles) <= 3:
                    errors.append(f"{task_id}: expected 2-3 roles")
                if not isinstance(checks, list) or not 2 <= len(checks) <= 3:
                    errors.append(f"{task_id}: expected 2-3 acceptance checks")
                if not isinstance(depends, list):
                    errors.append(f"{task_id}: dependsOn is not a list")
                    depends = []
                if not source:
                    errors.append(f"{task_id}: source is empty")
                seen_titles[title] += 1
                tasks.append({
                    "id": task_id,
                    "title": title,
                    "division": name,
                    "group": group_name,
                    "whyNow": why,
                    "roles": roles if isinstance(roles, list) else [],
                    "acceptance": acceptance,
                    "acceptanceChecks": checks if isinstance(checks, list) else [],
                    "dependsOn": depends,
                    "status": "proposed",
                    "source": source,
                })
        divisions.append({
            "name": name,
            "nameEn": name_en,
            "slug": slug,
            "mission": mission,
            "groups": group_names,
        })

    for title, count in seen_titles.items():
        if count > 1:
            errors.append(f"duplicate task title: {title!r} x{count}")

    by_id = {task["id"]: task for task in tasks}
    for task in tasks:
        for dependency in task["dependsOn"]:
            if dependency not in by_id:
                errors.append(f"{task['id']}: unknown dependency {dependency}")
            if dependency == task["id"]:
                errors.append(f"{task['id']}: depends on itself")

    # Compute waves and cycles.
    state: dict[str, int] = {}
    wave: dict[str, int] = {}
    stack: list[str] = []

    def visit(task_id: str) -> int:
        if state.get(task_id) == 1:
            errors.append("dependency cycle: " + " -> ".join(stack + [task_id]))
            return 1
        if state.get(task_id) == 2:
            return wave[task_id]
        state[task_id] = 1
        stack.append(task_id)
        deps = [visit(dep) for dep in by_id[task_id]["dependsOn"] if dep in by_id]
        stack.pop()
        state[task_id] = 2
        wave[task_id] = 1 + max(deps, default=0)
        return wave[task_id]

    if not errors:
        for task_id in by_id:
            visit(task_id)
        for task in tasks:
            task["wave"] = wave[task["id"]]
            task["status"] = "ready" if task["wave"] == 1 else "proposed"

    parked = meta.get("parked")
    guilds = meta.get("guilds")
    interfaces = meta.get("interfaces")
    anchor_links = meta.get("anchorLinks")
    if not isinstance(parked, list) or len(parked) != 14:
        errors.append(f"expected 14 parked tasks, found {len(parked) if isinstance(parked, list) else 'not a list'}")
    if not isinstance(guilds, list) or len(guilds) != 7:
        errors.append(f"expected 7 guilds, found {len(guilds) if isinstance(guilds, list) else 'not a list'}")
    if not isinstance(interfaces, list) or len(interfaces) != 10:
        errors.append(f"expected 10 interfaces, found {len(interfaces) if isinstance(interfaces, list) else 'not a list'}")
    if not isinstance(anchor_links, list) or not 10 <= len(anchor_links) <= 12:
        errors.append(f"expected 10-12 anchor links, found {len(anchor_links) if isinstance(anchor_links, list) else 'not a list'}")

    if errors:
        fail(errors)

    by_division = defaultdict(list)
    for group in groups:
        by_division[group["division"]].append(group["name"])

    payload = {
        "version": 2,
        "generatedAt": "2026-11-22",
        "source": "docs/workstreams/build_v2.py",
        "divisions": divisions,
        "groups": groups,
        "tasks": tasks,
        "parked": parked,
        "guilds": guilds,
        "interfaces": interfaces,
        "anchorLinks": anchor_links,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    waves = Counter(task["wave"] for task in tasks)
    print("V2 VALID")
    print(f"directions={len(divisions)} groups={len(groups)} tasks={len(tasks)} parked={len(parked)} guilds={len(guilds)} interfaces={len(interfaces)} anchorLinks={len(anchor_links)}")
    print("waves=" + " ".join(f"w{wave}:{count}" for wave, count in sorted(waves.items())))
    print(f"wrote {OUT.relative_to(ROOT.parent.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
