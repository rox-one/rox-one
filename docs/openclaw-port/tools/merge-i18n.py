#!/usr/bin/env python3
"""Merge staged i18n keys into all 12 ROX locale files.

Staging format (docs/openclaw-port/i18n/<slice>.json):
    { "<key>": { "en": "...", "ru": "...", "de": "...", ... } }

Rules enforced (mirrors scripts/sort-locales.ts + locale-parity.test.ts):
- every staged key MUST provide a value for every locale present in locales/
- existing keys are never overwritten unless --force
- output is 2-space indented JSON with ASCII-sorted keys and a trailing newline

Usage: merge-i18n.py [--force] [--check]
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
LOCALES = ROOT / "packages/shared/src/i18n/locales"
STAGING = ROOT / "docs/openclaw-port/i18n"

force = "--force" in sys.argv
check = "--check" in sys.argv

locale_files = sorted(LOCALES.glob("*.json"))
langs = [p.stem for p in locale_files]
data = {p.stem: json.loads(p.read_text()) for p in locale_files}

staged: dict[str, dict[str, str]] = {}
for sp in sorted(STAGING.glob("*.json")):
    chunk = json.loads(sp.read_text())
    for key, vals in chunk.items():
        if key in staged:
            raise SystemExit(f"duplicate staged key {key} in {sp.name} and earlier file")
        staged[key] = vals

problems: list[str] = []
added = 0
for key, vals in staged.items():
    missing = [l for l in langs if not vals.get(l)]
    if missing:
        problems.append(f"{key}: missing locales {missing}")
        continue
    for lang in langs:
        if key in data[lang]:
            if data[lang][key] != vals[lang]:
                if check:
                    problems.append(f"{key}[{lang}]: existing value differs")
                elif force:
                    data[lang][key] = vals[lang]
            # without --force: keep existing value
        else:
            if not check:
                data[lang][key] = vals[lang]
            added += 1

if problems:
    print("\n".join(problems))
    raise SystemExit(f"{len(problems)} problem(s); nothing written" if not check else "check failed")

if not check:
    for p in locale_files:
        lang = p.stem
        ordered = {k: data[lang][k] for k in sorted(data[lang])}
        p.write_text(json.dumps(ordered, ensure_ascii=False, indent=2) + "\n")

print(f"staged keys: {len(staged)}; new key entries: {added}; locales: {len(langs)}; mode={'check' if check else 'write'}")