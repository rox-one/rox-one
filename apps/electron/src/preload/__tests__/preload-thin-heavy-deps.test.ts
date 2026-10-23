/**
 * bootstrap-preload.cjs must stay an IPC/WS bridge. A barrel import of
 * `@rox/shared/config` once pulled models-pi → pi-ai (~2.5 MB) and
 * session-tools → mermaid/elk (~2 MB) into every window's preload. Guard both
 * the narrow import and the stub aliases so the regression cannot return.
 */
import { describe, expect, it } from 'bun:test'
import { build } from 'esbuild'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PRELOAD_BUNDLE_ALIAS,
  PRELOAD_BUNDLE_EXTERNALS,
  PRELOAD_HEAVY_DEP_ALIASES,
  PRELOAD_HEAVY_DEP_STUB,
} from '../../../../../scripts/electron-preload-bundle.ts'

const repoRoot = join(import.meta.dir, '../../../../..')
/** Soft ceiling: real thin build is ~0.55 MB; leave headroom for legitimate growth. */
const MAX_BOOTSTRAP_PRELOAD_BYTES = 1_500_000

describe('preload stays free of heavy agent/diagram SDKs', () => {
  it('aliases pi-ai, @google/genai, beautiful-mermaid and elkjs to the inert stub', () => {
    expect(PRELOAD_HEAVY_DEP_ALIASES['@earendil-works/pi-ai']).toBe(PRELOAD_HEAVY_DEP_STUB)
    expect(PRELOAD_HEAVY_DEP_ALIASES['@google/genai']).toBe(PRELOAD_HEAVY_DEP_STUB)
    expect(PRELOAD_HEAVY_DEP_ALIASES['beautiful-mermaid']).toBe(PRELOAD_HEAVY_DEP_STUB)
    expect(PRELOAD_HEAVY_DEP_ALIASES.elkjs).toBe(PRELOAD_HEAVY_DEP_STUB)
    expect(PRELOAD_BUNDLE_ALIAS['@earendil-works/pi-ai']).toBe(PRELOAD_HEAVY_DEP_STUB)
  })

  it('imports normalizeRemoteTlsTrust from the narrow config subpath, not the barrel', () => {
    const src = readFileSync(
      join(repoRoot, 'apps/electron/src/shared/remote-tls-client-options.ts'),
      'utf8',
    )
    expect(src).toContain("from '@rox/shared/config/remote-tls-trust'")
    expect(src).not.toMatch(/from ['"]@rox\/shared\/config['"]/)
  })

  it('exposes @rox/shared/config/remote-tls-trust as a package export', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'packages/shared/package.json'), 'utf8')) as {
      exports: Record<string, string>
    }
    expect(pkg.exports['./config/remote-tls-trust']).toBe('./src/config/remote-tls-trust.ts')
  })

  it('bundles the real preload entry under the size ceiling without the heavy SDKs', async () => {
    const outfile = join(mkdtempSync(join(tmpdir(), 'preload-thin-')), 'bootstrap-preload.cjs')
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
    const bytes = statSync(outfile).size
    expect(bytes).toBeLessThan(MAX_BOOTSTRAP_PRELOAD_BYTES)
    expect(out).not.toContain('node_modules/@earendil-works/pi-ai/')
    expect(out).not.toContain('node_modules/beautiful-mermaid/')
    expect(out).not.toContain('node_modules/elkjs/')
    expect(out).not.toContain('node_modules/@google/genai/')
  })
})
