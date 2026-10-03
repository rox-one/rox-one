# Set up Chiho.ai Telegram CRM

Use this setup flow after the plugin is installed or whenever the
`chiho-cloud` MCP connection needs to be reconnected.

1. Confirm that the user has a Chiho account and has connected Telegram at
   `https://chiho.ai/`. If not, direct them there and wait for them to finish.
2. Confirm that the Chiho.ai Telegram CRM plugin is enabled. In Claude Code,
   ask the user to open `/plugin`, select **Chiho.ai Telegram CRM**, and enable
   it. If they installed it directly from Chiho's marketplace, they can instead run
   `claude plugin enable chiho-telegram@chiho`. In Cowork, they can enable the
   plugin in its settings.
3. Open the MCP connection interface. In Claude Code, ask the user to open
   `/mcp` and select `chiho-cloud`. In Cowork, select **Connect** for the bundled
   connector.
4. Reconnect to `https://api.chiho.ai/mcp/v8` through browser OAuth. Grants for
   the earlier `/mcp` resource cannot authorize v8. Start browser authentication. Never ask the user to create,
   paste, or expose
   a Chiho personal access token, Telegram API hash, or Telegram session.
5. Let the user review the client identity, redirect host, Chiho account or
   team, and requested permissions before they consent.
6. After the browser returns to Claude, call `auth_status` and then
   `account_whoami`.
7. If both calls succeed, optionally run a read-only smoke test with
   `dialogs_list` limited to five dialogs. Do not perform a write as part of
   setup.

If authentication fails, reopen the MCP connection and retry browser OAuth. If
the user previously revoked the grant, reconnect instead of falling back to a
static token.

Tell the user they can revoke the connection at
`https://chiho.ai/profile/agent-access`.
