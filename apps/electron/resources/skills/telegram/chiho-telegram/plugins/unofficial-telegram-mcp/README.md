# Unofficial Telegram MCP

Unofficial Telegram MCP by Chiho.ai connects Claude to a personal Telegram account already connected at Chiho.ai. It is an independent, hosted Telegram client connector. It is not affiliated with Telegram and does not include Chiho's CRM or team tools.

The plugin declares one remote HTTP MCP server at `https://telegram-mcp.chiho.ai/mcp/v2` and includes a skill that guides Claude through safe Telegram reads and message actions. It runs no local executable, hook, or package installer. The server uses browser OAuth; never paste a Telegram session, API hash, or personal access token into Claude.

## Connect

1. Connect your Telegram account at [Chiho.ai](https://chiho.ai/).
2. Add and enable this plugin in Claude, then connect `telegram-cloud` through browser OAuth. Review the requested permissions and the personal account before consenting.
3. Ask Claude to check `auth_status` and `account_whoami`, then try a read-only request such as listing five recent dialogs.

You can also add the [remote MCP endpoint](https://telegram-mcp.chiho.ai/mcp/v2) as a custom connector in Claude. The connector and this plugin reference the same endpoint so Anthropic can pair their directory listings; enable only the connection you intend to use.

## Capabilities and safety

The server offers bounded reads of dialogs, contacts, messages, threads, scheduled messages, members, forum topics, join requests, invite links, admin logs, drafts, attention, media metadata, and updates. It also offers Telegram-native draft saving and separately previewed message actions. A preview does not execute its action; execution requires a second tool call and the user's authorization. Some reads depend on Telegram visibility and account rights. Observe returned cursors and flood-wait retry times.

Telegram content and account data are sent through Chiho.ai's hosted service to Claude when a user invokes a tool. Chiho.ai handles the connected Telegram session and OAuth credentials; this plugin stores neither locally. Revoke access in [Chiho Agent Access](https://chiho.ai/profile/agent-access).

## Help and policies

- [Source and issues](https://github.com/chihoai/telegram-for-ai-agents)
- [Chiho.ai privacy policy](https://chiho.ai/privacy)
- [Chiho.ai terms](https://chiho.ai/terms)
- [Contact Chiho.ai](https://chiho.ai/contact)

This plugin is licensed under MIT. See [LICENSE](./LICENSE).
