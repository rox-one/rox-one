# ROX headless server in Cursor Cloud Agents

The previously unmerged `cursor/cloud-agent-env-setup-2fc0` branch introduced a
useful headless development environment. This version adapts it to the current
ROX server and dependency lockfile.

Cursor reads `.cursor/environment.json` for its hosted Cloud Agent environments:
`install` prepares dependencies and helper artifacts, then `terminals` starts the
server for a run. See the [official setup documentation](https://cursor.com/docs/cloud-agent/setup).
These files do not configure Cursor Self-Hosted Machines.

Run the preparation manually with `bash .cursor/install.sh`. It uses Bun 1.3.14,
matching `.github/workflows/validate-server.yml`, and installs that version into
`~/rox-cloud/bun` when necessary. `ROX_CLOUD_BUN_INSTALL` overrides that directory.
It preserves `bun.lock` with a frozen install and skips the Electron binary.
A failed dependency install stops before starting any server.

Run `bash .cursor/start-server.sh` to start the RPC server on
`ws://127.0.0.1:9100`. Development state defaults to `~/rox-cloud/context`; an
explicit `ROX_CONFIG_DIR` is respected and also sets the compatibility variable
`CRAFT_CONFIG_DIR`. The server's compatibility environment names are retained.
Each startup generates a new bearer token, saved in `cursor-dev-token` inside the
context directory with owner-only permissions. The value is not printed in the
terminal. A client must reload the file after a restart:

```bash
bun run apps/cli/src/index.ts \
  --url ws://127.0.0.1:9100 \
  --token "$(cat "${ROX_CONFIG_DIR:-$HOME/rox-cloud/context}/cursor-dev-token")" ping
```

This environment supplies the headless server and RPC helper builds. Provider
credentials, external MCP sources and complete OMP/runtime provisioning still
follow the normal ROX setup; starting the server does not prove those services
are authenticated or that a desktop release is packaged.

Local validation on 2026-10-03: JSON/shell syntax checks passed; the real pinned
Bun 1.3.14 frozen installation and both helper builds passed twice. The startup
script completed authenticated CLI `ping`, graceful stop and restart; token mode
was 0600, the token was absent from terminal output, and restart rotated it.
Injected failed dependency installation and failed random generation stopped
before building or writing a token/starting the server respectively. Execution
inside a hosted Cursor environment has not been verified.
