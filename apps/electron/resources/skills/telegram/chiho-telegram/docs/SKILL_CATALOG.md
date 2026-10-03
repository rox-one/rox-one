# Telegram Skill Catalog

This catalog defines the first installable Telegram workflow skills for Chiho.ai Cloud and the self-hosted `tgchats` runtime.

## Repository Split

- `telegram-for-agents` owns public Skill directories, examples, local MCP/CLI contracts, and install guidance.
- `chiho/monorepo` owns Chiho.ai Cloud execution: the hosted CRM table UI, MCP tools, token scopes, approval policies, audit logs, and durable jobs.

## Initial Skills

The public `telegram-for-agents` skill selects Chiho.ai Cloud or self-hosted `tgchats` and then routes to the workflow skills below. Installable plugin entry points are separate: `chiho-telegram` for hosted OAuth and `tgchats-local` for the local stdio runtime.

| Skill | Purpose | Risk | Cloud requirements | Local requirements |
| --- | --- | --- | --- | --- |
| `telegram-chat-identity-challenge` | Ask untrusted new chats for a Kim Jong Un criticism challenge before sensitive conversation continues | High | `telegram.read`, `crm.write`, `telegram.message.preview`, `telegram.message.send`, `telegram.batch.write` | Dialog, preview/draft, tag, and task tools |
| `telegram-human-verification-challenge` | Send CAPTCHA-like reasoning challenges to new or suspicious chats and classify the reply | High | `telegram.read`, `telegram.message.preview`, `telegram.message.send`, `telegram.batch.write`, `crm.write` | Dialog, preview/draft, tag, and task tools |
| `telegram-bulk-template-message` | Send approved templates to selected chats | High | `telegram.read`, `telegram.message.preview`, `telegram.message.send`, `telegram.batch.write` | Preview and approved-send outbox tools |
| `telegram-conditional-replies` | Draft or run conditional reply rules | High | `telegram.read`, `crm.write`, `telegram.message.preview`, `telegram.message.send`, `telegram.batch.write`, `automation.rules.write` | Rule list/add/run/log tools plus preview and approved-send tools |
| `telegram-add-colleagues-to-group` | Add or invite colleagues to groups | High | `telegram.read`, `telegram.members.invite` | Matching `members.*` tools |
| `telegram-followup-tasks` | Find follow-ups and create CRM tasks | Low | `telegram.read`, `crm.write`, `automation.rules.write` | Existing task and rule tools |
| `telegram-group-cleanup` | Review stale groups and clean up safely | High | `telegram.read`, `crm.write`, `telegram.folders.write`, `telegram.groups.leave` | Folder and group-leave tools |
| `telegram-lead-qualification` | Qualify inbound Marketing and BD leads | Low | `telegram.read`, `crm.write` | Existing tag/company/task tools |
| `telegram-intro-request-triage` | Detect intro asks and create follow-up tasks or previews | Medium | `telegram.read`, `crm.write`, `telegram.message.preview` | Search, task, and preview tools |
| `telegram-deck-followup` | Follow up after decks, proposals, or docs were sent | Low | `telegram.read`, `crm.write`, `automation.rules.write` | Search, task, and rule tools |
| `telegram-vip-inbox` | Surface important contacts before general inbox triage | Low | `telegram.read`, `crm.write` | Dialog, metadata, and task tools |
| `telegram-meeting-recap` | Summarize long threads into recaps and action items | Low | `telegram.read`, `crm.write` | Summary and task tools |
| `telegram-crm-export` | Prepare filtered CRM exports and local backups | Medium | `telegram.read` | Read tools plus local export CLI |
| `telegram-partner-pipeline` | Track partner conversations by stage and next step | Low | `telegram.read`, `crm.write` | Tag/company/task tools |
| `telegram-investor-updates` | Track investor update follow-ups and drafts | Medium | `telegram.read`, `crm.write`, `telegram.message.preview` | Summary, task, and preview tools |
| `telegram-hiring-pipeline` | Track candidates and hiring follow-ups | Medium | `telegram.read`, `crm.write` | Search, tag, and task tools |
| `telegram-support-escalation` | Detect urgent support issues and create escalation tasks | Medium | `telegram.read`, `crm.write`, `automation.rules.write` | Search, rules, tags, and task tools |

## Installing Skills

These skills are shipped as directories so they can be installed by clients that support skill/plugin folders, while still working as normal documentation for clients that do not.

Install options:

- Published workflow: install a single skill with the `skills` CLI:

```bash
npx skills add https://chiho.ai/telegram-skills/telegram-add-colleagues-to-group
```

- Docs-only/manual inspection: fetch the skill instructions directly:

```bash
curl -fsSL https://chiho.ai/telegram-skills/telegram-add-colleagues-to-group/SKILL.md
```

- Whole catalog: install or copy `skills/` into the client skill workspace.
- One workflow: install or copy a single `skills/<skill-name>/` directory.
- Docs-only client: point the agent at the relevant `SKILL.md` and let it follow the referenced MCP/CLI flows.

Use `npx skills add` when you want the skill installed into a supported agent workspace. Use `curl` when you only want to inspect or pipe the `SKILL.md` instructions. Replace `telegram-add-colleagues-to-group` with any skill name from the catalog.

Client notes:

- OpenClaw: install the skill directory and configure the Chiho.ai Cloud MCP server or local `tgchats-mcp`.
- Codex: add the repository marketplace and install either `chiho-telegram@chiho` or `tgchats-local@chiho`.
- Claude Code: add the same repository marketplace and install the matching hosted or local package.
- Claude.ai / Desktop / Cowork: add `https://api.chiho.ai/mcp/v8` as a custom connector and complete browser OAuth.
- Interactive hosted setup never requires an Agent Access token, bearer header, client secret, or token in the URL.
- Local execution requires the separately installed `tgchats-local` package and a built or installed `tgchats-mcp` binary.

Every skill should remain portable: `SKILL.md` contains the routing rules, `references/` contains details, and `assets/` contains templates/examples.

## Contract Reference

Cloud write tools are the hosted MCP baseline for skills that preview, send, invite, or organize Telegram state.

Cloud Telegram reads and cloud CRM metadata are separate surfaces. A dialog can be visible to `dialogs_list` or `chat_read` before it has been synced into CRM metadata. Use `inventory_summary` for live and persisted totals, `crm_dialogs_list` to verify durable coverage, and `sync_once` plus `sync_status` when CRM metadata needs to be populated. When CRM tools such as `tags_get`, `company_get`, `summary_show`, or suggestion tools report that chat metadata is unavailable, keep using Telegram read tools for context until the durable sync has committed that peer. Cloud `chat_read` may also return a minimum page size even when a smaller `limit` is requested.

| Tool | Status | Required scopes | Notes |
| --- | --- | --- | --- |
| `outbox_preview` | Cloud baseline | `telegram.message.preview` | Creates a preview record without sending. |
| `outbox_send_approved` | Cloud baseline | `telegram.message.send`, `telegram.batch.write` | Executes an approved preview. |
| `message_send_draft` | Cloud baseline | `telegram.message.send` | Sends one message to one resolved peer. |
| `members_invite_preview` | Cloud baseline | `telegram.members.invite` | Previews adding/inviting a user to groups. |
| `members_invite_approved` | Cloud baseline | `telegram.members.invite` | Executes an approved member invite preview. |
| `folders_create` | Cloud baseline | `telegram.folders.write` | Personal-scope tokens only. |
| `folders_add_dialog` | Cloud baseline | `telegram.folders.write` | Personal-scope tokens only. |
| `folders_remove_dialog` | Cloud baseline | `telegram.folders.write` | Personal-scope tokens only. |
| `groups_leave_preview` | Planned | `telegram.groups.leave` | Needed for `telegram-group-cleanup`. |
| `groups_leave_approved` | Planned | `telegram.groups.leave` | Needed for `telegram-group-cleanup`. |

## Validation

Run:

```bash
npm run validate:skills
```

The validator checks:

- every `skills/*/SKILL.md` has frontmatter with `name` and `description`
- skill directory names match frontmatter names
- local Markdown links point to existing files
- `allowed-tools` entries reference known local, Cloud baseline, or planned Skill tools
- JSON files in skill `assets/` parse successfully
- `skills/catalog.json` points to existing skill directories and assets

## Productization

For Cloud/UI rollout guidance, see [Skill Productization](./SKILL_PRODUCTIZATION.md).
