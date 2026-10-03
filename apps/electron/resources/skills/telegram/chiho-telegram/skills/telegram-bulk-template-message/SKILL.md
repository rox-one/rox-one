---
name: telegram-bulk-template-message
description: Send an approved Telegram message template to selected chats through Chiho.ai or tgchats. Use when the user wants a batch announcement, follow-up, update, or outreach message sent to multiple Telegram chats.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with a connected Telegram session and message write tools.
metadata:
  chiho.category: telegram-automation
  chiho.risk: high
  chiho.requiresApproval: "true"
  chiho.cloudScopes: telegram.read, telegram.message.preview, telegram.message.send, telegram.batch.write
allowed-tools: mcp(dialogs_list) mcp(chat_read) mcp(outbox_preview) mcp(write_approve_preview) mcp(outbox_send_approved)
---

# telegram-bulk-template-message

Use this skill to send one approved template to multiple Telegram chats.

## Rules

- Read or resolve the target audience first.
- Use packaged templates from [templates](assets/templates.json).
- Never free-form bulk send when an approved template can satisfy the request.
- Always create a preview before execution.
- Respect recipient caps, skipped-recipient reasons, rate limits, and idempotency keys.
- If policy requires approval, stop after preview and ask the user to approve.

## Cloud Flow

1. Use `dialogs_list` and `chat_read` as needed to resolve recipients.
2. Call `outbox_preview` with recipients and template/message text.
3. Show the preview summary: recipients, skipped targets, scheduled time, and risk.
4. If approval is required, call `write_approve_preview` with the `previewId` after the user approves.
5. Call `outbox_send_approved` with the approved `previewId`.
6. Return the execution report and any failures.

## Local Flow

Use the same MCP tool names as Cloud: `outbox_preview` followed by `outbox_send_approved`.

## First-Time Setup

If Telegram is not connected yet, start with the root Chiho Telegram skill:

- https://raw.githubusercontent.com/chihoai/telegram-for-ai-agents/main/SKILL.md

Use that root skill to choose Chiho.ai Cloud or self-hosted tgchats, then return to this workflow skill.

## References

- [Flow](references/flow.md)
- [Safety](references/safety.md)
- [Cloud MCP](references/cloud-mcp.md)
- [Local tgchats](references/tgchats-local.md)
- [Examples](assets/examples.json)
