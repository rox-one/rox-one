---
name: telegram-followup-tasks
description: Find Telegram chats that need follow-up and create CRM tasks. Use when the user wants a follow-up queue, task suggestions, or reminders based on Telegram conversations.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with read and CRM task tools.
metadata:
  chiho.category: crm-automation
  chiho.risk: low
  chiho.requiresApproval: "false"
  chiho.cloudScopes: telegram.read, crm.write, automation.rules.write
allowed-tools: mcp(dialogs_list) mcp(chat_read) mcp(tasks_today) mcp(tasks_suggest) mcp(tasks_add) mcp(tasks_done) mcp(rules_list) mcp(rules_add) mcp(rules_run) mcp(rules_log)
---

# telegram-followup-tasks

Use this skill to turn Telegram conversation context into follow-up tasks.

## Rules

- Prefer task suggestions before creating tasks unless the user already gave exact task details.
- Keep task `why` text concise and tied to the conversation.
- Use due dates that are explicit or easily inferred from the user request.
- This skill mutates CRM state, not Telegram messages.

## Flow

1. Use `tasks_today` when the user asks for the current follow-up queue.
2. Use `dialogs_list` to find candidate chats.
3. Use `chat_read` for chats that need context.
4. Use `tasks_suggest` for AI-generated follow-up candidates.
5. Use `tasks_add` when the user approves suggestions or gives direct instructions.
6. Use `rules_list`, `rules_add`, and the explicitly approved rule-execution tools when the user wants recurring follow-up behavior.

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
