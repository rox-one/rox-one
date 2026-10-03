---
name: telegram-lead-qualification
description: Qualify Telegram conversations as sales or partnership leads and create CRM tags, company links, tasks, and summaries. Use when the user wants to score inbound chats, identify promising leads, or triage Marketing and BD opportunities.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with Telegram read, CRM write, and AI suggestion tools.
metadata:
  chiho.category: crm-automation
  chiho.risk: low
  chiho.requiresApproval: "false"
  chiho.cloudScopes: telegram.read, crm.write
allowed-tools: mcp(dialogs_list) mcp(chat_read) mcp(tags_suggest) mcp(tags_set) mcp(company_suggest) mcp(company_link) mcp(tasks_suggest) mcp(tasks_add) mcp(summary_refresh) mcp(summary_show)
---

# telegram-lead-qualification

Use this skill to turn Telegram conversation context into a qualified CRM lead record.

## Rules

- Read enough recent context before making a qualification.
- Prefer AI suggestions for tags, company, and tasks before persisting.
- Use explicit lead-stage tags such as `Lead`, `Qualified`, `Partner`, `Customer`, or `Investor`.
- Keep the qualification reason concise and tied to conversation evidence.
- Do not send Telegram messages.

## Flow

1. Use `dialogs_list` to find candidate chats when no peer is specified.
2. Use `chat_read` to inspect recent context.
3. Use `tags_suggest`, `company_suggest`, and `tasks_suggest`.
4. Use `summary_refresh` when the chat lacks current context.
5. Apply tags, company links, and tasks only when requested or when policy allows automatic CRM writes.
6. Return the qualification, evidence, next action, and any persisted changes.

## First-Time Setup

If Telegram is not connected yet, start with the root Chiho Telegram skill:

- https://raw.githubusercontent.com/chihoai/telegram-for-ai-agents/main/SKILL.md

Use that root skill to choose Chiho.ai Cloud or self-hosted tgchats, then return to this workflow skill.

## References

- [Flow](references/flow.md)
- [Safety](references/safety.md)
- [Cloud MCP](references/cloud-mcp.md)
- [Local tgchats](references/tgchats-local.md)
- [Templates](assets/templates.json)
- [Examples](assets/examples.json)
