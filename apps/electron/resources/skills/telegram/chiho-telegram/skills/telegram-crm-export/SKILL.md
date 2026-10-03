---
name: telegram-crm-export
description: Prepare Telegram CRM exports for audits, follow-up reports, or handoffs. Use when the user wants filtered chats, tags, companies, tasks, or summaries exported from Chiho.ai or tgchats.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with read access; local full export uses the tgchats CLI.
metadata:
  chiho.category: crm-automation
  chiho.risk: medium
  chiho.requiresApproval: "true"
  chiho.cloudScopes: telegram.read
allowed-tools: mcp(search_messages) mcp(dialogs_list) mcp(chat_read) mcp(tags_get) mcp(company_get) mcp(tasks_today) mcp(summary_show)
---

# telegram-crm-export

Use this skill to gather CRM slices for export, audit, reporting, or team handoff.

## Rules

- Clarify export scope before collecting data.
- Prefer filtered exports over full account exports.
- Do not include session files, API hashes, or private auth material.
- Treat exported chat content as sensitive.
- Local full backup uses `tgchats export` outside MCP.

## Flow

1. Determine filters: tag, company, query, peer, date range, task status, or summary kind.
2. Use read tools to preview the export scope.
3. For local full exports, call the documented CLI export command outside MCP.
4. Return file location, record counts, included fields, and privacy notes.

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
