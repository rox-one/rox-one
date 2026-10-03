---
name: telegram-partner-pipeline
description: Manage partnership pipeline conversations in Telegram with stages, summaries, and follow-up tasks. Use when the user wants to track BD or partner relationships from Telegram chats.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with Telegram read and CRM write tools.
metadata:
  chiho.category: crm-automation
  chiho.risk: low
  chiho.requiresApproval: "false"
  chiho.cloudScopes: telegram.read, crm.write
allowed-tools: mcp(dialogs_list) mcp(chat_read) mcp(search_messages) mcp(tags_suggest) mcp(tags_set) mcp(company_suggest) mcp(company_link) mcp(tasks_suggest) mcp(tasks_add) mcp(summary_refresh)
---

# telegram-partner-pipeline

Use this skill to organize Telegram-based partner conversations into a pipeline.

## Rules

- Use explicit stage tags such as `Partner Prospect`, `Partner Active`, `Integration`, `Co-marketing`, or `Blocked`.
- Keep company links current.
- Create tasks for next steps, not vague reminders.
- Do not send partnership messages directly.

## Flow

1. Find partner-like conversations by tags, search, or recent dialogs.
2. Read recent context.
3. Suggest company link, stage tag, summary, and next task.
4. Persist updates only when requested or policy allows.
5. Return a pipeline grouped by stage.

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
