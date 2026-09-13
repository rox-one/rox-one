# 07 — Identity expand: env and config-dir resolver

**What to build:** `ROX_*` names work beside `CRAFT_*`. Existing `~/.craft-agent` installs keep working. User-facing docs start saying `ROX_*` only where the resolver already reads both.

**Blocked by:** 04 (defaults live in the same config module — coordinate, do not parallel-edit blindly)

**Status:** ready-for-agent

- [ ] `getEnv('SERVER_TOKEN')` returns `ROX_SERVER_TOKEN` if set, else `CRAFT_SERVER_TOKEN`
- [ ] Config dir accepts `ROX_CONFIG_DIR` then `CRAFT_CONFIG_DIR` then `~/.craft-agent`
- [ ] Using a `CRAFT_*` name logs one deprecation warning per process
- [ ] No move of the directory yet unless the symlink fallback is implemented and tested on Linux
