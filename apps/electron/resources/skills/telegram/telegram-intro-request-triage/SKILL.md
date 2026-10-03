---
name: telegram-intro-request-triage
description: Detect and triage Telegram intro requests, then create follow-up tasks or response drafts. Use when the user wants to handle requests for introductions, referrals, investor intros, hiring intros, or partner handoffs.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with Telegram read and CRM task tools; message sending remains preview-first.
metadata:
  chiho.category: crm-automation
  chiho.risk: medium
  chiho.requiresApproval: "true"
  chiho.cloudScopes: telegram.read, crm.write, telegram.message.preview
allowed-tools: mcp(dialogs_list) mcp(chat_read) mcp(search_messages) mcp(tasks_suggest) mcp(tasks_add) mcp(tags_set) mcp(nudge_generate) mcp(outbox_preview)
---

# telegram-intro-request-triage

Use this skill to process Telegram intro requests without losing context or sending premature replies.

## Rules

- Identify requester, target, requested reason, urgency, and required consent.
- Create a task when an intro needs follow-up.
- Use `nudge_generate` or `outbox_preview` only for draft/preview behavior.
- Never send an intro or disclose contact details without explicit approval.
- Tag chats with `Intro Request` when persistence is requested.

## Flow

1. Use `dialogs_list` or `search_messages` to find intro requests.
2. Use `chat_read` for context around each request.
3. Extract requester, target, ask, urgency, and missing information.
4. Use `tasks_add` for the next step or `tasks_suggest` when uncertain.
5. Optionally create a response preview.
6. Return grouped requests: ready, needs clarification, blocked, and done.

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
