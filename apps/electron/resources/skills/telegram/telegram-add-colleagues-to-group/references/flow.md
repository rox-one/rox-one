# Add Colleagues To Group Flow

1. Resolve the colleague's Telegram user id and access hash if available.
2. Resolve group candidates with `dialogs_list`.
3. Read chat context only for ambiguous group names.
4. Call `members_invite_preview`.
5. Present groups, permissions, privacy fallback behavior, and skipped groups.
6. Complete any runtime-specific approval-recording step; approval alone does not execute the invite.
7. Call `members_invite_approved` after approval or when policy allows automatic execution.
8. Report direct adds, invite-link fallbacks, and failures.
