---
name: telegram-deck-followup
description: Track Telegram conversations where a deck, proposal, or document was sent and create follow-up tasks if there is no reply. Use when the user wants BD, sales, investor, or partnership follow-ups after sending materials.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with Telegram read, search, and CRM task tools.
metadata:
  chiho.category: crm-automation
  chiho.risk: low
  chiho.requiresApproval: "false"
  chiho.cloudScopes: telegram.read, crm.write, automation.rules.write
allowed-tools: mcp(search_messages) mcp(chat_read) mcp(tasks_add) mcp(tasks_suggest) mcp(tags_set) mcp(nudge_generate) mcp(rules_add) mcp(rules_list)
---

# telegram-deck-followup

Use this skill to make sure deck, proposal, and document sends get followed up.

## Rules

- Search for sent-material signals before creating tasks.
- Check whether the recipient already replied after the send.
- Use due dates based on user instruction or a default 3 business day follow-up.
- Tag the chat with `Deck Sent` or `Proposal Sent` only when persistence is requested.
- Do not send follow-up messages directly.

## Flow

1. Search for terms such as "deck", "proposal", "sent over", "attached", or "doc".
2. Read each matching chat.
3. Determine whether the latest relevant reply came after the send.
4. Create follow-up tasks for silent threads.
5. Optionally add a recurring rule for future deck follow-ups.

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
