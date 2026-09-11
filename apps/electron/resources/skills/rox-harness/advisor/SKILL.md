---
name: advisor
description: Review the current session's work in this chat. Do not spawn a hidden second agent loop.
---

# Advisor

Run a review **in this session**. Do not call `spawn_session`. Do not start a second hidden chat.

Use the bundled `requesting-code-review` guidance on the current git diff and the current transcript. Report findings here. The user remains the only Allow/Deny source for tools.
