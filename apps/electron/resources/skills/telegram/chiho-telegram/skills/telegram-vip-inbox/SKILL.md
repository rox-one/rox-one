---
name: telegram-vip-inbox
description: Build and maintain a VIP Telegram inbox queue using tags, summaries, and follow-up tasks. Use when the user wants important contacts surfaced before general inbox triage.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with Telegram read and CRM tools.
metadata:
  chiho.category: crm-automation
  chiho.risk: low
  chiho.requiresApproval: "false"
  chiho.cloudScopes: telegram.read, crm.write
allowed-tools: mcp(dialogs_list) mcp(chat_read) mcp(search_messages) mcp(tags_get) mcp(tags_set) mcp(company_get) mcp(tasks_today) mcp(tasks_add) mcp(summary_show) mcp(summary_refresh)
---

# telegram-vip-inbox

Use this skill to surface high-priority Telegram conversations as a VIP queue.

## Rules

- Prefer existing tags and company links before inferring importance.
- Read recent context for chats that may need action.
- Use `VIP`, `Needs Follow-up`, or domain-specific tags only when requested.
- Do not archive, move, or message chats from this skill.

## Flow

1. Use `dialogs_list` and CRM metadata to identify VIP candidates.
2. Read recent context for each candidate.
3. Show due tasks and stale conversations first.
4. Refresh summaries for important chats with missing context.
5. Add follow-up tasks or VIP tags when requested.

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
