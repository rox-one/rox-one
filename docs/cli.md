# craft-cli — CLI Reference

Terminal client for Craft Agent server. Connects over WebSocket (`ws://` or `wss://`) to a running headless server.

## Prerequisites

- [Bun](https://bun.sh/) runtime installed
- For `run` and `--validate-server`: an API key via `--api-key`, `$LLM_API_KEY`, or a provider-specific env var (e.g., `$ANTHROPIC_API_KEY`)
- For all other commands: a running Craft Agent headless server with URL and token

## Installation

```bash
# Clone the repository
git clone https://github.com/rox-one/rox-one.git
cd rox-one

# Install dependencies
bun install

# Option A: Run directly
bun run apps/cli/src/index.ts <command>

# Option B: Link globally (adds craft-cli to PATH)
cd apps/cli && bun link
craft-cli <command>
```

### Quick Start

The fastest way to try it out — no server setup needed:

```bash
# Self-contained run (spawns a server automatically)
ANTHROPIC_API_KEY=sk-... bun run apps/cli/src/index.ts run "Hello, world!"
```

## Connection Options

| Flag | Env var | Default | Description |
|------|---------|---------|-------------|
| `--url <ws[s]://...>` | `ROX_SERVER_URL` (`CRAFT_SERVER_URL`) | — | Server WebSocket URL |
| `--token <secret>` | `ROX_SERVER_TOKEN` (`CRAFT_SERVER_TOKEN`) | — | Authentication token (**≥16 characters**; shorter tokens are fatal at server boot) |
| `--workspace <id>` | — | auto-detect | Workspace ID |
| `--timeout <ms>` | — | `10000` | Request timeout |
| `--tls-ca <path>` | `CRAFT_TLS_CA` | — | Custom CA cert for self-signed TLS |
| `--json` | — | `false` | Raw JSON output for scripting |
| `--send-timeout <ms>` | — | `300000` | Timeout for `send` command (5 min) |

Flags take precedence over environment variables. If `--workspace` is omitted, the CLI auto-detects the first available workspace.

### Headless server constraints

These apply to the server the CLI talks to, not to the CLI binary itself:

- **`ROX_SERVER_TOKEN` ≥ 16 characters.** `CRAFT_SERVER_TOKEN` still works. Tokens shorter than 16 chars fail at boot (`Token too short`). Generate one with `bun run packages/server/src/index.ts --generate-token` or `openssl rand -hex 32`.
- **Config-dir single-instance lock.** A second server process against the same `ROX_CONFIG_DIR` (or `CRAFT_CONFIG_DIR`; default `~/.craft-agent`) refuses to start (`Another server instance is already running (PID …)`). Stop the old process first, or set `ROX_CONFIG_DIR` to a different path for a parallel instance.

## Commands

### Info & Health

```bash
craft-cli ping              # Verify connectivity (clientId + latency)
craft-cli health            # Check credential store health
craft-cli versions          # Show server runtime versions
```

### Resource Listing

```bash
craft-cli workspaces        # List all workspaces
craft-cli sessions          # List sessions in workspace
craft-cli connections       # List LLM connections
craft-cli sources           # List configured sources
```

### Session Operations

```bash
craft-cli session create [--name <n>] [--mode <m>]  # Create session
craft-cli session messages <id>                       # Print message history
craft-cli session delete <id>                         # Delete session
craft-cli cancel <id>                                 # Cancel processing
```

### Send Message (Streaming)

```bash
# Send a message and stream the AI response in real time
craft-cli send <session-id> <message>

# Pipe text from stdin
echo "Summarize this file" | craft-cli send <session-id>

# Read from stdin explicitly
cat document.txt | craft-cli send <session-id> --stdin
```

The `send` command subscribes to session events and streams them to stdout:
- `text_delta` — text streamed inline
- `tool_start` — `[tool: name]` marker
- `tool_result` — tool output (truncated to 200 chars)
- `error` — printed to stderr, exit code 1
- `complete` — exit code 0
- `interrupted` — exit code 130

### Power User

```bash
# Raw RPC call — send any channel with JSON args
craft-cli invoke <channel> [json-args...]

# Subscribe to push events (Ctrl+C to stop)
craft-cli listen <channel>
```

Examples:
```bash
craft-cli invoke system:homeDir
craft-cli invoke sessions:get '"workspace-123"'
craft-cli listen session:event
```

### Storage Migration (W1-13)

```bash
craft-cli migrate-config              # Move ~/.rox to ~/rox (never deletes)
craft-cli migrate-config --dry-run    # Preview only, write nothing
craft-cli migrate-config --revert     # Move ~/rox back to ~/.rox
craft-cli migrate-config --auto       # Install scripts: only when the flag is on
```

Local-only: needs no server URL. The manual forms work regardless of the
`storage.visible-root.v1` flag. `~/.rox` is left as a symlink
(Windows: junction) to `~/rox`. `--revert` is refused while
`~/rox/.migration/conflicts` is non-empty, while the flag is still on
(env or persisted — the next launch would migrate again) and while a live
Rox process holds a lock (`.server.lock`, or the desktop app's `.app.lock`).

The migration itself also defers while the desktop app or a server is running,
and when `~/rox` already holds files that are not a Rox home (nothing is moved,
merged or re-permissioned). A `~/rox` that is only a link into the legacy
home is replaced by the real folder (the link itself is removed, never its
target). Only `migrate-config` and the desktop app (once, at launch, with the
flag on) ever move files; other commands just read the current location.

When both folders exist, the one Rox already uses stays in charge before,
during and after the move, so no process ever switches folders halfway:

- `~/rox` holds your data (it has workspaces): Rox keeps using `~/rox`, and
  what `~/.rox` still has is brought over. Files missing in `~/rox` are
  copied, identical files are skipped, and a different `~/.rox` version is
  kept under `~/rox/.migration/conflicts/<timestamp>/` (one folder per
  attempt; nothing there is ever overwritten). `~/rox` always keeps its own
  version. Then `~/.rox` is renamed to `~/.rox.migrated-<timestamp>`.
  A retry (see below) remembers what it already brought over in
  `~/rox/.migration/imported.jsonl`, so files you changed or deleted in
  `~/rox` meanwhile are never brought back and nothing is kept twice.
- `~/rox` has no data yet: `~/.rox` stays in use until it is renamed into
  place. The old `~/rox` is first moved into `~/.rox/.migration/` (files
  `~/.rox` lacks are copied into `~/.rox` before that), and afterwards only
  its files that differ are kept under `conflicts/`. Nothing is ever copied
  into `~/rox` while `~/.rox` is the folder in use.

Files are copied atomically (temp file, then rename), so an interrupted
merge never leaves a truncated file behind. Two files of the same size with
the same modification time count as identical; otherwise they are compared in
chunks, so a file of any size is never read into memory at once. A link
inside `~/rox` (for example to a dotfiles repo) is never written through: the
legacy version is kept under `conflicts/` instead. A legacy link that differs
from `~/rox` is kept there too. On Windows, links to folders are recreated as
junctions, which cannot be relative: a relative folder link becomes an absolute
junction into `~/rox` and may dangle after `--revert` (a file link that Windows
will not create is kept under `conflicts/` as a `.rox-symlink` note). Before copying, the migration checks (without
renaming anything) that `~/.rox` is not a mount point or a separate volume and
that your home folder is writable; when `~/rox` itself has to be moved aside,
it must be on the same disk too. Otherwise it defers (`deferred-unmovable`)
without copying anything. Lock files and migration bookkeeping at the top of
`~/.rox` are not copied; they stay in the archived
`~/.rox.migrated-<timestamp>`. If a Rox process starts on `~/.rox` while files
are being brought over, renaming `~/.rox` waits for the next launch. If renaming
`~/.rox` fails (for example a file is open in another program), or bringing
files over fails (an unreadable file, a full disk), the folder in use stays
in use and `~/.rox` keeps everything. A file in use is retried at the next launches (up
to three times); after that, or for any other error, the app waits 24 hours
before trying again. `craft-cli migrate-config` retries at once. The Settings
page shows why the last move was postponed. If the app stopped right after
renaming `~/.rox`, the next launch creates the missing `~/.rox` link.

While it runs, the migration holds `~/.rox-migrate.lock` (removed afterwards,
refreshed during long merges). It also honours the desktop app's runtime lock in the temp
directory, `$XDG_RUNTIME_DIR` and `/tmp`. Shared directories hold it in a
private per-user `rox-<uid>/` folder. Lock files that are links or belong to
another user are ignored. Apps in a separate sandbox (a
private `/tmp`) can only be seen through the `.app.lock` that the app keeps in
the config dir while the flag is on.

`--auto` never prompts and does nothing (exit 0) unless the flag is active;
with the flag on it exits 1 when the migration is deferred (live locks, a
legacy folder that cannot be renamed, a failed merge waiting to be retried),
`~/.rox` points elsewhere, or the move fails. Every non-zero exit leaves the
legacy home in place; nothing is ever deleted.

### Run (Self-Contained)

```bash
craft-cli run <prompt>
craft-cli run --workspace-dir ./project --source github "List open PRs"
```

The `run` command is fully self-contained — it spawns a headless server, creates a session, sends the prompt, streams the response, and exits. No separate server setup needed. An API key is resolved from `--api-key`, `$LLM_API_KEY`, or a provider-specific env var (e.g., `$ANTHROPIC_API_KEY`, `$OPENAI_API_KEY`).

| Flag | Default | Description |
|------|---------|-------------|
| `--workspace-dir <path>` | — | Register a workspace directory before running |
| `--source <slug>` | — | Enable a source (repeatable) |
| `--output-format <fmt>` | `text` | Output format: `text` or `stream-json` |
| `--mode <mode>` | `allow-all` | Permission mode for the session |
| `--no-cleanup` | `false` | Skip session deletion on exit |
| `--server-entry <path>` | — | Custom server entry point |

**LLM Configuration:**

| Flag | Env Fallback | Default | Description |
|------|-------------|---------|-------------|
| `--provider <name>` | `LLM_PROVIDER` | `anthropic` | Provider: `anthropic`, `openai`, `google`, `openrouter`, `groq`, `mistral`, `xai`, etc. |
| `--model <id>` | `LLM_MODEL` | (provider default) | Model ID (e.g., `claude-sonnet-4-5-20250929`, `gpt-4o`, `gemini-2.0-flash`) |
| `--api-key <key>` | `LLM_API_KEY` | (provider env) | API key — also checks provider-specific vars like `$OPENAI_API_KEY` |
| `--base-url <url>` | `LLM_BASE_URL` | — | Custom endpoint for proxies, OpenRouter, or self-hosted models |

```bash
# Multi-provider examples
craft-cli run --provider openai --model gpt-4o "Summarize this repo"
GOOGLE_API_KEY=... craft-cli run --provider google --model gemini-2.0-flash "Hello"
craft-cli run --provider anthropic --base-url https://openrouter.ai/api/v1 --api-key $OR_KEY "Hello"
```

Prompt can also be piped via stdin:
```bash
echo "Summarize this file" | craft-cli run
cat error.log | craft-cli run "What's causing these errors?"
```

### Validate Server

```bash
# Against a running server
craft-cli --validate-server --url ws://127.0.0.1:9100 --token <token>

# Self-contained (auto-spawns a server)
craft-cli --validate-server
```

When no `--url` is provided, `--validate-server` automatically spawns a local headless server (same as the `run` command), runs the validation, and shuts it down.

Runs a 40-step integration test (see `getValidateSteps()` in `apps/cli/src/index.ts`) covering the full server lifecycle including labels, branching, sources, MCP sources, skills, automations, and webhooks:

1. Connect + handshake
2. `credentials:healthCheck`
3. `system:versions`
4. `system:homeDir`
5. `workspaces:get`
6. `sessions:get`
7. `LLM_Connection:list` (auto-creates a connection when `--api-key`/`$LLM_API_KEY` is provided)
8. `sources:get`
9. `sessions:create` (temporary `__cli-validate-*` session)
10. `sessions:getMessages`
11. Send message + stream (text response)
12. Send message + tool use (Bash tool)
13. `labels:create` (temporary e2e-test label)
14. `session-tools:set_session_labels`
15. `session-tools:get_session_info`
16. `session-tools:list_sessions`
17. `sessions:branch`
18. `sessions:branch verify`
19. `sessions:branch send`
20. `sources:create` (temporary Cat Facts API source)
21. Send + source mention (uses the created source)
22. `mcp:craft-public` (MCP source, auth:none)
23. `mcp:stitch-mcp` (MCP source, header auth)
24. Send + skill create (writes SKILL.md via Bash)
25. `skills:get` (verify skill appears)
26. Send + skill mention (invokes the created skill)
27. `skills:delete` (cleanup)
28. `automation:create`
29. `automation:trigger` (status change)
30. `automation:verify session`
31. `automation:verify labels`
32. `automations:getLastExecuted`
33. `webhook:test` (RPC)
34. `webhook:verify failure`
35. `automation:cleanup`
36. `sessions:branch delete`
37. `sources:delete` (cleanup)
38. `labels:delete` (cleanup)
39. `sessions:delete` (cleanup)
40. Disconnect

**Note:** This test mutates workspace state — it creates and deletes a temporary session, label, sources, automations, and a skill. All resources are cleaned up on completion. Continues on failure and reports a summary. Steps 11+ require a working LLM connection (any provider key via `--api-key`/`$LLM_API_KEY`). Use `--json` for machine-readable output.

## Scripting Patterns

```bash
# Get workspace IDs
WORKSPACES=$(craft-cli --json workspaces | jq -r '.[].id')

# Count sessions per workspace
for ws in $WORKSPACES; do
  COUNT=$(craft-cli --json --workspace "$ws" sessions | jq length)
  echo "$ws: $COUNT sessions"
done

# Create a session and capture its ID
SESSION_ID=$(craft-cli --json session create --name "CI Run" | jq -r '.id')

# Send a message and wait for completion
craft-cli send "$SESSION_ID" "Run the test suite and report results"

# Clean up
craft-cli session delete "$SESSION_ID"
```

## TLS / wss://

For remote servers with TLS:

```bash
# Trusted certificate (Let's Encrypt, etc.)
craft-cli --url wss://server.example.com:9100 ping

# Self-signed certificate
craft-cli --url wss://server.example.com:9100 --tls-ca /path/to/ca.pem ping
```

The `--tls-ca` flag sets `NODE_EXTRA_CA_CERTS` before connecting. You can also set `CRAFT_TLS_CA` in your environment.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Connection timeout` | Server not running or unreachable | Check server is started, verify URL |
| Server exits: `Token too short` | `ROX_SERVER_TOKEN` / `CRAFT_SERVER_TOKEN` has fewer than 16 characters | Use `openssl rand -hex 32` or `bun run packages/server/src/index.ts --generate-token` |
| Server exits: `Another server instance is already running` | Config-dir single-instance lock | Stop the existing process, or set `ROX_CONFIG_DIR` to a different path |
| `AUTH_FAILED` | Wrong token | Check `ROX_SERVER_TOKEN` matches server |
| `PROTOCOL_VERSION_UNSUPPORTED` | Version mismatch | Update CLI and server to same version |
| `WebSocket connection error` | Network issue or TLS problem | For self-signed certs, use `--tls-ca` |
| `No workspace available` | Workspace not yet created | Create one via desktop app or API |
