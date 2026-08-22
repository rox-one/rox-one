# A-ops runbook (A0 FAIL CLOSED)

- **Date:** 2026-08-19
- **Status:** Owner sent exact `АПPLY HMA-20260809-A1` on 2026-08-19. Initialization created owner-only evidence, then failed closed before A0 because 15/22 audit checksums mismatched.
- **Authoritative plan:** `~/hermes-migration-audit-20260809-121222/11-apply-plan.md`
- **Worktree:** `/Users/marklindgreen/Projects/_craft_worktrees/do-it-all-security-slices`
- **R3 historical evidence:** commit `78df77a`, historical 35-path manifest SHA-256 `e9db5372da46fe146815150aca9b9d4e77b32fb8495a35b30d55013228359e35`, 173 focused tests before its manifest generation.
- **R3 current source:** commits `feaced2`, `4dc9b1dc`, `e505d80f`, `cb36c864`, `b16cc69f`, `98f2f2c2`, and `a840f27b` repair offline contracts and covered-byte security boundaries. Tests/checksum/verifier are deliberately deferred by owner instruction; no start token or A0 action is implied.

## Live FAIL CLOSED (do not mutate)

| Check | Live | Required before mutation |
|---|---|---|
| APPLY artifact `~/.hermes-migration-apply/HMA-20260809-A1` | present: root `0700`, `apply.log` `0600`, `INIT audit-checksums FAIL` | Revision-3 remediation and new owner approval before retry |
| `hermes config get approvals.mode` | `off` | `APPROVE A2 HERMES SMART` after APPLY + A1 |
| `hermes config get security.tirith_fail_open` | `true` | same A2 gate |
| Named Tailscale source/target | unresolved | `APPROVE D0 TARGET <device> <node-id>` |

No live Hermes/Tailscale discovery command ran. No tool was copied. No `hermes config set`, chmod, backup, gateway stop, Syncthing, ACL, messaging, or secret rotation occurred.

## A0 fail-closed evidence — 2026-08-19

- `checksums.sha256` mtime: `2026-08-09T13:41:49Z`; 15 of 22 entries mismatch current files, all 22 are regular files and none are symlinks.
- Later-file mtimes explain the mechanical failure but do not establish safe provenance. The manifest itself hashes to `2c242de9a2243621992b46834520529e207daaaff16b2993d449866db44578c8`.
- Apply root: `0700`; log: `0600`; tools directory: `0700` and empty; single log status `INIT audit-checksums FAIL`.
- Independent plan audit found checksum omissions, revision-blind tokening, unresolved target, channel/secret-class contradictions, wrong Buzz quiescence, incomplete gates/rollback, and stale live assumptions.
- Independent tool audit verdict: **REQUIRES FIXES** (5 high, 6 medium). Do not re-checksum current bytes. Required repairs cover discovery Git isolation, conservative secret classes, SQLite/WAL detection, plaintext cleanup, manifest completeness, SharedMemory schema/atomicity, canary CLI, no-follow mode restore, pinned bundle verification, and exact safe-restore/Syncthing-guard invocations.
- Revision-3 remediation is approved and implemented. The next possible action is one clean immutable-bundle verifier run, then the exact new start token `АПPLY HMA-20260809-A1-R3`; A1/A2/A3 remain blocked.

## Never

- Restore `approvals.mode=off`.
- `--yolo`, Funnel, SQLite-over-network.
- Print or search `tskey-api.secret` contents. Rotate only as a separate owner-gated op.
- Probe the decommissioned helsinki node.

## Stage order (copy from apply plan; stop at each confirmation)

1. **A0 read-only drift** — only after the clean R3 verifier and exact `АПPLY HMA-20260809-A1-R3`; use the immutable apply plan's `discover_surface.py --source-dir ... --dest-dir ... --expected-root ...` command. Rollback: none.
2. **A1 backup** — wait for `APPROVE A1 BACKUP`. Encrypted source rollback via `build_secure_state.py` + age. Fail closed if backup fails.
3. **A2 Hermes smart** — wait for `APPROVE A2 HERMES SMART`. Then only:
   - `security.redact_secrets=true`
   - `security.tirith_enabled=true`
   - `security.tirith_fail_open=false`
   - `security.allow_private_urls=true`
   - `approvals.mode=smart`
   - `approvals.destructive_slash_confirm=true`
   - `approvals.mcp_reload_confirm=true`
   - `skills.write_approval=false`
   - `memory.write_approval=false`
   - verify with `hermes config get` + `hermes doctor`
   - A2 rollback: `hermes config set` prior values; **never** restore `off` or Tirith fail-open.
4. **A3 permissions** — wait for `APPROVE A3 PERMISSIONS`. Snapshot modes, chmod owner-only on Hermes/OMP stores listed in the apply plan, then `hermes gateway start` / `resume`. Rollback via `mode_manifest.py --restore` only.

Later D0/D1/F0+ stay blocked until a named Tailscale node and separate approvals.

## Definition of done for this document

Checklist exists, live gates recorded, no Hermes/filesystem mutation performed.
