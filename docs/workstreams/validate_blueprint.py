#!/usr/bin/env python3
"""Validate the Rox workstream blueprint and emit its task board.

The blueprint is the human-readable source. This script is the structural
check: five divisions, fifteen groups, thirty frontier tasks, twelve parked
tasks, two tasks per group, every dependency present, no cycles, and a
computed wave for each task.

Usage:
    python3 docs/workstreams/validate_blueprint.py
    python3 docs/workstreams/validate_blueprint.py --write
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DOC = ROOT / "blueprint-20261122.md"
OUT = ROOT / "task-board.json"

DIVISIONS: dict[str, list[str]] = {
    "Intelligence": [
        "Runtime & Sessions",
        "Memory, Knowledge & Context",
        "Evals, Safety & Policy",
    ],
    "Workspace": [
        "Shell & Core UX",
        "Documents, Editor & Canvas",
        "Collaboration & Communications",
    ],
    "Cloud": [
        "Sandboxes & Providers",
        "Identity, Billing & Console",
        "Reliability, Release & Security",
    ],
    "Enterprise": [
        "Forward-Deployed Engineering",
        "Solutions, Compliance & Sovereignty",
        "Customer Success & Support Operations",
    ],
    "Ecosystem": [
        "Developer Relations & Documentation",
        "Skills Marketplace & Partners",
        "Content, Community & Education",
    ],
}

PREFIX_TO_DIVISION = {
    "INT": "Intelligence",
    "WRK": "Workspace",
    "CLD": "Cloud",
    "ENT": "Enterprise",
    "ECO": "Ecosystem",
}

TASK_ROW = re.compile(r"^\|\s*\*\*(?P<id>(?:INT|WRK|CLD|ENT|ECO)-\d{2})\*\*\s*\|(?P<rest>.*)$")
PARKED_ROW = re.compile(r"^\|\s*\*\*(?P<id>P-\d{2})\*\*\s*\|(?P<rest>.*)$")
HEADING = re.compile(r"^### 3\.(?P<section>\d) ")


def cells(rest: str) -> list[str]:
    """Split a markdown table row body into stripped cells."""
    parts = [part.strip() for part in rest.split("|")]
    if parts and parts[-1] == "":
        parts.pop()
    return parts


def split_list(value: str) -> list[str]:
    value = value.strip().strip("`")
    if value in {"", "—", "-", "none", "None"}:
        return []
    return [item.strip().strip("`") for item in value.split(",") if item.strip()]


def group_for(task_id: str) -> str:
    prefix, number = task_id.split("-")
    index = (int(number) - 1) // 2
    groups = DIVISIONS[PREFIX_TO_DIVISION[prefix]]
    if index < 0 or index >= len(groups):
        raise ValueError(f"task {task_id} does not map to a group")
    return groups[index]


def parse() -> tuple[list[dict], list[dict]]:
    if not DOC.exists():
        raise SystemExit(f"blueprint not found: {DOC}")

    lines = DOC.read_text(encoding="utf-8").splitlines()
    section = None
    tasks: list[dict] = []
    parked: list[dict] = []

    for line in lines:
        heading = HEADING.match(line)
        if heading:
            section = int(heading.group("section"))
            continue
        if section in {1, 2, 3, 4, 5}:
            match = TASK_ROW.match(line)
            if match:
                row = cells(match.group("rest"))
                if len(row) != 5:
                    raise ValueError(f"{match.group('id')}: expected 5 cells after id, got {len(row)}")
                title, why, roles, acceptance, depends = row
                task_id = match.group("id")
                tasks.append(
                    {
                        "id": task_id,
                        "title": title,
                        "division": PREFIX_TO_DIVISION[task_id.split("-")[0]],
                        "group": group_for(task_id),
                        "whyNow": why,
                        "roles": split_list(roles),
                        "acceptance": acceptance,
                        "acceptanceChecks": [x.strip() for x in re.split(r";\s*", acceptance) if x.strip()],
                        "dependsOn": split_list(depends),
                        "status": "proposed",
                    }
                )
        if section == 6:
            match = PARKED_ROW.match(line)
            if match:
                row = cells(match.group("rest"))
                if len(row) != 4:
                    raise ValueError(f"{match.group('id')}: expected 4 cells after id, got {len(row)}")
                title, why, roles, acceptance = row
                parked.append(
                    {
                        "id": match.group("id"),
                        "title": title,
                        "whyParked": why,
                        "roles": split_list(roles),
                        "acceptance": acceptance,
                        "status": "proposed",
                    }
                )

    return tasks, parked


def validate(tasks: list[dict], parked: list[dict]) -> list[str]:
    errors: list[str] = []

    if len(tasks) != 30:
        errors.append(f"expected 30 frontier tasks, found {len(tasks)}")
    if len(parked) != 14:
        errors.append(f"expected 14 parked tasks, found {len(parked)}")

    ids = [task["id"] for task in tasks]
    duplicate_ids = [task_id for task_id, count in Counter(ids).items() if count > 1]
    if duplicate_ids:
        errors.append(f"duplicate task ids: {duplicate_ids}")

    by_group: dict[tuple[str, str], list[str]] = defaultdict(list)
    for task in tasks:
        for field in ("title", "whyNow", "acceptance"):
            if not task[field].strip():
                errors.append(f"{task['id']}: empty {field}")
        if not task["roles"]:
            errors.append(f"{task['id']}: no role families")
        if task["id"] in task["dependsOn"]:
            errors.append(f"{task['id']}: depends on itself")
        by_group[(task["division"], task["group"])].append(task["id"])

    for division, groups in DIVISIONS.items():
        if len(groups) != 3:
            errors.append(f"{division}: expected 3 groups, found {len(groups)}")
        for group in groups:
            found = by_group.get((division, group), [])
            if len(found) != 2:
                errors.append(f"{division} / {group}: expected 2 tasks, found {len(found)} ({found})")

    known = set(ids)
    for task in tasks:
        for dependency in task["dependsOn"]:
            if dependency not in known:
                errors.append(f"{task['id']}: unknown dependency {dependency}")

    # Cycle detection and wave computation.
    state: dict[str, int] = {}
    wave: dict[str, int] = {}
    stack: list[str] = []

    def visit(task_id: str) -> int:
        if state.get(task_id) == 1:
            cycle = " -> ".join(stack + [task_id])
            errors.append(f"dependency cycle: {cycle}")
            return 1
        if state.get(task_id) == 2:
            return wave[task_id]
        state[task_id] = 1
        stack.append(task_id)
        dependency_waves = [visit(dep) for dep in by_id[task_id]["dependsOn"]]
        stack.pop()
        state[task_id] = 2
        wave[task_id] = 1 + max(dependency_waves, default=0)
        return wave[task_id]

    by_id = {task["id"]: task for task in tasks}
    if not errors:
        for task_id in ids:
            visit(task_id)

    if not errors:
        for task in tasks:
            task["wave"] = wave[task["id"]]
            task["status"] = "ready" if task["wave"] == 1 else "proposed"

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate the Rox workstream blueprint.")
    parser.add_argument("--write", action="store_true", help="write task-board.json")
    args = parser.parse_args()

    tasks, parked = parse()
    errors = validate(tasks, parked)

    if errors:
        print("BLUEPRINT INVALID", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    waves = Counter(task["wave"] for task in tasks)
    print("BLUEPRINT VALID")
    print(f"divisions={len(DIVISIONS)} groups={sum(len(g) for g in DIVISIONS.values())} tasks={len(tasks)} parked={len(parked)}")
    print("waves=" + " ".join(f"w{wave}:{count}" for wave, count in sorted(waves.items())))

    if args.write:
        payload = {
            "version": 1,
            "generatedAt": "2026-11-22",
            "source": DOC.name,
            "divisions": [
                {"name": division, "groups": groups}
                for division, groups in DIVISIONS.items()
            ],
            "tasks": tasks,
            "parked": parked,
        }
        OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT.parent.parent)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
