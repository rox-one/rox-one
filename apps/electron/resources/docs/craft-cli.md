# ROX Configuration Interfaces

The desktop app does not ship a configuration management CLI. Its legacy `craft-agent` wrapper name is retained only for compatibility with an explicitly supplied executable entry. It is not an installed command route for configuring ROX.

Use the application interfaces and the actual tools advertised by the current agent session:

| Domain | Application interface | Agent workflow |
| --- | --- | --- |
| Labels | Labels interface | Read [labels.md](./labels.md), preserve existing entries in the workspace `labels/config.json`, then use `config_validate` with target `labels`. |
| Sources | Sources interface | Read [sources.md](./sources.md), configure workspace source files, then use `source_test` and the relevant source authentication tool when advertised. |
| Skills | Skills interface | Read [skills.md](./skills.md), author workspace `skills/{slug}/SKILL.md`, then use `skill_validate` when advertised. |
| Automations | Automations interface | Read [automations.md](./automations.md), preserve existing workspace `automations.json` entries and validate with `config_validate` when advertised. |
| Permissions | Session permission badge; workspace permission files | Read [permissions.md](./permissions.md), use its JSON schema for custom rules and validate with `config_validate` when advertised. |
| Themes | Appearance settings | Read [themes.md](./themes.md) before modifying a workspace theme file. |

## Agent instructions

1. Resolve the selected workspace's actual root; do not assume that it is inside the default `~/rox/workspaces` directory.
2. Read the relevant guide before changing configuration. Preserve user data and unrelated fields.
3. Use the exact tool names present in the current session. OMP exposes session tools through names such as `mcp__session__config_validate`; other transports may present a different prefix.
4. If a needed tool is unavailable, report that limitation and use the application interface. Do not invent a CLI executable or unavailable tool.
5. A successful validation checks configuration structure. Source connectivity, authentication and automation execution require their own checks.

## Runtime and history verification

A completed request in the installed application proves model execution. A saved default connection or skill catalog alone does not prove runtime readiness or native OMP command discovery.

The application persists ROX history at `<workspaceRoot>/sessions/<sessionId>/session.jsonl` and native OMP history beneath that session's `omp/` directory. Use normal session navigation and branching controls to inspect and resume sessions. Avoid printing credentials or complete private transcripts when collecting evidence.
