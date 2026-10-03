---
name: telegram-meeting-recap
description: Summarize Telegram conversations into meeting recaps, decisions, and action items. Use when the user wants a concise recap after a call, meeting, or long planning thread.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with Telegram read, summary, and task tools.
metadata:
  chiho.category: crm-automation
  chiho.risk: low
  chiho.requiresApproval: "false"
  chiho.cloudScopes: telegram.read, crm.write
allowed-tools: mcp(chat_read) mcp(summary_refresh) mcp(summary_show) mcp(tasks_suggest) mcp(tasks_add) mcp(nudge_generate)
---

# telegram-meeting-recap

Use this skill to turn a long Telegram thread into a recap with decisions and action items.

## Rules

- Read the relevant date range or recent message window.
- Separate facts, decisions, open questions, and action items.
- Create tasks only when the user asks to persist them.
- Do not send the recap unless routed through a preview/send workflow.

## Flow

1. Use `chat_read` for the target conversation.
2. Use `summary_refresh` to update the rolling summary when needed.
3. Extract decisions, open questions, owners, and deadlines.
4. Use `tasks_suggest` and `tasks_add` for action items when requested.
5. Optionally generate a concise follow-up nudge draft.

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
