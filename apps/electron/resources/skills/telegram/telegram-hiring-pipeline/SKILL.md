---
name: telegram-hiring-pipeline
description: Track candidates and hiring conversations in Telegram with stage tags, summaries, and follow-up tasks. Use when the user wants to manage recruiting or candidate follow-ups from Telegram.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with Telegram read and CRM task tools.
metadata:
  chiho.category: crm-automation
  chiho.risk: medium
  chiho.requiresApproval: "false"
  chiho.cloudScopes: telegram.read, crm.write
allowed-tools: mcp(dialogs_list) mcp(chat_read) mcp(search_messages) mcp(tags_suggest) mcp(tags_set) mcp(tasks_suggest) mcp(tasks_add) mcp(summary_refresh) mcp(nudge_generate)
---

# telegram-hiring-pipeline

Use this skill to organize Telegram recruiting conversations into a hiring pipeline.

## Rules

- Use candidate-stage tags only from conversation evidence.
- Avoid sensitive or protected-class inferences.
- Create tasks for interview scheduling, feedback, or next steps.
- Do not send candidate messages directly.

## Flow

1. Find candidate chats by search, tags, or recent dialogs.
2. Read recent context.
3. Suggest stage tags and follow-up tasks.
4. Refresh summaries for active candidates.
5. Return pipeline status and overdue next steps.

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
