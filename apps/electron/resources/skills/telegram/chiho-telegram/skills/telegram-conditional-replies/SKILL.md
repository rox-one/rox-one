---
name: telegram-conditional-replies
description: Create, dry-run, or execute conditional Telegram reply workflows. Use when the user wants automatic or semi-automatic replies based on chat content, tags, folders, or follow-up state.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with rule tools; message execution requires write-scoped tools.
metadata:
  chiho.category: telegram-automation
  chiho.risk: high
  chiho.requiresApproval: "true"
  chiho.cloudScopes: telegram.read, crm.write, telegram.message.preview, telegram.message.send, telegram.batch.write, automation.rules.write
allowed-tools: mcp(dialogs_list) mcp(chat_read) mcp(rules_list) mcp(rules_add) mcp(rules_disable) mcp(rules_delete) mcp(rules_dry_run) mcp(rules_run) mcp(rules_log) mcp(message_send_draft) mcp(outbox_preview) mcp(write_approve_preview) mcp(outbox_send_approved)
---

# telegram-conditional-replies

Use this skill for rule-driven reply workflows.

## Rules

- Start with dry-run or recommendation mode unless the user explicitly asks to enable execution.
- Prefer CRM tasks or draft replies before automatic sends.
- Read recent history before proposing reply conditions.
- Use explicit enablement and approval for any rule that sends Telegram messages.
- Do not create broad always-on reply rules without a narrow condition and audit path.

## Flow

1. Inspect existing rules with `rules_list`.
2. Read target chats with `dialogs_list` and `chat_read` when needed.
3. Add or adjust rule instructions with `rules_add` if the user requests persistence.
4. On local tgchats, dry-run the rule with `rules_dry_run`. Chiho Cloud does not expose that local-only tool, so inspect the proposed conditions and affected scope without running the rule.
5. Inspect outcomes with `rules_log`.
6. Run the rule with `rules_run` only after the local dry-run or hosted review is acceptable and the user explicitly approves execution.
7. For actual replies, create a non-sending preview with `outbox_preview`. After explicit approval, Chiho Cloud must call `write_approve_preview` and then `outbox_send_approved`; local tgchats calls `outbox_send_approved` after the user approves. `message_send_draft` is a direct-send tool and must only be used when the user explicitly asks to send immediately.

## Execution Boundary

Use `rules_disable` or `rules_delete` to stop or clean up persistent conditional reply rules. Until `rules_update` exists, replace a rule by creating a narrower new rule and deleting the old one after review.

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
