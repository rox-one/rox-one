# Telegram Full Access OpenClaw Plugin

This folder is the ClawHub package source for the `telegram-full-access` OpenClaw plugin package.

The package points OpenClaw users to:

- the published ClawHub skill: https://clawhub.ai/seichris/telegram-full-access
- Chiho.ai Cloud for hosted Telegram + CRM access
- the local `tgchats-mcp` runtime from https://github.com/chihoai/telegram-for-ai-agents

Publish command:

```bash
clawhub package publish docs/telegram-full-access-plugin \
  --family code-plugin \
  --name @seichris/telegram-full-access \
  --display-name "Telegram Full Access" \
  --version 0.2.0 \
  --changelog "Refresh Chiho.ai Cloud and self-hosted tgchats setup guidance"
```
