import * as esbuild from 'esbuild'
import { resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { PRELOAD_BUNDLE_ALIAS, PRELOAD_BUNDLE_EXTERNALS } from '../../scripts/electron-preload-bundle'

// Same production entry points/aliases as the canonical scripts. Deliberately
// avoid loading a checkout .env or baking OAuth/Sentry credentials into QA.
const root = resolve(import.meta.dir, '../..')
if (process.argv.includes('--node-driver')) {
  await esbuild.build({ absWorkingDir: root, entryPoints: ['tests/final-readiness/rox-readiness-ui-001.product.test.ts'], bundle: true,
    platform: 'node', format: 'cjs', outfile: 'work/rox-readiness-ui-001.native-driver.cjs',
    define: { 'import.meta.dir': JSON.stringify(resolve(root, 'tests/final-readiness')) },
    alias: { 'bun:test': resolve(root, 'tests/final-readiness/rox-readiness-ui-001.node-driver.ts') },
    external: ['playwright', '@playwright/test'] })
  console.log('Built Node Playwright driver for identical native product callbacks/assertions')
  process.exit(0)
}
async function snapshot() {
  const child = Bun.spawn(['git', 'ls-files', 'apps/electron/src', 'packages'], { cwd: root, stdout: 'pipe' })
  const tracked = (await new Response(child.stdout).text()).trim().split('\n'); await child.exited
  const paths = tracked.filter(path => /\.(?:ts|tsx|json|html|css)$/.test(path) && !path.includes('/__tests__/')
    && !path.includes('/tests/') && (path.startsWith('apps/electron/src/') || path.includes('/src/'))).sort()
  // Include new shipped recovery helpers before the lead commits them.
  const untracked = Bun.spawn(['git', 'ls-files', '--others', '--exclude-standard', 'apps/electron/src', 'packages'], { cwd: root, stdout: 'pipe' })
  for (const path of (await new Response(untracked.stdout).text()).trim().split('\n')) {
    if (/\.(?:ts|tsx|json|html|css)$/.test(path) && !path.includes('/__tests__/') && !path.includes('/tests/')) paths.push(path)
  }
  await untracked.exited
  const sourceHashes = Object.fromEntries(await Promise.all([...new Set(paths)].sort().map(async path => [path,
    createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')])))
  const git = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: root, stdout: 'pipe' })
  const inputRevision = (await new Response(git.stdout).text()).trim(); await git.exited
  return { inputRevision, sourceHashes, sourceManifestSha256: createHash('sha256').update(JSON.stringify(sourceHashes)).digest('hex') }
}
const before = await snapshot()
async function receipt(kind: string, options: unknown) {
  const after = await snapshot()
  if (before.inputRevision !== after.inputRevision || before.sourceManifestSha256 !== after.sourceManifestSha256) {
    throw new Error('Source changed during build; this output cannot qualify the frozen candidate')
  }
  await writeFile(resolve(root, `work/rox-readiness-ui-001-build-${kind}.json`), JSON.stringify({ ...before,
    toolchain: { bun: Bun.version, executablePath: process.execPath }, options, finishedAt: new Date().toISOString() }, null, 2))
}
if (process.argv.includes('--renderer')) {
  const { build } = await import('vite')
  // Keep all shipped aliases, plugins, entrypoints and production transforms.
  // Maps and compression reporting do not affect executable behavior; omit
  // them in the bounded native proof lane and never load checkout env files.
  await build({ configFile: resolve(root, 'apps/electron/vite.config.ts'), envDir: false,
    build: { sourcemap: false, reportCompressedSize: false, emptyOutDir: true } })
  await receipt('renderer', { shippedViteConfig: true, envDir: false, sourcemap: false, reportCompressedSize: false, generatedOutputCleared: true })
  console.log('Built actual renderer with shipped Vite config, no env files, sourcemaps or gzip reporting')
  process.exit(0)
}
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
await receipt('main', { shippedEntryPointsAndAliases: true, checkoutEnvFilesLoaded: false,
  oauthAndSentryBuildValues: 'empty', protocolRegistration: 'test-only opt-in guard' })
