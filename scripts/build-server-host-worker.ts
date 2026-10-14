/**
 * #1586: bundle the standalone server (packages/server) for the Electron
 * utilityProcess host → apps/electron/dist/server-host-worker.mjs.
 *
 * ESM (not CJS): packages/server/src/index.ts uses top-level await, which
 * esbuild rejects for CJS. A createRequire banner keeps bundled CJS deps that
 * call `require` / `__dirname` working. Externals mirror build:main (native / bun-only /
 * heavy optional deps that are already shipped or guarded at runtime).
 */
import * as esbuild from "esbuild";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "apps/electron/dist/server-host-worker.mjs");

await esbuild.build({
  entryPoints: [join(ROOT, "packages/server/src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: OUT,
  logLevel: "warning",
  // Bun-only `import.meta.dir` (packages/server bundledAssetsRoot fallback).
  define: { "import.meta.dir": "__dirname" },
  external: [
    "electron",
    "@anthropic-ai/claude-agent-sdk",
    "onnxruntime-node",
    "@xenova/transformers",
    "sharp",
    "bun:*",
  ],
  banner: {
    js: [
      "import { createRequire as __roxCreateRequire } from 'node:module';",
      "import { fileURLToPath as __roxFileURLToPath } from 'node:url';",
      "import { dirname as __roxDirname } from 'node:path';",
      "const require = __roxCreateRequire(import.meta.url);",
      "const __filename = __roxFileURLToPath(import.meta.url);",
      "const __dirname = __roxDirname(__filename);",
    ].join(" "),
  },
});

// Validation: output exists, non-trivial, and has no static bun: imports
// (bun:sqlite must stay behind a runtime require guard, as in main.cjs).
if (!existsSync(OUT) || statSync(OUT).size < 1024) {
  console.error(`[server-host-worker] missing or empty output: ${OUT}`);
  process.exit(1);
}
const src = readFileSync(OUT, "utf-8");
// esbuild emits external imports with double quotes; single-quoted matches are
// generated-script template strings (e.g. pages/data-write), not real imports.
const staticBun = src.match(/^import[^\n]*from\s*"bun:[a-z]+"/m);
if (staticBun) {
  console.error(`[server-host-worker] static bun import in bundle: ${staticBun[0]}`);
  process.exit(1);
}
console.log(`[server-host-worker] ok ${OUT} (${(statSync(OUT).size / 1e6).toFixed(1)} MB)`);
