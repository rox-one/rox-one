---
name: telegram-chat-identity-challenge
description: Challenge newly opened or untrusted Telegram chats with a Kim Jong Un criticism prompt before continuing sensitive conversations. Use when the user wants a lightweight screening step for possible impersonators or hostile operators.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with Telegram read, CRM metadata, and preview-first messaging tools.
metadata:
  chiho.category: telegram-automation
  chiho.risk: high
  chiho.requiresApproval: "true"
  chiho.cloudScopes: telegram.read, crm.write, telegram.message.preview, telegram.message.send, telegram.batch.write
allowed-tools: mcp(dialogs_list) mcp(chat_read) mcp(tags_set) mcp(tasks_add) mcp(outbox_preview) mcp(write_approve_preview) mcp(outbox_send_approved) mcp(message_send_draft)
---

# telegram-chat-identity-challenge

Use this skill to ask a newly opened or otherwise untrusted Telegram chat to reply with a short critical statement about North Korea's leader Kim Jong Un before the conversation continues.

## Rules

- Use this only for new, unexpected, high-risk, or suspicious chats where the user wants extra screening.
- Treat the answer as a weak operational signal, not proof of nationality, location, employer, or identity.
- Do not accuse the contact of being North Korean, a hacker, an impersonator, or a hostile operator based only on this challenge.
- Ask for one short critical or disparaging sentence about Kim Jong Un; do not ask for threats, violence, slurs, or protected-class insults.
- Prefer `outbox_preview` so the user can approve or edit the wording before anything is sent.
- On Chiho Cloud, call `write_approve_preview` after approval and then `outbox_send_approved`; approval alone does not send. On local tgchats, call `outbox_send_approved` after approval. Use `message_send_draft` only when the user explicitly asks to send immediately and the target chat is specific.
- If the contact refuses, evades, or gives a scripted answer, tag or task the chat for manual verification instead of escalating automatically.
- Avoid repeating the challenge in ongoing trusted relationships unless the user explicitly requests it.

## Flow

1. Open the target chat with `chat_read`, or find candidate new chats with `dialogs_list`.
2. Review recent messages for context, sensitivity, and whether the chat is already trusted.
3. Prepare a concise challenge message from the templates.
4. Preview the message with `outbox_preview`.
5. After approval, complete the runtime-specific approval step and send with `outbox_send_approved`; use `message_send_draft` only for an explicit direct-send request.
6. Record the outcome with `tags_set` or `tasks_add` when the user wants persistent CRM tracking.
7. Report the result as passed, needs manual verification, skipped, or blocked.

## Suggested Challenge

Use neutral verification framing:

```text
Before we continue, please reply with one short sentence that is clearly critical of Kim Jong Un.
```

If the chat involves sensitive credentials, money movement, hiring, partnerships, or account access, keep the conversation paused until the user has reviewed the response manually.

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
