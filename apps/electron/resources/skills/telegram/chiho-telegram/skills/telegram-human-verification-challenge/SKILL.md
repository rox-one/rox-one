---
name: telegram-human-verification-challenge
description: Send a simple reasoning challenge to newly opened or suspicious Telegram chats and classify the reply as a weak human-verification signal. Use when the user wants a CAPTCHA-like check for possible bots in normal Telegram messages.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with Telegram read, CRM metadata, and preview-first messaging tools.
metadata:
  chiho.category: telegram-automation
  chiho.risk: high
  chiho.requiresApproval: "true"
  chiho.cloudScopes: telegram.read, crm.write, telegram.message.preview, telegram.message.send, telegram.batch.write
allowed-tools: mcp(dialogs_list) mcp(chat_read) mcp(tags_set) mcp(tasks_add) mcp(outbox_preview) mcp(write_approve_preview) mcp(outbox_send_approved) mcp(message_send_draft)
---

# telegram-human-verification-challenge

Use this skill to send a short reasoning challenge to a new, reopened, or suspicious Telegram chat when the user wants a CAPTCHA-like bot screen in a normal user-account conversation.

## Rules

- Treat the result as a weak automation signal, not proof that the contact is human, safe, or trustworthy.
- Use text-message challenges for one-to-one chats; do not rely on Telegram bot inline buttons or polls for normal user-account private messages.
- Keep challenges simple, deterministic, and answerable in one short reply.
- Do not ask for private information, account access, payment details, ID documents, or biometric proof.
- Prefer `outbox_preview` so the user can approve or edit the message before it is sent.
- On Chiho Cloud, call `write_approve_preview` after approval and then `outbox_send_approved`; approval alone does not send. On local tgchats, call `outbox_send_approved` after approval. Use `message_send_draft` only when the user explicitly requests immediate sending to one specific chat.
- If the contact fails, ignores, or evades the challenge, tag or task the chat for manual verification instead of accusing them of being a bot.
- Do not repeatedly challenge a contact who already passed unless the user asks or the risk context changed.

## Flow

1. Use `dialogs_list` to find candidate new chats, or `chat_read` for the user-specified chat.
2. Decide whether a challenge is appropriate from recent context and risk level.
3. Generate one short challenge from the templates or challenge design reference.
4. Keep the expected answer in the agent's working notes; do not include it in the outgoing message.
5. Preview the challenge with `outbox_preview`.
6. After approval, complete the runtime-specific approval step and send the preview with `outbox_send_approved`; use `message_send_draft` only for an explicit direct-send instruction.
7. Read the next reply with `chat_read` and compare it to the expected answer.
8. Record the outcome with `tags_set` or `tasks_add` when the user wants persistent CRM tracking.
9. Report the result as passed, failed, no reply, skipped, or needs manual review.

## Challenge Pattern

Use concise instruction-following prompts:

```text
Quick verification: please reply with only the number you get from 17 + 6, followed by the word check
```

For that example, the expected answer is `23 check`.

## First-Time Setup

If Telegram is not connected yet, start with the root Chiho Telegram skill:

- https://raw.githubusercontent.com/chihoai/telegram-for-ai-agents/main/SKILL.md

Use that root skill to choose Chiho.ai Cloud or self-hosted tgchats, then return to this workflow skill.

## References

- [Flow](references/flow.md)
- [Challenge Design](references/challenge-design.md)
- [Safety](references/safety.md)
- [Cloud MCP](references/cloud-mcp.md)
- [Local tgchats](references/tgchats-local.md)
- [Templates](assets/templates.json)
- [Examples](assets/examples.json)
