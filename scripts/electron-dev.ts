/**
 * Cross-platform electron dev script
 * Replaces platform-specific npm scripts with a unified TypeScript solution
 */

import { spawn, type Subprocess } from "bun";
import { PRELOAD_BUNDLE_ALIAS, PRELOAD_BUNDLE_EXTERNALS } from "./electron-preload-bundle";
import { existsSync, rmSync, cpSync, readFileSync, statSync, mkdirSync } from "fs";
import { createServer } from "net";
import { join } from "path";
import * as esbuild from "esbuild";
import { downloadUv, type Platform, type Arch } from "./build/common";
import { detectInstanceNumber, resolveVitePort } from "./electron-dev-helpers";

const ROOT_DIR = join(import.meta.dir, "..");
const ELECTRON_DIR = join(ROOT_DIR, "apps/electron");
const DIST_DIR = join(ELECTRON_DIR, "dist");

// Replace grammY's bundled polyfills (node-fetch@2 + abort-controller@3) with
// native Node globals. esbuild otherwise renames the polyfill's `class
// AbortSignal` to `_AbortSignal` to dodge collision with the global, which
// breaks node-fetch@2's `constructor.name === 'AbortSignal'` check and fails
// every Telegram API call with a TypeError. Kept in sync with
// `apps/electron/package.json` build:main and `scripts/electron-build-main.ts`.
const MAIN_PROCESS_ALIAS: Record<string, string> = {
  "node-fetch": join(ROOT_DIR, "apps/electron/src/main/shims/node-fetch.cjs"),
  "abort-controller": join(ROOT_DIR, "apps/electron/src/main/shims/abort-controller.cjs"),
};

// MCP server paths
const SESSION_SERVER_DIR = join(ROOT_DIR, "packages/session-mcp-server");
const SESSION_SERVER_OUTPUT = join(SESSION_SERVER_DIR, "dist/index.js");
// Pi agent server path (subprocess for Pi SDK sessions)
const PI_AGENT_SERVER_DIR = join(ROOT_DIR, "packages/pi-agent-server");
const PI_AGENT_SERVER_OUTPUT = join(PI_AGENT_SERVER_DIR, "dist/index.js");

// Platform-specific binary paths (bun creates .exe on Windows, no extension on Unix)
const IS_WINDOWS = process.platform === "win32";
const BIN_EXT = IS_WINDOWS ? ".exe" : "";
const VITE_BIN = join(ROOT_DIR, `node_modules/.bin/vite${BIN_EXT}`);
const ELECTRON_BIN = join(ROOT_DIR, `node_modules/.bin/electron${BIN_EXT}`);

function resolveBuildPlatform(): Platform {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  if (process.platform === "linux") return "linux";
  throw new Error(`Unsupported platform for uv bootstrap: ${process.platform}`);
}

function resolveBuildArch(): Arch {
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "x64") return "x64";
  throw new Error(`Unsupported architecture for uv bootstrap: ${process.arch}`);
}

async function ensureBundledUvForCurrentPlatform(): Promise<void> {
  const platform = resolveBuildPlatform();
  const arch = resolveBuildArch();
  const platformKey = `${platform}-${arch}`;
  const uvBinary = platform === "win32" ? "uv.exe" : "uv";
  const uvPath = join(ELECTRON_DIR, "resources", "bin", platformKey, uvBinary);

  if (existsSync(uvPath)) {
    console.log(`✅ Bundled uv present: ${uvPath}`);
    return;
  }

  console.log(`⬇️  Bundled uv missing, bootstrapping ${platformKey}...`);
  await downloadUv({
    platform,
    arch,
    upload: false,
    uploadLatest: false,
    uploadScript: false,
    rootDir: ROOT_DIR,
    electronDir: ELECTRON_DIR,
  });
}

// Multi-instance detection (matches detect-instance.sh logic)
// Detects instance number from folder name suffix (e.g., craft-agents-1 → instance 1)
function detectInstance(): void {
  const vitePort = resolveVitePort(process.env, ROOT_DIR);
  process.env.CRAFT_VITE_PORT = vitePort;
  process.env.ROX_VITE_PORT ??= vitePort;

  // Don't override instance identity if already set (e.g. by detect-instance.sh)
  if (process.env.CRAFT_INSTANCE_NUMBER) return;

  const instanceNum = detectInstanceNumber(ROOT_DIR);
  if (instanceNum) {
    process.env.CRAFT_INSTANCE_NUMBER = instanceNum;
    process.env.CRAFT_APP_NAME = `Rox [${instanceNum}]`;
    process.env.CRAFT_CONFIG_DIR = join(process.env.HOME || "", `.craft-agent-${instanceNum}`);
    process.env.CRAFT_DEEPLINK_SCHEME = `craftagents${instanceNum}`;
    console.log(`🔢 Instance ${instanceNum} detected: port=${vitePort}, config=${process.env.CRAFT_CONFIG_DIR}`);
  }
}

// Load .env file if it exists
function loadEnvFile(): void {
  const envPath = join(ROOT_DIR, ".env");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex).trim();
          let value = trimmed.slice(eqIndex + 1).trim();
          // Remove surrounding quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          process.env[key] = value;
        }
      }
    }
    console.log("📄 Loaded .env file");
  }
}

// Refuse to start if the Vite port is already taken. Never kill the owner.
async function assertPortAvailable(port: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is already in use. Refusing to kill the owner. Set ROX_VITE_PORT or CRAFT_VITE_PORT, or free the port.`,
          ),
        );
        return;
      }
      reject(err);
    });
    server.listen(Number(port), "127.0.0.1", () => {
      server.close((closeErr) => {
        if (closeErr) reject(closeErr);
        else resolve();
      });
    });
  });
}

async function waitForViteReady(port: string, timeoutMs = 60_000): Promise<void> {
  const url = `http://127.0.0.1:${port}/`;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const html = await res.text();
        // Understand Anything (and others) also bind 5173. Only proceed
        // when this is the Craft renderer.
        if (html.includes('<title>Rox</title>')) {
          console.log(`✅ Vite ready at ${url}`);
          return;
        }
        console.log(`⏳ ${url} responded but is not Rox (${html.slice(0, 80).replace(/\s+/g, ' ')})`);
      }
    } catch {
      // not listening yet
    }
    await Bun.sleep(200);
  }
  throw new Error(`Vite did not become ready at ${url}`);
}

// Clean Vite cache directory
function cleanViteCache(): void {
  if (process.env.CRAFT_KEEP_VITE_CACHE === "1") {
    console.log("♻️  Keeping Vite cache (CRAFT_KEEP_VITE_CACHE=1)");
    return;
  }
  const viteCacheDir = join(ELECTRON_DIR, "node_modules/.vite");
  if (existsSync(viteCacheDir)) {
    rmSync(viteCacheDir, { recursive: true, force: true });
    console.log("🧹 Cleaned Vite cache");
  }
}

// Copy resources to dist
function copyResources(): void {
  const srcDir = join(ELECTRON_DIR, "resources");
  const destDir = join(ELECTRON_DIR, "dist/resources");
  if (existsSync(srcDir)) {
    cpSync(srcDir, destDir, { recursive: true, force: true });
    console.log("📦 Copied resources to dist");
  }
}

// Build the WhatsApp worker bundle (dist/worker.cjs). Runs the canonical
// `scripts/build-wa-worker.ts` as a subprocess so the dev path stays in
// sync with the packaged/CI build. Cheap (~70ms) so we always rebuild.
async function buildWaWorker(): Promise<void> {
  console.log("📨 Building WhatsApp worker...");
  const proc = spawn({
    cmd: ["bun", "run", "scripts/build-wa-worker.ts"],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("❌ WhatsApp worker build failed");
    process.exit(1);
  }
}

// Build the Discord worker bundle (dist/worker.cjs). Mirrors buildWaWorker.
async function buildDiscordWorker(): Promise<void> {
  console.log("🎮 Building Discord worker...");
  const proc = spawn({
    cmd: ["bun", "run", "scripts/build-discord-worker.ts"],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("❌ Discord worker build failed");
    process.exit(1);
  }
}

// Build MCP servers for Codex sessions and Pi agent server (one-time, no watch needed)
async function buildMcpServers(): Promise<void> {
  console.log("🌉 Building MCP servers and Pi agent server...");

  // Ensure dist directories exist
  const sessionDistDir = join(SESSION_SERVER_DIR, "dist");
  const piDistDir = join(PI_AGENT_SERVER_DIR, "dist");
  if (!existsSync(sessionDistDir)) mkdirSync(sessionDistDir, { recursive: true });
  if (!existsSync(piDistDir)) mkdirSync(piDistDir, { recursive: true });

  // Build session MCP server (esbuild, packages external — deps resolve from root node_modules)
  const sessionResult = await runEsbuild(
    "packages/session-mcp-server/src/index.ts",
    "packages/session-mcp-server/dist/index.js",
    {},
    { packagesExternal: true }
  );

  if (!sessionResult.success) {
    console.error("❌ Session MCP server build failed:", sessionResult.error);
    process.exit(1);
  }
  console.log("✅ Session MCP server built");

  // Build Pi agent server with bun (not esbuild) because its Pi SDK deps are ESM-only.
  // esbuild with packages:external leaves them as require() calls which fail at runtime.
  // Optional: skip if package directory is missing (e.g., not synced to OSS).
  if (existsSync(join(PI_AGENT_SERVER_DIR, "src"))) {
    const piResult = await buildPiAgentServer();
    if (!piResult.success) {
      console.error("❌ Pi agent server build failed:", piResult.error);
      process.exit(1);
    }
    console.log("✅ Pi agent server built");
  } else {
    console.log("⏭️  Pi agent server skipped (package not found)");
  }
}

// Get OAuth defines for esbuild API
function getOAuthDefines(): Record<string, string> {
  const oauthVars = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "SLACK_OAUTH_CLIENT_ID",
    "SLACK_OAUTH_CLIENT_SECRET",
    "MICROSOFT_OAUTH_CLIENT_ID",
    "MICROSOFT_OAUTH_CLIENT_SECRET",
  ];

  const defines: Record<string, string> = {};
  for (const varName of oauthVars) {
    const value = process.env[varName] || "";
    defines[`process.env.${varName}`] = JSON.stringify(value);
  }
  return defines;
}

// Get environment variables for electron process
function getElectronEnv(): Record<string, string> {
  const vitePort = process.env.CRAFT_VITE_PORT || "5173";

  // Codex binary path is resolved at runtime by the binary-resolver module.
  // It checks: CODEX_PATH env var > bundled binary > local dev fork > system PATH.
  // You can override with CODEX_PATH env var if needed for debugging.

  return {
    ...process.env as Record<string, string>,
    VITE_DEV_SERVER_URL: `http://127.0.0.1:${vitePort}`,
    CRAFT_CONFIG_DIR: process.env.CRAFT_CONFIG_DIR || "",
    ROX_CONFIG_DIR: process.env.ROX_CONFIG_DIR || process.env.CRAFT_CONFIG_DIR || "",
    CRAFT_USER_DATA_DIR: process.env.CRAFT_USER_DATA_DIR || process.env.ROX_USER_DATA_DIR || "",
    ROX_USER_DATA_DIR: process.env.ROX_USER_DATA_DIR || process.env.CRAFT_USER_DATA_DIR || "",
    CRAFT_APP_NAME: process.env.CRAFT_APP_NAME || process.env.ROX_APP_NAME || "Rox",
    ROX_APP_NAME: process.env.ROX_APP_NAME || process.env.CRAFT_APP_NAME || "Rox",
    CRAFT_DEEPLINK_SCHEME: process.env.CRAFT_DEEPLINK_SCHEME || process.env.ROX_DEEPLINK_SCHEME || "rox",
    ROX_DEEPLINK_SCHEME: process.env.ROX_DEEPLINK_SCHEME || process.env.CRAFT_DEEPLINK_SCHEME || "rox",
    CRAFT_INSTANCE_NUMBER: process.env.CRAFT_INSTANCE_NUMBER || "",
  };
}

// Externals for the main-process bundle.
// - `electron`: the runtime, not bundleable.
// - `@anthropic-ai/claude-agent-sdk`: SDK 0.3.x is pure ESM and calls
//   `createRequire(import.meta.url)` at module-init; esbuild's CJS bundling
//   leaves the synthesized `import_meta.url` undefined and the bundled
//   main.cjs throws ERR_INVALID_ARG_VALUE on load. Externalize so Node loads
//   the SDK natively as ESM. Electron 39 = Node 22.x supports `require()` of
//   TLA-free ESM, so the runtime `require('@anthropic-ai/claude-agent-sdk')`
//   resolves correctly. Mirror of the same flag in `scripts/electron-build-main.ts`
//   and `apps/electron/package.json` build:main.
const MAIN_BUNDLE_EXTERNALS = [
  "electron",
  "@anthropic-ai/claude-agent-sdk",
  "onnxruntime-node",
  "@xenova/transformers",
  "sharp",
  "bun:*",
];

// Run a one-shot esbuild using the JavaScript API
async function runEsbuild(
  entryPoint: string,
  outfile: string,
  defines: Record<string, string> = {},
  options: {
    packagesExternal?: boolean;
    alias?: Record<string, string>;
    external?: readonly string[];
  } = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    await esbuild.build({
      entryPoints: [join(ROOT_DIR, entryPoint)],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: join(ROOT_DIR, outfile),
      external: [...(options.external ?? MAIN_BUNDLE_EXTERNALS)],
      ...(options.packagesExternal ? { packages: "external" as const } : {}),
      ...(options.alias ? { alias: options.alias } : {}),
      define: defines,
      logLevel: "warning",
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Build Pi agent server using bun instead of esbuild.
// The Pi SDK (@earendil-works/pi-coding-agent) is ESM-only, and esbuild with
// packages:external leaves ESM imports as require() calls that fail at runtime.
// Bun's bundler handles ESM→ESM bundling correctly.
async function buildPiAgentServer(): Promise<{ success: boolean; error?: string }> {
  try {
    const proc = spawn({
      cmd: ["bun", "build", "src/index.ts", "--outdir=dist", "--target=bun", "--format=esm"],
      cwd: PI_AGENT_SERVER_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return { success: false, error: stderr };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Verify a built JavaScript bundle is parseable. `node --check` performs
// syntax-only validation — it does NOT execute module-level code or resolve
// `require()`, so Electron-specific top-level requires (e.g. @sentry/electron)
// are safe. This catches truncated writes, FS corruption, and edge cases that
// esbuild's build-success signal doesn't cover.
async function verifyJsFile(filePath: string): Promise<{ valid: boolean; error?: string }> {
  if (!existsSync(filePath)) {
    return { valid: false, error: "File does not exist" };
  }

  const stats = statSync(filePath);
  if (stats.size === 0) {
    return { valid: false, error: "File is empty" };
  }

  try {
    const proc = spawn({
      cmd: ["node", "--check", filePath],
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return { valid: false, error: stderr.trim() || `node --check exited ${exitCode}` };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}

// Wait for file to stabilize (no size changes)
async function waitForFileStable(filePath: string, timeoutMs = 10000): Promise<boolean> {
  const startTime = Date.now();
  let lastSize = -1;
  let stableCount = 0;

  while (Date.now() - startTime < timeoutMs) {
    if (!existsSync(filePath)) {
      await Bun.sleep(100);
      continue;
    }

    const stats = statSync(filePath);
    if (stats.size === lastSize) {
      stableCount++;
      // File size unchanged for 3 checks (300ms) - consider it stable
      if (stableCount >= 3) {
        return true;
      }
    } else {
      stableCount = 0;
      lastSize = stats.size;
    }

    await Bun.sleep(100);
  }

  return false;
}

async function main(): Promise<void> {
  console.log("🚀 Starting Electron dev environment...\n");

  // Setup: load .env first so ROX_VITE_PORT / CRAFT_VITE_PORT win over the
  // numbered-worktree fallback.
  loadEnvFile();
  detectInstance();
  cleanViteCache();

  // Ensure dist directory exists
  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  await ensureBundledUvForCurrentPlatform();

  copyResources();

  // Build MCP servers for Codex sessions
  await buildMcpServers();

  // Build WhatsApp worker bundle so the adapter can spawn it on demand
  await buildWaWorker();

  // Build Discord worker bundle so the adapter can spawn it on demand
  await buildDiscordWorker();

  const vitePort = process.env.CRAFT_VITE_PORT || "5173";
  const oauthDefines = getOAuthDefines();

  // =========================================================
  // PHASE 1: Initial build (one-shot, wait for completion)
  // =========================================================
  console.log("🔨 Building main process...");

  const mainCjsPath = join(DIST_DIR, "main.cjs");
  const preloadCjsPath = join(DIST_DIR, "bootstrap-preload.cjs");
  const toolbarPreloadCjsPath = join(DIST_DIR, "browser-toolbar-preload.cjs");
  const overlayPreloadCjsPath = join(DIST_DIR, "voice-overlay-preload.cjs");

  // Remove old build files to ensure fresh build
  if (existsSync(mainCjsPath)) rmSync(mainCjsPath);
  if (existsSync(preloadCjsPath)) rmSync(preloadCjsPath);
  if (existsSync(toolbarPreloadCjsPath)) rmSync(toolbarPreloadCjsPath);
  if (existsSync(overlayPreloadCjsPath)) rmSync(overlayPreloadCjsPath);

  // Build main and preload entries in parallel
  const [mainResult, preloadResult, toolbarPreloadResult, overlayPreloadResult] = await Promise.all([
    runEsbuild(
      "apps/electron/src/main/index.ts",
      "apps/electron/dist/main.cjs",
      oauthDefines,
      { alias: MAIN_PROCESS_ALIAS }
    ),
    runEsbuild(
      "apps/electron/src/preload/bootstrap.ts",
      "apps/electron/dist/bootstrap-preload.cjs",
      {},
      { external: PRELOAD_BUNDLE_EXTERNALS, alias: PRELOAD_BUNDLE_ALIAS }
    ),
    runEsbuild(
      "apps/electron/src/preload/browser-toolbar.ts",
      "apps/electron/dist/browser-toolbar-preload.cjs",
      {},
      { external: PRELOAD_BUNDLE_EXTERNALS, alias: PRELOAD_BUNDLE_ALIAS }
    ),
    runEsbuild(
      "apps/electron/src/preload/voice-overlay.ts",
      "apps/electron/dist/voice-overlay-preload.cjs",
      {},
      { external: PRELOAD_BUNDLE_EXTERNALS, alias: PRELOAD_BUNDLE_ALIAS }
    ),
  ]);

  if (!mainResult.success) {
    console.error("❌ Main process build failed:", mainResult.error);
    process.exit(1);
  }

  if (!preloadResult.success) {
    console.error("❌ Preload build failed:", preloadResult.error);
    process.exit(1);
  }

  if (!toolbarPreloadResult.success) {
    console.error("❌ Browser toolbar preload build failed:", toolbarPreloadResult.error);
    process.exit(1);
  }

  if (!overlayPreloadResult.success) {
    console.error("❌ Voice overlay preload build failed:", overlayPreloadResult.error);
    process.exit(1);
  }

  // Wait for files to stabilize (filesystem flush)
  console.log("⏳ Waiting for build files to stabilize...");
  const [mainStable, preloadStable, toolbarPreloadStable, overlayPreloadStable] = await Promise.all([
    waitForFileStable(mainCjsPath),
    waitForFileStable(preloadCjsPath),
    waitForFileStable(toolbarPreloadCjsPath),
    waitForFileStable(overlayPreloadCjsPath),
  ]);

  if (!mainStable || !preloadStable || !toolbarPreloadStable || !overlayPreloadStable) {
    console.error("❌ Build files did not stabilize");
    process.exit(1);
  }

  // Verify the built files are valid JavaScript
  console.log("🔍 Verifying build output...");
  const [mainValid, preloadValid, toolbarPreloadValid, overlayPreloadValid] = await Promise.all([
    verifyJsFile(mainCjsPath),
    verifyJsFile(preloadCjsPath),
    verifyJsFile(toolbarPreloadCjsPath),
    verifyJsFile(overlayPreloadCjsPath),
  ]);

  if (!mainValid.valid) {
    console.error("❌ main.cjs is invalid:", mainValid.error);
    process.exit(1);
  }

  if (!preloadValid.valid) {
    console.error("❌ bootstrap-preload.cjs is invalid:", preloadValid.error);
    process.exit(1);
  }

  if (!toolbarPreloadValid.valid) {
    console.error("❌ browser-toolbar-preload.cjs is invalid:", toolbarPreloadValid.error);
    process.exit(1);
  }

  if (!overlayPreloadValid.valid) {
    console.error("❌ voice-overlay-preload.cjs is invalid:", overlayPreloadValid.error);
    process.exit(1);
  }

  console.log("✅ Initial build complete and verified\n");

  // =========================================================
  // PHASE 2: Start dev servers with watch mode
  // =========================================================
  console.log("📡 Starting dev servers...\n");

  const processes: Subprocess[] = [];
  const esbuildContexts: esbuild.BuildContext[] = [];

  // 1. Vite dev server (strictPort ensures we don't silently switch ports)
  await assertPortAvailable(vitePort);
  const viteProc = spawn({
    cmd: [VITE_BIN, "dev", "--config", "apps/electron/vite.config.ts", "--port", vitePort, "--strictPort"],
    cwd: ROOT_DIR,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env as Record<string, string>,
  });
  processes.push(viteProc);

  // 2. Main process watcher (using esbuild watch API)
  const mainContext = await esbuild.context({
    entryPoints: [join(ROOT_DIR, "apps/electron/src/main/index.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(ROOT_DIR, "apps/electron/dist/main.cjs"),
    external: MAIN_BUNDLE_EXTERNALS,
    alias: MAIN_PROCESS_ALIAS,
    define: oauthDefines,
    logLevel: "info",
  });
  await mainContext.watch();
  esbuildContexts.push(mainContext);
  console.log("👀 Watching main process...");

  // 2b. Extension Host craft-sandbox worker watcher
  const extensionHostWorkerContext = await esbuild.context({
    entryPoints: [join(ROOT_DIR, "apps/electron/src/main/extension-host/worker.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(ROOT_DIR, "apps/electron/dist/extension-host-worker.cjs"),
    external: ["electron"],
    logLevel: "info",
  });
  await extensionHostWorkerContext.watch();
  esbuildContexts.push(extensionHostWorkerContext);
  console.log("👀 Watching extension-host worker...");

  // 3. Preload watcher (using esbuild watch API)
  const preloadContext = await esbuild.context({
    entryPoints: [join(ROOT_DIR, "apps/electron/src/preload/bootstrap.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(ROOT_DIR, "apps/electron/dist/bootstrap-preload.cjs"),
    external: [...PRELOAD_BUNDLE_EXTERNALS],
    alias: PRELOAD_BUNDLE_ALIAS,
    logLevel: "info",
  });
  await preloadContext.watch();
  esbuildContexts.push(preloadContext);
  console.log("👀 Watching preload...");

  // 4. Browser toolbar preload watcher (dedicated browser window bridge)
  const toolbarPreloadContext = await esbuild.context({
    entryPoints: [join(ROOT_DIR, "apps/electron/src/preload/browser-toolbar.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(ROOT_DIR, "apps/electron/dist/browser-toolbar-preload.cjs"),
    external: [...PRELOAD_BUNDLE_EXTERNALS],
    alias: PRELOAD_BUNDLE_ALIAS,
    logLevel: "info",
  });
  await toolbarPreloadContext.watch();
  esbuildContexts.push(toolbarPreloadContext);
  console.log("👀 Watching browser toolbar preload...");

  const overlayPreloadContext = await esbuild.context({
    entryPoints: [join(ROOT_DIR, "apps/electron/src/preload/voice-overlay.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(ROOT_DIR, "apps/electron/dist/voice-overlay-preload.cjs"),
    external: [...PRELOAD_BUNDLE_EXTERNALS],
    alias: PRELOAD_BUNDLE_ALIAS,
    logLevel: "info",
  });
  await overlayPreloadContext.watch();
  esbuildContexts.push(overlayPreloadContext);
  console.log("👀 Watching voice overlay preload...");

  // 5. Start Electron only after Vite answers, otherwise restore retries
  // hit ERR_CONNECTION_REFUSED and fall back to a missing file:// renderer.
  await Promise.race([
    waitForViteReady(vitePort),
    viteProc.exited.then((code) => {
      throw new Error(`Vite exited before ready (code ${code}) at http://127.0.0.1:${vitePort}/`);
    }),
  ]);

  // Watch mode kicks an immediate rebuild that can still be writing the ~50MB
  // main.cjs when Vite becomes ready. Re-stabilize + syntax-check before spawn
  // so Electron never loads a truncated bundle (SyntaxError: Unexpected end of input).
  console.log("⏳ Waiting for watch rebuild to stabilize before Electron...");
  const [watchMainStable, watchPreloadStable, watchToolbarStable, watchOverlayStable] = await Promise.all([
    waitForFileStable(mainCjsPath),
    waitForFileStable(preloadCjsPath),
    waitForFileStable(toolbarPreloadCjsPath),
    waitForFileStable(overlayPreloadCjsPath),
  ]);
  if (!watchMainStable || !watchPreloadStable || !watchToolbarStable || !watchOverlayStable) {
    console.error("❌ Watch rebuild files did not stabilize");
    process.exit(1);
  }
  const [watchMainValid, watchPreloadValid, watchToolbarValid, watchOverlayValid] = await Promise.all([
    verifyJsFile(mainCjsPath),
    verifyJsFile(preloadCjsPath),
    verifyJsFile(toolbarPreloadCjsPath),
    verifyJsFile(overlayPreloadCjsPath),
  ]);
  if (!watchMainValid.valid) {
    console.error("❌ main.cjs invalid after watch rebuild:", watchMainValid.error);
    process.exit(1);
  }
  if (!watchPreloadValid.valid) {
    console.error("❌ bootstrap-preload.cjs invalid after watch rebuild:", watchPreloadValid.error);
    process.exit(1);
  }
  if (!watchToolbarValid.valid) {
    console.error("❌ browser-toolbar-preload.cjs invalid after watch rebuild:", watchToolbarValid.error);
    process.exit(1);
  }
  if (!watchOverlayValid.valid) {
    console.error("❌ voice-overlay-preload.cjs invalid after watch rebuild:", watchOverlayValid.error);
    process.exit(1);
  }

  console.log("🚀 Starting Electron...\n");

  const debugPort = process.env.CRAFT_REMOTE_DEBUGGING_PORT?.trim() ?? "";
  if (debugPort && !/^\d{2,5}$/.test(debugPort)) {
    console.error(
      `CRAFT_REMOTE_DEBUGGING_PORT must be a 2-5 digit port, got ${JSON.stringify(debugPort)}`,
    );
    process.exit(1);
  }
  const userDataDir = process.env.CRAFT_USER_DATA_DIR?.trim() ?? "";
  const electronArgs = [
    ...(debugPort ? [`--remote-debugging-port=${debugPort}`] : []),
    ...(userDataDir ? [`--user-data-dir=${userDataDir}`] : []),
    "apps/electron",
  ];

  const electronProc = spawn({
    cmd: [ELECTRON_BIN, ...electronArgs],
    cwd: ROOT_DIR,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    env: getElectronEnv(),
  });
  processes.push(electronProc);

  // Handle cleanup on exit
  const cleanup = async () => {
    console.log("\n🛑 Shutting down...");
    // Dispose esbuild contexts
    for (const ctx of esbuildContexts) {
      try {
        await ctx.dispose();
      } catch {
        // Context may already be disposed
      }
    }
    // Kill subprocesses
    for (const proc of processes) {
      try {
        proc.kill();
      } catch {
        // Process may already be dead
      }
    }
    process.exit(0);
  };

  process.on("SIGINT", () => cleanup());
  process.on("SIGTERM", () => cleanup());

  // Windows doesn't have SIGINT/SIGTERM in the same way
  if (process.platform === "win32") {
    process.on("SIGHUP", () => cleanup());
  }

  // Wait for electron to exit (main process)
  await electronProc.exited;
  await cleanup();
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
