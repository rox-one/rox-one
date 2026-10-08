# Visible config dir `~/rox`

> Superseded by W1-13 (#1510): `storage.visible-root.v1` (PRD D-v2-12, default
> OFF). With the flag OFF the opt-in policy below still applies; with the flag
> ON, `resolveConfigDir()` always returns `~/rox` and `migrateHiddenRoxHome()`
> moves `~/.rox` → `~/rox` (never deletes, `~/.rox` left as a symlink).
> Manual path in both modes: `rox migrate-config [--dry-run|--revert|--auto]`.

**Policy:** Prefer `~/rox` when the directory exists; otherwise `~/.rox` with one-time import from `.craft-agent`.

Implemented in `packages/shared/src/config/env.ts` (`resolveConfigDir`).

Migration path for existing users:

1. Move `~/.rox` → `~/rox` via `rox migrate-config` (W1-13; `~/.rox` left as a symlink, never deleted).
2. Set `ROX_CONFIG_DIR=~/rox` for forced override.

Do not delete `~/.rox` automatically.
