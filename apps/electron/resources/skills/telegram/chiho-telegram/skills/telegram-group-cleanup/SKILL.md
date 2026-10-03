---
name: telegram-group-cleanup
description: Review Telegram group chats and recommend cleanup actions such as archiving, organizing into folders, tagging, or leaving stale groups. Use when the user wants to reduce noisy or low-value Telegram groups.
license: MIT
compatibility: Requires Chiho.ai Cloud MCP or local tgchats with read tools; leaving groups requires group leave write tools.
metadata:
  chiho.category: telegram-organization
  chiho.risk: high
  chiho.requiresApproval: "true"
  chiho.cloudScopes: telegram.read, crm.write, telegram.folders.write, telegram.groups.leave
allowed-tools: mcp(dialogs_list) mcp(chat_read) mcp(folders_list) mcp(folders_create) mcp(folders_add_dialog) mcp(folders_remove_dialog) mcp(tags_set) mcp(tasks_add) mcp(groups_leave_preview) mcp(write_approve_preview) mcp(groups_leave_approved)
---

# telegram-group-cleanup

Use this skill to identify and clean up stale or noisy Telegram groups.

## Rules

- Start in recommendation mode.
- Separate reversible actions from destructive or hard-to-reverse actions.
- Folder moves, tags, and tasks are lower risk than leaving groups.
- Leaving groups must use preview-first execution and explicit approval unless team/token policy says otherwise.
- Never leave groups based only on inactivity; include context and reason.

## Flow

1. Use `dialogs_list` to find group candidates.
2. Use `chat_read` to inspect recent context for uncertain groups.
3. Recommend actions: keep, tag, add follow-up task, move folder, archive recommendation, or leave.
4. Use the folder-management tool available on the selected runtime, `tags_set`, or `tasks_add` for approved organization actions.
5. Use `groups_leave_preview` first. On Chiho Cloud, call `write_approve_preview` after approval and then `groups_leave_approved`; local tgchats calls `groups_leave_approved` after approval.

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
