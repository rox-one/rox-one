---
name: telegram-add-colleagues-to-group
description: Add or invite one Telegram user to selected group chats. Use when the user wants to add a colleague, teammate, contractor, or partner to Telegram groups.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with member invite write tools.
metadata:
  chiho.category: telegram-automation
  chiho.risk: high
  chiho.requiresApproval: "true"
  chiho.cloudScopes: telegram.read, telegram.members.invite
allowed-tools: mcp(dialogs_list) mcp(chat_read) mcp(members_invite_preview) mcp(write_approve_preview) mcp(members_invite_approved)
---

# telegram-add-colleagues-to-group

Use this skill to add or invite one Telegram user to one or more group chats.

## Rules

- Resolve the target user and target groups before preview.
- Do not invite users to unrelated groups based on name similarity alone.
- Always create an invite preview before execution.
- Explain whether execution may directly add the user or fall back to an invite link.
- Respect group limits, permission failures, and privacy failures.

## Flow

1. Use `dialogs_list` to resolve candidate groups.
2. Use `chat_read` only when group context is needed for disambiguation.
3. Call `members_invite_preview` with the target user and groups.
4. Show the preview summary and ask for approval when policy requires it.
5. On Chiho Cloud, call `write_approve_preview` after approval; local tgchats does not use that Cloud-only step.
6. Call `members_invite_approved` with the approved `previewId`.
7. Report added groups, invite-link fallbacks, skipped groups, and failures.

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
