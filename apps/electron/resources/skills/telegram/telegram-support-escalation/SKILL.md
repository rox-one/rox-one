---
name: telegram-support-escalation
description: Detect urgent support or customer issues in Telegram and create escalation tasks. Use when the user wants to triage complaints, outages, bugs, or customer support risks from Telegram conversations.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with Telegram read and CRM task tools.
metadata:
  chiho.category: crm-automation
  chiho.risk: medium
  chiho.requiresApproval: "false"
  chiho.cloudScopes: telegram.read, crm.write, automation.rules.write
allowed-tools: mcp(dialogs_list) mcp(chat_read) mcp(search_messages) mcp(tags_set) mcp(company_get) mcp(tasks_add) mcp(tasks_suggest) mcp(summary_refresh) mcp(rules_add) mcp(rules_run) mcp(rules_log)
---

# telegram-support-escalation

Use this skill to identify customer support risks in Telegram and create clear escalation tasks.

## Rules

- Prioritize explicit urgency, broken production workflows, payment issues, and angry customer language.
- Create tasks with severity, impact, and next owner when known.
- Tag chats with `Support`, `Bug`, `Escalated`, or `Customer Risk` when requested.
- Do not promise fixes or send replies.

## Flow

1. Search for support and failure signals or inspect recent dialogs.
2. Read context for each candidate.
3. Classify severity and impact.
4. Create escalation tasks with concise reasons.
5. Optionally add a rule for future support escalation detection.

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
