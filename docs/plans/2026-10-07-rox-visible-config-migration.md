# Visible config dir `~/rox`

**Policy:** Prefer `~/rox` when the directory exists; otherwise `~/.rox` with one-time import from `.craft-agent`.

Implemented in `packages/shared/src/config/env.ts` (`resolveConfigDir`).

Migration path for existing users:

1. Copy `~/.rox` → `~/rox` when user opts in (future CLI `rox migrate-config`).
2. Set `ROX_CONFIG_DIR=~/rox` for forced override.

Do not delete `~/.rox` automatically.
