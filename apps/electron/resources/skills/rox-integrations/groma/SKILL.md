---
name: groma
description: Inspect and maintain a repository architecture map using the Groma.md CLI and its version-matched agent instructions.
license: MIT
---

# Groma integration for ROX

ROX-authored adapter to the real Groma.md CLI. The upstream project's MIT-licensed agent guides are bundled under references/.

1. Check command availability using `groma --version`. If absent, identify that missing prerequisite; the skill itself does not install the CLI or imply a populated architecture map.
2. Read [the agent guide index](references/index.md) and the guide corresponding to the user's task. Prefer the installed version's `groma agent-instructions` and command `--help` when its interface differs.
3. Inspect existing project architecture data before changing it. Follow the source-backed scanning and curation procedure in those guides; an empty map is not evidence of scanned architecture.
4. Use the CLI to perform the authorized work, then read back the map or changed records and report actual coverage.

Upstream: https://github.com/MrLesk/Groma.md.
