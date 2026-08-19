# Ticket 17 — one subprocess env blocklist (inventory 6.4)

Date: 2026-08-13  
Branch: `rox/next-program-t17-blocklist-7c33`

MCP stdio spawn and script-sandbox sanitization no longer copy the same arrays. Both import `@craft-agent/core/env`. A source-scan test fails if either file grows a local `BLOCKED_ENV_VARS` again.

`ENV_OVERRIDE_DENY` (config setter denylist) stays separate — different question.
