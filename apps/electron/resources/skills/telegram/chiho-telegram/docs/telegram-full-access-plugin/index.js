import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "telegram-full-access",
  name: "Telegram Full Access",
  description:
    "Connect OpenClaw to Telegram through Chiho.ai Cloud or the local tgchats MCP runtime.",
  register() {
    // The current package publishes discovery/setup metadata. Telegram tools are
    // provided by Chiho.ai Cloud MCP or by the user's local tgchats-mcp process.
  },
});
