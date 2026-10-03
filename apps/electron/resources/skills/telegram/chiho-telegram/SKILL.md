---
name: chiho-telegram
description: Choose the Chiho CRM, Unofficial Telegram MCP, or self-hosted tgchats package when connecting an AI client to Telegram.
---

# Chiho Telegram

Choose the product the user intends. Do not configure multiple Telegram packages implicitly because their tools overlap.

## Hosted: Chiho Telegram

Use this package for Chiho CRM or shared team workflows.

- MCP URL: `https://api.chiho.ai/mcp/v8`
- Authentication: browser OAuth discovered from the server
- Telegram session and CRM: hosted by Chiho
- Package: `plugins/chiho-telegram`
- Interactive onboarding: never uses a personal access token

Connect Telegram at `https://chiho.ai`, install or add the hosted connector, authenticate in the browser, and start with `auth_status`.

Claude.ai, Claude Desktop, and Cowork users can add `https://api.chiho.ai/mcp/v8` as a custom connector. Claude Code and Codex users can install the hosted package from this repository's `chiho` marketplace.

Advanced service tokens belong only to explicitly requested headless automation. Do not offer them as an alternative when interactive OAuth needs troubleshooting.

## Hosted: Unofficial Telegram MCP

Use `plugins/unofficial-telegram-mcp` for personal Telegram client work without Chiho CRM or team tools. Its OAuth resource is `https://telegram-mcp.chiho.ai/mcp/v2`. Complete a separate browser consent for this exact resource. Do not copy an OAuth grant from the Chiho CRM connection.

## Self-hosted: tgchats local

Choose the local package only when the user wants local data ownership and will operate their own Telegram runtime.

- Transport: local stdio MCP
- Authentication: user-owned Telegram API credentials and local session
- Storage: local session plus optional Postgres CRM database
- Package: `plugins/tgchats-local`
- Hosted Chiho endpoint: not configured

Build or install the `tgchats-mcp` binary before installing this plugin. Then follow the packaged `tgchats-local` skill for runtime prerequisites and tool routing.

## Safety boundary

- Never expose Telegram API hashes, session strings, session databases, OAuth tokens, or service tokens.
- Respect client write prompts and server preview/approval flows.
- Read the current state before an open-ended mutation, but do not add unrelated reads before an explicit action.
- Stop on stale authentication and direct the user to the relevant hosted or local reconnect flow.
