---
name: understand-figma
description: Analyze a Figma file via the Figma REST API and generate an interactive design knowledge graph (pages, screens, components, component sets, instances, design tokens) with a kind:"design" dashboard.
argument-hint: "<figma-file-url-or-key> [--language <lang>]"
---

# Understand Anything in Rox

This skill is installed with Rox from the MIT-licensed Understand Anything snapshot `1d7418b8abfa543744ae029e63a482aee03f9022`. Its complete upstream instructions, helper scripts, language references, agent prompts and plugin sources are bundled locally.

1. Resolve the global skills directory from this entry's installed path. The `understand` skill in the same directory owns the runtime at `understand/plugin/`. Use its absolute path as `PLUGIN_ROOT` (and `CLAUDE_PLUGIN_ROOT` when upstream commands expect it). Do not assume an unrelated Claude plugin root points here.
2. Set `SKILL_DIR` to `PLUGIN_ROOT/skills/understand-figma`. Read `SKILL_DIR/SKILL.md` and follow it, using that directory for helper scripts and `PLUGIN_ROOT/agents/` for agent prompts. Substitute the resolved absolute paths into each command; shell variables from earlier calls may not persist. All original helper-relative paths are preserved in this runtime.
3. Use the user's requested project as `PROJECT_ROOT`. Existing graphs live in `.ua/` or the legacy `.understand-anything/`. Never claim a project is indexed until its graph has been created and checked.

Reading existing graphs and Python helpers needs no plugin dependency installation. Full static analysis and the dashboard require Node.js ≥ 22 and pnpm ≥ 10; the upstream preflight installs the pinned dependencies and builds the core on first use. If those runtimes are missing, explain the requirement and continue applicable code exploration with available tools. No MCP server is provided by this skill.

Use the tools actually exposed by the current backend: use file/shell search when an upstream instruction names an unavailable tool; dispatch an available subagent with the relevant bundled agent prompt instead of inventing plugin tool names. User instructions and existing authorization take precedence over upstream workflow defaults.
