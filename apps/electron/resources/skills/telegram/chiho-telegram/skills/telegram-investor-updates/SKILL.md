---
name: telegram-investor-updates
description: Manage investor conversations and update follow-ups from Telegram. Use when the user wants to find investor chats, summarize context, or prepare investor update tasks and drafts.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with Telegram read and CRM tools; message sending is preview-first.
metadata:
  chiho.category: crm-automation
  chiho.risk: medium
  chiho.requiresApproval: "true"
  chiho.cloudScopes: telegram.read, crm.write, telegram.message.preview
allowed-tools: mcp(dialogs_list) mcp(chat_read) mcp(search_messages) mcp(tags_set) mcp(company_link) mcp(tasks_add) mcp(summary_refresh) mcp(summary_show) mcp(nudge_generate) mcp(outbox_preview)
---

# telegram-investor-updates

Use this skill to keep investor Telegram relationships organized and ready for updates.

## Rules

- Treat investor communications as sensitive.
- Use previews for any update draft.
- Prefer summaries and tasks over automatic messages.
- Tag investors only when requested or when existing evidence is strong.

## Flow

1. Find investor chats by tags, search, or recent dialogs.
2. Read context and refresh summaries.
3. Identify last touch, promised follow-ups, and next update timing.
4. Create tasks for missing updates or next steps.
5. Preview update language only when requested.

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
