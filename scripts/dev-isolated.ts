/**
 * Isolated Electron dev launcher.
 *
 * Why isolation: a second dev instance that shares the default config dir dies
 * on the Electron single-instance lock, and we must not write into the real
 * user profile (`~/.craft-agent`, `~/rox`). This wrapper points every
 * config/user-data/temp path at `<repo>/.dev-isolated/` (gitignored) and then
 * runs the normal `electron:dev` script.
 *
 * `--print` only prints the resolved plan as JSON and exits — no launch.
 * `--cdp[=PORT]` opens the DevTools protocol port (default 9227) so smoke
 * automation (scripts/cdp driver) can drive the isolated instance.
 */

import { spawn } from "bun";
import { mkdirSync } from "fs";
import { join } from "path";

const ROOT_DIR = join(import.meta.dir, "..");

const ISOLATED_DIR = join(ROOT_DIR, ".dev-isolated");
const configDir = join(ISOLATED_DIR, "config");
const userDataDir = join(ISOLATED_DIR, "userdata");
const tmpDir = join(ISOLATED_DIR, "tmp");

// ROX_* wins over CRAFT_* in resolveConfigDir(); set both so either reader agrees.
const overrides: Record<string, string> = {
  ROX_CONFIG_DIR: configDir,
  CRAFT_CONFIG_DIR: configDir,
  CRAFT_USER_DATA_DIR: userDataDir,
  TMPDIR: tmpDir,
};

// `--cdp` / `--cdp=9227`: explicit flag wins over the ambient env var, so a
// stale shell export cannot silently move the port the smoke driver dials.
const cdpArg = process.argv.find((arg) => arg === "--cdp" || arg.startsWith("--cdp="));
if (cdpArg) {
  const port = cdpArg.includes("=") ? cdpArg.split("=", 2)[1] : "9227";
  if (!/^\d{2,5}$/.test(port)) {
    console.error(`dev-isolated: --cdp expects a 2-5 digit port, got '${port}'`);
    process.exit(2);
  }
  overrides.CRAFT_REMOTE_DEBUGGING_PORT = port;
}

for (const dir of [configDir, userDataDir, tmpDir]) {
  mkdirSync(dir, { recursive: true });
}

// `electron:dev` lives in the root package.json; bun does not resolve scripts
// from parent package.json files, so the child must run from the repo root.
const cwd = ROOT_DIR;
const cmd = ["bun", "run", "electron:dev"];

if (process.argv.includes("--print")) {
  console.log(JSON.stringify({ configDir, userDataDir, tmpDir, cwd, cmd, cdpPort: overrides.CRAFT_REMOTE_DEBUGGING_PORT ?? null }, null, 2));
  process.exit(0);
}

const proc = spawn({
  cmd,
  cwd,
  env: { ...process.env, ...overrides },
  stdio: ["inherit", "inherit", "inherit"],
});

process.exit(await proc.exited);
