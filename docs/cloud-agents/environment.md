# Cloud Agent development environment (headless Linux)

This document describes how to run **Rox** (`rox-one/rox-one`, the Craft Agents fork)
reproducibly inside a headless Linux Cursor Cloud Agent VM, and what has been
verified live. It is the reference for `.cursor/environment.json` in this repo.

> **Do not launch Electron on a headless VM.** `bun run electron:dev` /
> `electron:start` require a display and will fail; under Turbo/`concurrently`
> a failed Electron process can tear down the rest of the dev graph. The
> canonical headless path is the **standalone server** (`packages/server`) plus
> the **web UI** (`apps/webui`) and/or the **CLI** (`apps/cli`) — none of which
> need a display. All commands below are display-free.

## Toolchain

| Tool | Version | Provisioned by |
|---|---|---|
| Bun | `1.3.14` (pinned; matches `.circleci/config.yml` `oven/bun:1.3.14-debian`) | `.cursor/environment.json` `install` (installs if missing, symlinks into `/usr/local/bin`) |
| Node | ≥ 22 (default image) | base image |
| Python | ≥ 3.12 (default image; used by doc-tool smoke tests) | base image |

There is **no** Turbo, Electric, Postgres, Docker Compose, or Caddy stack in this
repository (verified: no `turbo.json` / `docker-compose*` / `Caddyfile`; zero
`electric`/`huly`/`mastra` references). The only datastore is the on-disk config
dir `~/.craft-agent/` (JSON + JSONL + an AES-256-GCM `credentials.enc` + per-source
SQLite FTS). Package manager is **Bun with the hoisted linker** (`bunfig.toml`) —
do not switch to the isolated linker (Vite/renderer imports of transitive deps
depend on the hoisted layout).

## `.cursor/environment.json`

```json
{
  "name": "Rox (rox-one) — headless dev",
  "install": "if ! command -v bun >/dev/null 2>&1; then curl -fsSL https://bun.sh/install | bash -s \"bun-v1.3.14\"; sudo ln -sf \"$HOME/.bun/bin/bun\" /usr/local/bin/bun; sudo ln -sf \"$HOME/.bun/bin/bun\" /usr/local/bin/bunx; fi\nexport PATH=\"$HOME/.bun/bin:$PATH\"\nbun install --frozen-lockfile"
}
```

- `install` is idempotent: the `bun` install branch is skipped when `bun` is
  already present (e.g. when booting from a prebuilt snapshot), and
  `bun install --frozen-lockfile` converges without lockfile churn (only the
  `husky` prepare hook re-runs).
- No `start` command. Dev servers are started on demand (below) so a headless
  Electron launch can never tear down the environment.
- A committed `.cursor/environment.json` is the highest-precedence environment
  source and overrides any dashboard/personal/team environment for this repo.

## Bootstrap and run (steps A–J)

### A. Clean install
```bash
bun install --frozen-lockfile      # ~1785 packages
```

### B/C. Local bootstrap + "database"
No external DB. State lives under `~/.craft-agent/` and is created lazily on
first server boot (config, seeded `rox-kimi` connection, bundled skills,
`soul.md`/`rules.md`, per-workspace dirs). Nothing to provision.

### D. Web/API startup (headless server + embedded web UI)
```bash
bun run server:build:subprocess    # session-mcp-server + pi-agent-server bundles
bun run webui:build                # Vite production build → apps/webui/dist

CRAFT_SERVER_TOKEN="$(openssl rand -hex 24)" \
CRAFT_WEBUI_PASSWORD="<dev-password>" \
CRAFT_WEBUI_DIR=apps/webui/dist \
CRAFT_WEBUI_SECURE_COOKIE=false \
CRAFT_RPC_HOST=127.0.0.1 \
CRAFT_RPC_PORT=9100 \
CRAFT_BUNDLED_ASSETS_ROOT="$PWD/apps/electron" \
CRAFT_BROWSER_BACKEND=none \
bun run packages/server/src/index.ts
```
The server prints `CRAFT_SERVER_URL=ws://127.0.0.1:9100` and serves the web UI
on the **same** port (the `CRAFT_WEBUI_PORT` in the root `server:dev:webui`
script is a dead knob — nothing reads it). `CRAFT_SERVER_TOKEN` must be ≥ 16
chars. Bind to `127.0.0.1` only (the server refuses a non-localhost bind
without TLS).

### E. Browser accessibility
- `GET /` → `302 /login`; `POST /api/auth {"password": "<dev-password>"}` →
  `200` + `craft_session` JWT cookie; authenticated `GET /` → `200` SPA;
  `GET /api/config` → `{"wsUrl":"ws://127.0.0.1:9100"}`.
- In a browser: log in, the full (Russian-first) UI loads over WebSocket, and
  you can create a session/navigate settings. Chrome is available in the VM for
  `computerUse`-style verification.

### F. Lint
```bash
bun run lint:i18n:parity     # i18n key parity across 9/10 locales
bun run lint:i18n:sorted
bun run lint:i18n:coverage
# (bun run lint also runs eslint for electron/shared/ui + ipc/tool-name checks)
```

### G. Typecheck
```bash
bun run typecheck:shared     # packages/shared tsc --noEmit
# bun run typecheck:all covers core/shared/server-core/server/electron/ui
```

### H. Tests
```bash
bun run test:shared:all                                   # 91 shared tests
bun test packages/shared/src/i18n                          # i18n parity
bun run apps/cli/src/index.ts --validate-server            # 40-step server smoke (see caveat)
```

### I. Build
`server:build:subprocess` and `webui:build` (above) are the practical headless
builds. `electron:*` / `electron:dist:*` are **not** headless-runnable.

### J. Deterministic re-run
Re-running `install` is safe (idempotent). A fresh Cloud Agent booting from this
environment reproduces the same stack (verified — see below).

## Verified evidence

Executed live on clean Linux x64 VMs (Bun 1.3.14):

| Check | Result |
|---|---|
| `bun install --frozen-lockfile` | OK (~1785 pkgs); idempotent on re-run |
| `bun run typecheck:shared` | exit 0 |
| `bun run test:shared:all` | 91 pass / 0 fail |
| `bun run lint:i18n:parity` | OK (9 locales, 2964 keys each) |
| `server:build:subprocess` + `webui:build` | OK (cjs 4.65 MB, esm 28.73 MB; Vite build OK) |
| Headless server boot | OK — `ws://127.0.0.1:9100` + embedded web UI |
| Web UI HTTP + browser | login (JWT) → SPA → create session → settings, no blocking errors |
| Fresh Cloud Agent (prebuilt env build) | Bun 1.3.14, deps present, typecheck + 91 tests + i18n parity pass, server boots + handles RPC |

## Known caveat — LLM turns need credentials

The seeded default connection is `rox-kimi` (provider `omp`), which the `omp`
CLI backs with `~/.omp/agent/config.yml`. Nothing in this repo provisions that
file, so on a fresh VM the **first chat turn cannot complete** (and currently
hangs rather than erroring — see PR #2 / `plans/integration-audit.md` §3.1). The
CLI `--validate-server` harness therefore passes all infrastructure steps
(connect/handshake, credentials, workspaces, sessions/sources/labels CRUD,
disconnect) and fails only the LLM-dependent steps. To exercise a real turn,
provide provider credentials out of band (e.g. an `ANTHROPIC_API_KEY` /
`$LLM_API_KEY`, or a Rox gateway `~/.omp/agent/config.yml`) via Cloud Agent
Secrets — never commit credentials or print full environment variables.

Note: the first server boot schedules a background toolchain install (~15 tools
incl. `omp`, node, python, ffmpeg — hundreds of MB). Expect that network/disk
cost on a cold VM; `config.toolchain.disabled` / the `toolchain:setDisabled` RPC
can trim it.
