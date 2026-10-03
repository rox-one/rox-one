# Skill Productization

Use `skills/catalog.json` as the machine-readable source for catalog discovery.

## Plugin packages

The repository is a marketplace containing two separate plugin roots:

| Package | Path | MCP server | Authentication |
| --- | --- | --- | --- |
| `chiho-telegram` | `plugins/chiho-telegram` | `https://api.chiho.ai/mcp/v8` | Browser OAuth |
| `tgchats-local` | `plugins/tgchats-local` | Local stdio `tgchats-mcp` | Local Telegram session |

Both packages have independent Codex and Claude manifests, MCP configuration, and one focused entry skill. Neither package references the other package's server.

- Codex marketplace: `.agents/plugins/marketplace.json`
- Claude marketplace: `.claude-plugin/marketplace.json`
- Hosted Codex configuration uses the `mcpServers` wrapper validated by the shipping Codex plugin tooling and defaults non-read-only tools to client approval.
- Hosted Claude configuration uses remote HTTP without a bearer header, client secret, or token placeholder; OAuth is discovered from the server.
- Local Claude configuration launches through `${CLAUDE_PLUGIN_ROOT}` because installed plugins run from Claude's cache.
- Local launchers prefer this repository's built server during development and otherwise require `tgchats-mcp` in `PATH`.

Workflow skills remain in `skills/<skill-name>/` and can be published individually. Do not rebuild a combined hosted-and-local plugin: duplicate tool names make runtime selection and approvals ambiguous.

## Cloud Install Model

1. Read `skills/catalog.json`.
2. Show available skills with risk, required scopes, supported runtimes, and template count.
3. Let the user or team admin enable a skill for specific Telegram accounts.
4. Require token scopes to cover the selected skill.
5. Import packaged templates from `assets/templates.json` into editable user/team records.
6. Record every run with skill name, runtime, account, tool calls, preview id, approval mode, result, and failures.

## Team Policy

Team policy should sit above token scopes:

- token scopes decide what is technically possible
- team policy decides which skills and accounts can use those scopes
- approval policy decides whether a human must confirm previews

Recommended policy controls:

- enable or disable each skill per team
- allow write scopes per Telegram account
- force `ask_always` for high-risk skills
- restrict message skills to imported templates
- expose audit logs to team admins

## Template Handling

The versioned source for packaged templates is the skill asset file:

```text
skills/<skill-name>/assets/templates.json
```

Cloud should import copies into database records when a user installs or enables a skill. User/team edits should modify the database copy, not the packaged asset.

## Runtime Status

- Chiho.ai Cloud MCP: hosted OAuth-protected read/write tools with previews, approvals, and audit logs.
- Local `tgchats-mcp`: exposes matching write tool names for local parity.
- CLI: remains available for local workflows, but skills should prefer MCP when possible.

## Public Catalog And Requests

The public `chiho.ai/telegram-skills` page should use this repository as the packaged skill source of truth:

- catalog: `skills/catalog.json`
- skill package: `skills/<skill-name>/`
- local repo path during development: configure `TELEGRAM_SKILLS_REPO_PATH` to point at a checkout of `chihoai/telegram-for-ai-agents`

Wanted skills should be represented by GitHub issues with the `telegram-skill` label. Other issues can stay in the same repository; the public wanted-skills list should filter specifically on `label:telegram-skill`.
