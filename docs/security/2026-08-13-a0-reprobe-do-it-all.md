# A0 live reprobe — DO IT ALL (2026-08-13)

READ-ONLY. No Hermes/OMP/Tailscale mutations. No APPLY. No apply.log.

| Field | Value |
|---|---|
| UTC | `2026-08-19T09:48:50Z` |
| Owner instruction | `DO IT ALL` — **not** `АПPLY HMA-20260809-A1` |
| Official apply.log | **not created** |

## Live getback

| Key | Value |
|---|---|
| `hermes version` | v0.20.0 (2026.8.3), upstream `c0106e50` |
| `approvals.mode` | **`off`** (P0 still live) |
| `security.tirith_enabled` | `true` |
| `security.tirith_fail_open` | **`true`** |
| `security.allow_private_urls` | `true` |
| `skills.write_approval` | `false` |
| `memory.write_approval` | `false` |
| OMP `modelRoles.default` | `cursor/cursor-grok-4.6-xhigh` |

## File modes (modes only)

| Path basename | Mode |
|---|---|
| `.env.backup.telegram_home.20260708_103002` | **644** |
| `.env.backup.20260708_100905` | **644** |
| `tskey-api.secret` | **MISSING** (was mode 600 at 13:33:22Z; value not read) |

## Cron

`hermes cron list --json` is not a valid CLI invocation (exit 2, usage). No job names or secrets recorded this probe.

## Syncthing / Tailscale

| Check | Result |
|---|---|
| `syncthing` CLI | not on PATH |
| BackendState | Running |
| Self.HostName | `tb` |
| Self.Online | true |
| Peer count | 600 |
| Source/target node | **unresolved** |

## Drift vs 13:33:22Z

P0 unchanged: approvals still `off`, Tirith still fail-open, env backups still 644, Tailscale still 600 peers, Syncthing still absent, apply.log still absent. `tskey-api.secret` is now missing from `~/.hermes` (mode-only observation; no content read).

## Verdict

**FAIL CLOSED for A1–A3.** `DO IT ALL` authorizes the program of work; Stage C still requires the exact string `АПPLY HMA-20260809-A1` and a named target node. Rollback must never restore `approvals.mode=off`.

## Mutations

**none**
