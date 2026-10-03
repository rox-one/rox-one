---
name: telegram-for-agents
description: Route Telegram work to Chiho CRM, Unofficial Telegram MCP, or the separate self-hosted tgchats runtime.
---

# Telegram for agents

Choose one product and avoid duplicate Telegram tool registrations.

## Chiho Telegram

Use the hosted package by default when the user has or wants a Chiho account.

- Connect to `https://api.chiho.ai/mcp/v8` through browser OAuth.
- Never ask an interactive user to mint or paste a personal access token.
- Keep hosted sessions and CRM data in Chiho.
- Use the `chiho-telegram` plugin package for Claude Code and Codex.
- Use the same canonical URL as a custom connector in Claude.ai, Claude Desktop, or Cowork.

Start with `auth_status`, then call the narrowest tool for the user's request. Respect client write prompts and Chiho's preview/approval controls.

## Unofficial Telegram MCP

For personal Telegram client reads and message actions without Chiho CRM or team workflows, use the `unofficial-telegram-mcp` plugin and its exact OAuth resource `https://telegram-mcp.chiho.ai/mcp/v2`. Do not reuse a grant from the CRM resource.

## tgchats local

Use the local package only when the user explicitly wants self-hosting.

- Require a built or installed `tgchats-mcp` binary, Telegram API credentials, and local session storage.
- Require Postgres for CRM and sync workflows, and configured AI credentials for AI tools.
- Use the `tgchats-local` plugin package; it launches only the local stdio server.
- Never silently add the hosted Chiho server from the local package.

Follow [the local runtime skill](../tgchats-local/SKILL.md) for detailed local tool routing.

## Safety

- Never expose Telegram sessions, API hashes, OAuth tokens, or service tokens.
- Verify recipients and targets before external Telegram actions.
- Use preview/approval flows for sends, invites, and group leaves.
