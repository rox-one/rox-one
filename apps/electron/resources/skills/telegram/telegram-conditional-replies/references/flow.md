# Conditional Replies Flow

1. Clarify the condition: tag, folder, message content, inactivity, sender, or explicit peer list.
2. Inspect existing rules with `rules_list`.
3. Read representative chats with `chat_read`.
4. Create a conservative rule with `rules_add` only if persistence is requested.
5. On local tgchats, evaluate with the rule dry-run tool. On Chiho Cloud, review the proposed conditions and affected scope without running the rule.
6. Run with `rules_run` only after the local dry-run or hosted review is acceptable and the user explicitly approves execution, then inspect `rules_log`.
7. For actual replies, use a single-recipient draft or preview-first outbox flow.

Default to "recommend and draft" instead of automatic sending.
