import { describe, expect, it } from 'bun:test'
import { build } from 'esbuild'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PRELOAD_BUNDLE_ALIAS,
  PRELOAD_BUNDLE_EXTERNALS,
} from '../../../../../scripts/electron-preload-bundle.ts'

const repoRoot = join(import.meta.dir, '../../../../..')
const scriptsDir = join(repoRoot, 'scripts')
const stubMarker = 'The Claude Agent SDK is unavailable in the Electron renderer'
const ajvCodegen = join(repoRoot, 'node_modules/ajv-formats/node_modules/ajv/dist/compile/codegen')

describe('preload Claude Agent SDK isolation', () => {
  it('aliases the Claude Agent SDK to the renderer stub', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'preload-sdk-'))
    const entry = join(dir, 'entry.ts')
    const outfile = join(dir, 'preload.cjs')
    writeFileSync(
      entry,
      "import { query } from '@anthropic-ai/claude-agent-sdk'\nexport { query }\n",
    )

    await build({
      absWorkingDir: repoRoot,
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile,
      external: [...PRELOAD_BUNDLE_EXTERNALS],
      alias: PRELOAD_BUNDLE_ALIAS,
      logLevel: 'silent',
    })

    const out = readFileSync(outfile, 'utf8')
    expect(out).not.toContain('node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs')
    expect(out).not.toContain('createRequire)(import_meta.url)')
    expect(out).toContain(stubMarker)
  })

  it('keeps packaging and electron:dev preload builds on the stub alias', () => {
    const preloadBuild = readFileSync(join(scriptsDir, 'electron-build-preload.ts'), 'utf8')
    const electronDev = readFileSync(join(scriptsDir, 'electron-dev.ts'), 'utf8')
    const win32 = readFileSync(join(scriptsDir, 'build/win32.ts'), 'utf8')
    const pkg = readFileSync(join(repoRoot, 'apps/electron/package.json'), 'utf8')

    expect(preloadBuild).toContain('PRELOAD_BUNDLE_ALIAS')
    expect(electronDev).toContain('PRELOAD_BUNDLE_ALIAS')
    expect(win32).toContain('claude-agent-sdk-stub.ts')
    expect(pkg).toContain('src/renderer/shims/claude-agent-sdk-stub.ts')
  })

  it.skipIf(!existsSync(ajvCodegen))('stubs the SDK when bundling the real preload entry', async () => {
    const outfile = join(mkdtempSync(join(tmpdir(), 'preload-boot-')), 'bootstrap-preload.cjs')
    await build({
      absWorkingDir: repoRoot,
      entryPoints: ['apps/electron/src/preload/bootstrap.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile,
      external: [...PRELOAD_BUNDLE_EXTERNALS],
      alias: PRELOAD_BUNDLE_ALIAS,
      logLevel: 'silent',
    })

    const out = readFileSync(outfile, 'utf8')
    expect(out).not.toContain('node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs')
    expect(out).not.toContain('createRequire)(import_meta.url)')
  })
})
