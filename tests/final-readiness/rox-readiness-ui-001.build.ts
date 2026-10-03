import * as esbuild from 'esbuild'
import { resolve } from 'node:path'
import { PRELOAD_BUNDLE_ALIAS, PRELOAD_BUNDLE_EXTERNALS } from '../../scripts/electron-preload-bundle'

// Same production entry points/aliases as the canonical scripts. Deliberately
// avoid loading a checkout .env or baking OAuth/Sentry credentials into QA.
const root = resolve(import.meta.dir, '../..')
await esbuild.build({ absWorkingDir: root, entryPoints: ['apps/electron/src/main/index.ts'], bundle: true,
  platform: 'node', format: 'cjs', outfile: 'apps/electron/dist/main.cjs',
  banner: { js: 'var __roxElectronMainBundleFileUrl = require("node:url").pathToFileURL(__filename).href;' },
  define: { 'import.meta.url': '__roxElectronMainBundleFileUrl',
    'process.env.SLACK_OAUTH_CLIENT_ID': '""', 'process.env.SLACK_OAUTH_CLIENT_SECRET': '""',
    'process.env.MICROSOFT_OAUTH_CLIENT_ID': '""', 'process.env.MICROSOFT_OAUTH_CLIENT_SECRET': '""',
    'process.env.SENTRY_ELECTRON_INGEST_URL': '""', 'process.env.CRAFT_DEV_RUNTIME': '""' },
  external: ['electron', '@anthropic-ai/claude-agent-sdk', '@xenova/transformers', 'onnxruntime-node', 'sharp', 'koffi'],
  alias: { 'node-fetch': resolve(root, 'apps/electron/src/main/shims/node-fetch.cjs'),
    'abort-controller': resolve(root, 'apps/electron/src/main/shims/abort-controller.cjs'),
    'bun:sqlite': resolve(root, 'apps/electron/src/main/shims/node-sqlite.cjs') } })
for (const [entry, output] of [['bootstrap', 'bootstrap-preload'], ['browser-toolbar', 'browser-toolbar-preload']]) {
  await esbuild.build({ absWorkingDir: root, entryPoints: [`apps/electron/src/preload/${entry}.ts`], bundle: true,
    platform: 'node', format: 'cjs', outfile: `apps/electron/dist/${output}.cjs`,
    external: [...PRELOAD_BUNDLE_EXTERNALS], alias: PRELOAD_BUNDLE_ALIAS })
}
await esbuild.build({ absWorkingDir: root, entryPoints: ['apps/electron/src/main/extension-host/worker.ts'], bundle: true,
  platform: 'node', format: 'cjs', outfile: 'apps/electron/dist/extension-host-worker.cjs', external: ['electron'] })
console.log('Built actual Electron main, bootstrap/toolbar preloads and extension worker without checkout .env')
