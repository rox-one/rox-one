# Bulk Template Message Flow

1. Resolve the audience from explicit peers, folders, tags, or a prior dialog list.
2. Select one template from `assets/templates.json`.
3. Fill variables conservatively. Leave unresolved variables visible in the preview instead of guessing.
4. Call `outbox_preview`.
5. Present recipient count, skipped recipients, message preview, schedule, and risk.
6. Complete any runtime-specific approval-recording step; approval alone does not execute the preview.
7. Call `outbox_send_approved` only after approval or when policy allows automatic execution.
8. Report sent, scheduled, skipped, and failed recipients.

Use a stable idempotency key for retries, for example a hash of template id, recipients, schedule, and user request id.
