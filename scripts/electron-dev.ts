/**
 * Cross-platform electron dev script
 * Replaces platform-specific npm scripts with a unified TypeScript solution
 */

import { spawn, type Subprocess } from "bun";
import {
  existsSync,
  rmSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import * as esbuild from "esbuild";
import { downloadUv, type Platform, type Arch } from "./build/common";
import {
  copyElectronResourceTree,
  UNSTAGED_LEGACY_MCP_SERVERS,
} from "./build/staged-servers";
import {
  createSuccessfulRebuildGuard,
  detectInstanceNumber,
  parseElectronDevOptions,
  removeInvalidRuntimeArtifactOutput,
  resolveVitePort,
  shouldBuildRuntimeArtifact,
  shouldStageElectronResources,
} from "./electron-dev-helpers";

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

// Pi agent server path (subprocess for Pi SDK sessions)
const PI_AGENT_SERVER_DIR = join(ROOT_DIR, "packages/pi-agent-server");
const PI_AGENT_SERVER_OUTPUT = join(PI_AGENT_SERVER_DIR, "dist/index.js");
const PI_AGENT_SERVER_SOURCE = join(PI_AGENT_SERVER_DIR, "src");
const SHARED_SOURCE = join(ROOT_DIR, "packages/shared/src");
const WA_WORKER_DIR = join(ROOT_DIR, "packages/messaging-whatsapp-worker");
const WA_WORKER_SOURCE = join(WA_WORKER_DIR, "src");
const WA_WORKER_OUTPUT = join(WA_WORKER_DIR, "dist/worker.cjs");
const DISCORD_WORKER_DIR = join(ROOT_DIR, "packages/messaging-discord-worker");
const DISCORD_WORKER_SOURCE = join(DISCORD_WORKER_DIR, "src");
const DISCORD_WORKER_OUTPUT = join(DISCORD_WORKER_DIR, "dist/worker.cjs");

// Platform-specific binary paths (bun creates .exe on Windows, no extension on Unix)
const IS_WINDOWS = process.platform === "win32";
const BIN_EXT = IS_WINDOWS ? ".exe" : "";
const VITE_BIN = join(ROOT_DIR, `node_modules/.bin/vite${BIN_EXT}`);
const ELECTRON_BIN = join(ROOT_DIR, `node_modules/.bin/electron${BIN_EXT}`);
const ELECTRON_RESTART_DEBOUNCE_MS = 150;

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
  // Explicit ports always win. ROX_VITE_PORT is the current name; retain the
  // Craft and generic Vite names for existing worktree launchers.
  if (process.env.ROX_VITE_PORT || process.env.CRAFT_VITE_PORT || process.env.VITE_PORT) {
    process.env.CRAFT_VITE_PORT = resolveVitePort(process.env, ROOT_DIR);
    return;
  }

  const instanceNum = detectInstanceNumber(ROOT_DIR);
  if (instanceNum) {
    process.env.CRAFT_INSTANCE_NUMBER = instanceNum;
    process.env.CRAFT_VITE_PORT = `${instanceNum}173`;
    process.env.CRAFT_APP_NAME = `Craft Agents [${instanceNum}]`;
    process.env.CRAFT_CONFIG_DIR = join(process.env.HOME || "", `.craft-agent-${instanceNum}`);
    process.env.CRAFT_DEEPLINK_SCHEME = `craftagents${instanceNum}`;
    console.log(`🔢 Instance ${instanceNum} detected: port=${process.env.CRAFT_VITE_PORT}, config=${process.env.CRAFT_CONFIG_DIR}`);
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
          // Inherited environment is the explicit operator choice. Keep it
          // ahead of repository-local defaults so Vite and Electron agree.
          if (process.env[key] === undefined) process.env[key] = value;
        }
      }
    }
    console.log("📄 Loaded .env file");
  }
}

// Kill any process using the specified port
async function killProcessOnPort(port: string): Promise<void> {
  const isWindows = process.platform === "win32";

  try {
    if (isWindows) {
      // Windows: use netstat to find PID, then taskkill
      const netstat = spawn({
        cmd: ["cmd", "/c", `netstat -ano | findstr :${port}`],
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(netstat.stdout).text();
      await netstat.exited;

      // Parse PIDs from netstat output (last column)
      const pids = new Set<string>();
      for (const line of output.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== "0") {
            pids.add(pid);
          }
        }
      }

      // Kill each PID
      for (const pid of pids) {
        const kill = spawn({
          cmd: ["taskkill", "/PID", pid, "/F"],
          stdout: "pipe",
          stderr: "pipe",
        });
        await kill.exited;
      }

      if (pids.size > 0) {
        console.log(`🔪 Killed ${pids.size} process(es) on port ${port}`);
      }
    } else {
      // Mac/Linux: use lsof and kill
      const lsof = spawn({
        cmd: ["sh", "-c", `lsof -ti:${port} | xargs kill -9 2>/dev/null || true`],
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(lsof.stdout).text();
      await lsof.exited;

      if (output.trim()) {
        console.log(`🔪 Killed process(es) on port ${port}`);
      }
    }
  } catch {
    // Ignore errors - port may not be in use
  }
}

// Clean Vite cache directory
function cleanViteCache(): void {
  const viteCacheDir = join(ELECTRON_DIR, "node_modules/.vite");
  if (existsSync(viteCacheDir)) {
    rmSync(viteCacheDir, { recursive: true, force: true });
    console.log("🧹 Cleaned Vite cache");
  }
}

const RESOURCE_STAGE_STAMP_FILENAME = ".craft-resource-stage.json";

interface ResourceStageStamp {
  sourceLatestMtimeMs: number;
}

function getLatestMtimeMs(path: string, ignoredEntries = new Set<string>()): number {
  let latestMtimeMs = statSync(path).mtimeMs;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (ignoredEntries.has(entry.name)) continue;
    const entryPath = join(path, entry.name);
    const entryMtimeMs = entry.isDirectory()
      ? getLatestMtimeMs(entryPath)
      : statSync(entryPath).mtimeMs;
    latestMtimeMs = Math.max(latestMtimeMs, entryMtimeMs);
  }
  return latestMtimeMs;
}

function readResourceStageStamp(stampPath: string): ResourceStageStamp | undefined {
  try {
    const parsed = JSON.parse(readFileSync(stampPath, "utf-8")) as Partial<ResourceStageStamp>;
    return Number.isFinite(parsed.sourceLatestMtimeMs)
      ? { sourceLatestMtimeMs: parsed.sourceLatestMtimeMs! }
      : undefined;
  } catch {
    return undefined;
  }
}

// Copy resources to dist without bypassing copyElectronResourceTree's policy.
// `--clean` and `--full-runtime` force a restage for resource deletions or
// filesystem timestamp edge cases that cannot be proven from the prior stamp.
function copyResources(force = false): void {
  const srcDir = join(ELECTRON_DIR, "resources");
  const destDir = join(ELECTRON_DIR, "dist/resources");
  if (!existsSync(srcDir)) return;

  const stampPath = join(destDir, RESOURCE_STAGE_STAMP_FILENAME);
  const sourceLatestMtimeMs = getLatestMtimeMs(
    srcDir,
    new Set(UNSTAGED_LEGACY_MCP_SERVERS),
  );
  const stamp = readResourceStageStamp(stampPath);
  const shouldStage = shouldStageElectronResources({
    force,
    sourceExists: true,
    outputExists: existsSync(destDir),
    sourceLatestMtimeMs,
    stagedSourceLatestMtimeMs: stamp?.sourceLatestMtimeMs,
  });

  if (!shouldStage) {
    console.log("📦 Reusing staged resources (use --clean or --full-runtime after deletions)");
    return;
  }

  // cpSync updates/adds files but does not mirror removals. This directory is
  // generated output, so clear it only after the stage decision and then reuse
  // the canonical copier (including its MCP-server exclusions).
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
  copyElectronResourceTree(srcDir, destDir);
  writeFileSync(stampPath, `${JSON.stringify({ sourceLatestMtimeMs })}\n`);
  console.log("📦 Copied resources to dist (skipped unread session/bridge MCP servers)");
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

// Build Pi agent server (one-time, no watch needed). session-mcp-server is
// unread by registered backends and is not built in the Electron dev path.
async function buildMcpServers(): Promise<void> {
  console.log("🥧 Building Pi agent server...");

  const piDistDir = join(PI_AGENT_SERVER_DIR, "dist");
  if (!existsSync(piDistDir)) mkdirSync(piDistDir, { recursive: true });

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

interface RuntimeArtifact {
  label: string;
  inputPaths: string[];
  outputPath: string;
  build: () => Promise<void>;
}

function getLatestInputMtimeMs(inputPaths: readonly string[]): number {
  return Math.max(...inputPaths.map((inputPath) => {
    const stats = statSync(inputPath);
    return stats.isDirectory() ? getLatestMtimeMs(inputPath) : stats.mtimeMs;
  }));
}

async function ensureRuntimeArtifact(artifact: RuntimeArtifact, force: boolean): Promise<void> {
  const sourceExists = artifact.inputPaths.every(existsSync);
  if (!sourceExists) {
    console.log(`⏭️  ${artifact.label} skipped (source not present)`);
    return;
  }

  const outputPathExists = existsSync(artifact.outputPath);
  const outputStats = outputPathExists ? statSync(artifact.outputPath) : undefined;
  const outputExists = outputStats?.isFile() ?? false;
  const outputVerification = outputExists ? await verifyJsFile(artifact.outputPath) : undefined;
  const sourceLatestMtimeMs = getLatestInputMtimeMs(artifact.inputPaths);
  const outputMtimeMs = outputStats?.mtimeMs;
  const shouldBuild = shouldBuildRuntimeArtifact({
    force,
    sourceExists,
    outputExists,
    outputIsUsable: outputVerification?.valid ?? false,
    sourceLatestMtimeMs,
    outputMtimeMs,
  });

  if (!shouldBuild) {
    console.log(`📦 Reusing ${artifact.label}: ${artifact.outputPath}`);
    return;
  }

  // Builders cannot replace a directory with their expected output file, and
  // must not reuse a corrupt bundle. Remove only this generated artifact,
  // never its containing dist directory or sibling outputs.
  if (removeInvalidRuntimeArtifactOutput(artifact.outputPath, {
    outputPathExists,
    outputIsUsable: outputVerification?.valid ?? false,
  })) {
    console.log(`🧹 Removed invalid ${artifact.label} output before rebuilding`);
  }

  await artifact.build();
  const verification = await verifyJsFile(artifact.outputPath);
  if (!verification.valid) {
    throw new Error(`${artifact.label} output is invalid: ${verification.error}`);
  }
  console.log(`✅ ${artifact.label} ready: ${artifact.outputPath}`);
}

async function ensureRuntimeArtifacts(force: boolean): Promise<void> {
  await ensureRuntimeArtifact({
    label: "Pi agent server",
    // Pi's Bun bundle imports shared sources directly, so edits under this
    // root must invalidate its dev artifact just like its own sources do.
    inputPaths: [PI_AGENT_SERVER_SOURCE, SHARED_SOURCE, join(PI_AGENT_SERVER_DIR, "package.json")],
    outputPath: PI_AGENT_SERVER_OUTPUT,
    build: buildMcpServers,
  }, force);
  await ensureRuntimeArtifact({
    label: "WhatsApp worker",
    inputPaths: [WA_WORKER_SOURCE, join(ROOT_DIR, "scripts/build-wa-worker.ts")],
    outputPath: WA_WORKER_OUTPUT,
    build: buildWaWorker,
  }, force);
  await ensureRuntimeArtifact({
    label: "Discord worker",
    inputPaths: [DISCORD_WORKER_SOURCE, join(ROOT_DIR, "scripts/build-discord-worker.ts")],
    outputPath: DISCORD_WORKER_OUTPUT,
    build: buildDiscordWorker,
  }, force);
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
  const vitePort = resolveVitePort(process.env, ROOT_DIR);

  // Codex binary path is resolved at runtime by the binary-resolver module.
  // It checks: CODEX_PATH env var > bundled binary > local dev fork > system PATH.
  // You can override with CODEX_PATH env var if needed for debugging.

  return {
    ...process.env as Record<string, string>,
    VITE_DEV_SERVER_URL: `http://localhost:${vitePort}`,
    CRAFT_CONFIG_DIR: process.env.CRAFT_CONFIG_DIR || "",
    CRAFT_APP_NAME: process.env.CRAFT_APP_NAME || "Craft Agents",
    CRAFT_DEEPLINK_SCHEME: process.env.CRAFT_DEEPLINK_SCHEME || "craftagents",
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
    external?: string[];
  } = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    await esbuild.build({
      entryPoints: [join(ROOT_DIR, entryPoint)],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: join(ROOT_DIR, outfile),
      external: options.external ?? MAIN_BUNDLE_EXTERNALS,
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

function createRestartPlugin(
  label: string,
  scheduleRestart: (reason: string) => void,
): esbuild.Plugin {
  const shouldRestart = createSuccessfulRebuildGuard();

  return {
    name: `restart-electron-after-${label}-build`,
    setup(build) {
      build.onEnd((result) => {
        if (!shouldRestart(result.errors.length)) return;

        console.log(`🔄 ${label} rebuilt; scheduling Electron restart...`);
        scheduleRestart(label);
      });
    },
  };
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

  const options = parseElectronDevOptions(process.argv.slice(2));

  // Load first so a port in .env wins over the numbered-worktree fallback,
  // while an inherited shell value still wins over .env.
  loadEnvFile();
  detectInstance();
  if (options.clean) cleanViteCache();

  // Ensure dist directory exists
  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  // Resources are required by a normal Electron startup. Runtime bundles are
  // prepared lazily when their output is missing/stale, while --full-runtime
  // deliberately rebuilds every optional artifact.
  copyResources(options.clean || options.fullRuntime);
  if (options.fullRuntime) {
    console.log("🏗️  Preparing optional full runtime...");
    await ensureBundledUvForCurrentPlatform();
  }
  await ensureRuntimeArtifacts(options.fullRuntime);

  const vitePort = resolveVitePort(process.env, ROOT_DIR);
  const oauthDefines = getOAuthDefines();

  // Do not disturb a sibling worktree by default. Vite's --strictPort below
  // reports a collision; an operator can explicitly replace a stale server.
  if (options.replaceVite) {
    console.log(`🔪 Replacing the process currently using Vite port ${vitePort}...`);
    await killProcessOnPort(vitePort);
  }

  // =========================================================
  // PHASE 1: Initial build (one-shot, wait for completion)
  // =========================================================
  console.log("🔨 Building main process...");

  const mainCjsPath = join(DIST_DIR, "main.cjs");
  const preloadCjsPath = join(DIST_DIR, "bootstrap-preload.cjs");
  const toolbarPreloadCjsPath = join(DIST_DIR, "browser-toolbar-preload.cjs");
  const extensionHostWorkerCjsPath = join(DIST_DIR, "extension-host-worker.cjs");

  // Remove old build files to ensure fresh build
  if (existsSync(mainCjsPath)) rmSync(mainCjsPath);
  if (existsSync(preloadCjsPath)) rmSync(preloadCjsPath);
  if (existsSync(toolbarPreloadCjsPath)) rmSync(toolbarPreloadCjsPath);
  if (existsSync(extensionHostWorkerCjsPath)) rmSync(extensionHostWorkerCjsPath);

  // Build every Electron-loaded CJS entry before starting the first child.
  const [mainResult, preloadResult, toolbarPreloadResult, extensionHostWorkerResult] = await Promise.all([
    runEsbuild(
      "apps/electron/src/main/index.ts",
      "apps/electron/dist/main.cjs",
      oauthDefines,
      { alias: MAIN_PROCESS_ALIAS }
    ),
    runEsbuild(
      "apps/electron/src/preload/bootstrap.ts",
      "apps/electron/dist/bootstrap-preload.cjs"
    ),
    runEsbuild(
      "apps/electron/src/preload/browser-toolbar.ts",
      "apps/electron/dist/browser-toolbar-preload.cjs"
    ),
    runEsbuild(
      "apps/electron/src/main/extension-host/worker.ts",
      "apps/electron/dist/extension-host-worker.cjs",
      {},
      { external: ["electron"] }
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

  if (!extensionHostWorkerResult.success) {
    console.error("❌ Extension-host worker build failed:", extensionHostWorkerResult.error);
    process.exit(1);
  }

  // Wait for files to stabilize (filesystem flush)
  console.log("⏳ Waiting for build files to stabilize...");
  const [mainStable, preloadStable, toolbarPreloadStable, extensionHostWorkerStable] = await Promise.all([
    waitForFileStable(mainCjsPath),
    waitForFileStable(preloadCjsPath),
    waitForFileStable(toolbarPreloadCjsPath),
    waitForFileStable(extensionHostWorkerCjsPath),
  ]);

  if (!mainStable || !preloadStable || !toolbarPreloadStable || !extensionHostWorkerStable) {
    console.error("❌ Build files did not stabilize");
    process.exit(1);
  }

  // Verify the built files are valid JavaScript
  console.log("🔍 Verifying build output...");
  const [mainValid, preloadValid, toolbarPreloadValid, extensionHostWorkerValid] = await Promise.all([
    verifyJsFile(mainCjsPath),
    verifyJsFile(preloadCjsPath),
    verifyJsFile(toolbarPreloadCjsPath),
    verifyJsFile(extensionHostWorkerCjsPath),
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

  if (!extensionHostWorkerValid.valid) {
    console.error("❌ extension-host-worker.cjs is invalid:", extensionHostWorkerValid.error);
    process.exit(1);
  }

  console.log("✅ Initial build complete and verified\n");

  // =========================================================
  // PHASE 2: Start dev servers with watch mode
  // =========================================================
  console.log("📡 Starting dev servers...\n");

  const processes: Subprocess[] = [];
  const esbuildContexts: esbuild.BuildContext[] = [];
  let electronProc: Subprocess | undefined;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let restartQueue = Promise.resolve();
  let isRestartingElectron = false;
  let isShuttingDown = false;

  // 1. Vite dev server (strictPort ensures we don't silently switch ports)
  const viteProc = spawn({
    cmd: [VITE_BIN, "dev", "--config", "apps/electron/vite.config.ts", "--port", vitePort, "--strictPort"],
    cwd: ROOT_DIR,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env as Record<string, string>,
  });
  processes.push(viteProc);

  const startElectron = (): void => {
    console.log("🚀 Starting Electron...\n");
    const proc = spawn({
      cmd: [ELECTRON_BIN, "apps/electron"],
      cwd: ROOT_DIR,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      env: getElectronEnv(),
    });
    electronProc = proc;

    void proc.exited.then((exitCode) => {
      if (electronProc !== proc) return;
      electronProc = undefined;
      if (!isShuttingDown && !isRestartingElectron) {
        console.log(`⚠️  Electron exited (${exitCode}); dev supervisor remains active.`);
      }
    });
  };

  const restartElectron = async (reason: string): Promise<void> => {
    if (isShuttingDown) return;

    isRestartingElectron = true;
    try {
      const activeElectron = electronProc;
      if (activeElectron) {
        console.log(`♻️  Restarting Electron after ${reason} build...`);
        try {
          activeElectron.kill();
          await activeElectron.exited;
        } catch {
          // The child may have already exited; launching the replacement is safe.
        }
        if (electronProc === activeElectron) electronProc = undefined;
      }

      if (!isShuttingDown) startElectron();
    } finally {
      isRestartingElectron = false;
    }
  };

  const scheduleElectronRestart = (reason: string): void => {
    if (isShuttingDown) return;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      restartQueue = restartQueue
        .then(() => restartElectron(reason))
        .catch((error) => console.error("❌ Electron restart failed:", error));
    }, ELECTRON_RESTART_DEBOUNCE_MS);
  };

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
    plugins: [createRestartPlugin("main process", scheduleElectronRestart)],
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
    plugins: [createRestartPlugin("extension-host worker", scheduleElectronRestart)],
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
    external: ["electron"],
    plugins: [createRestartPlugin("bootstrap preload", scheduleElectronRestart)],
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
    external: ["electron"],
    plugins: [createRestartPlugin("browser toolbar preload", scheduleElectronRestart)],
    logLevel: "info",
  });
  await toolbarPreloadContext.watch();
  esbuildContexts.push(toolbarPreloadContext);
  console.log("👀 Watching browser toolbar preload...");

  // 5. Start Electron after all initial outputs are verified. Its lifecycle is
  // intentionally separate from Vite and esbuild so a child restart never
  // tears down the supervisor.
  startElectron();

  const cleanup = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("\n🛑 Shutting down...");
    if (restartTimer) clearTimeout(restartTimer);
    await restartQueue;
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
    try {
      electronProc?.kill();
    } catch {
      // Electron may already be gone.
    }
  };

  const shutdownFromSignal = () => {
    void cleanup().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdownFromSignal);
  process.on("SIGTERM", shutdownFromSignal);

  // Windows doesn't have SIGINT/SIGTERM in the same way
  if (process.platform === "win32") {
    process.on("SIGHUP", shutdownFromSignal);
  }

  // Keep the supervisor alive after ordinary or intentional Electron exits.
  await new Promise<void>(() => {});
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
