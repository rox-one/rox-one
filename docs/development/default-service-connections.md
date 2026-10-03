# Default service connections

Exa, Firecrawl, Brave Search and E2B are enabled for new workspaces. Loading an
existing workspace migrates the old generated defaults once and includes the
services in new session defaults. A source disabled after migration, an edited
disabled legacy configuration, and user-owned credentials remain authoritative.

Credentials belong to the process that hosts `SessionManager` and its MCP pool.
Remote web/Electron clients connected to that host use its tools without receiving
the provider keys. A standalone Electron installation uses its own main process;
provisioning one development host does not configure every standalone installation
or a separate production server.

The backend reads `DEEPGRAM_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`,
`BRAVE_API_KEY`, `E2B_API_KEY` and optional `TAVILY_API_KEY` from its environment,
or from `ROX_SERVICE_SECRETS_FILE`. The default file is
`<ROX_CONFIG_DIR>/service-secrets.env`, owned by the backend OS user with mode 0600
on macOS/Linux. It accepts LF/CRLF `NAME=value` lines and quoted/exported values.
Do not include this file in desktop bundles, Git, source configs or renderer state.
Tavily credentials may be validated/provisioned, but no Tavily source is seeded.

Run `bun scripts/verify-service-keys.ts <private-candidates.json> <private.env>` on
the actual backend host. Candidate objects contain `env` and `key`. Every supplied
candidate is tested; the first successful key for each service is selected. The
report contains service names, candidate numbers and sanitized outcomes only.
Publication is atomic and private; failed/network-blocked probes preserve existing
deployment values. A network policy block establishes no verdict about API keys.

Backend HTTPS egress must allow:

- `api.deepgram.com`: model catalog and diarized/paragraph transcription.
- `api.exa.ai`: authenticated search and contents.
- `api.firecrawl.dev`: credit verification and v2 scrape/crawl/map.
- `api.search.brave.com`: authenticated Brave web search.
- `api.e2b.dev`: v2 sandbox creation/listing and sandbox deletion.
- `49999-<sandbox-id>.e2b.app` and `49999-<sandbox-id>.e2b.dev`: E2B code execution;
  these are dynamic provider-owned sandbox subdomains. Only ephemeral sandbox
  tokens are sent there; the account API key stays on `api.e2b.dev`.
- `api.tavily.com`: optional Tavily key verification.

Shared credentials are restricted to the generated provider ID, exact origin and
expected authentication headers. Redirects are rejected. E2B exposes both its
management API and `execute_code`: the host creates `code-interpreter-v1`, runs
bounded code, returns stdout/stderr/results/errors and deletes the sandbox. A
short remote TTL provides cleanup if deletion cannot reach E2B.

Presence of a backend key controls authentication availability on every source
load. Upstream failure state remains visible. Production-wide availability still
requires verified keys on the actual production host and clients connected to it;
fixture tests and a provisioned development file do not establish that deployment.
