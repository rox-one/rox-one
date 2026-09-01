/**
 * Worktree-safe Vite launcher for the renderer playground.
 *
 * It deliberately does not kill a process on the selected port. `--strictPort`
 * makes a collision visible instead of terminating another worktree's server.
 */

import { spawn } from "bun";
import { join } from "path";
import {
  PLAYGROUND_VITE_STDIN,
  resolvePlaygroundHost,
  resolveVitePort,
  shouldOpenPlayground,
} from "./electron-dev-helpers";

const ROOT_DIR = join(import.meta.dir, "..");
const BIN_EXT = process.platform === "win32" ? ".exe" : "";
const VITE_BIN = join(ROOT_DIR, `node_modules/.bin/vite${BIN_EXT}`);
const args = process.argv.slice(2);
const vitePort = resolveVitePort(process.env, ROOT_DIR);
const host = resolvePlaygroundHost(args);
const shouldOpen = shouldOpenPlayground(args);

console.log(`🧪 Starting playground on http://${host}:${vitePort}/playground.html`);

const viteProc = spawn({
  cmd: [
    VITE_BIN,
    "dev",
    "--config", "apps/electron/vite.config.ts",
    "--host", host,
    "--port", vitePort,
    "--strictPort",
    ...(shouldOpen ? ["--open", "/playground.html"] : []),
  ],
  cwd: ROOT_DIR,
  stdin: PLAYGROUND_VITE_STDIN,
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    CRAFT_VITE_PORT: vitePort,
  } as Record<string, string>,
});

process.exit(await viteProc.exited);
