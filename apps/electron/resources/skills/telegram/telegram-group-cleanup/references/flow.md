# Group Cleanup Flow

1. List candidate groups with `dialogs_list`.
2. Read recent context for unclear groups with `chat_read`.
3. Classify each group as keep, organize, follow up, archive recommendation, or leave recommendation.
4. Use the folder-management tool available on the selected runtime, `tags_set`, or `tasks_add` for approved organization actions.
5. Call `groups_leave_preview` only when policy allows execution.
6. Complete any runtime-specific approval-recording step; approval alone does not leave a group.
7. Call `groups_leave_approved` only after the required approval.

Prefer recommendations and reversible organization before leaving groups.
