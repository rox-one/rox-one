import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../..')

describe('#1573 main compile-cache entry shim', () => {
  it('package.json and electron-builder both point main at dist/boot.cjs', () => {
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).main).toBe('dist/boot.cjs')
    expect(readFileSync(join(root, 'electron-builder.yml'), 'utf8')).toMatch(/extraMetadata:\s*\n\s*main: dist\/boot\.cjs/)
  })

  it('boot.cjs enables the cache guarded, then loads main.cjs', () => {
    const src = readFileSync(join(root, 'src/main/boot.cjs'), 'utf8')
    expect(src).toContain('enableCompileCache')
    expect(src).toContain('ROX_DISABLE_COMPILE_CACHE')
    expect(src.trimEnd().endsWith("require('./main.cjs')")).toBe(true)
  })

  it('every main build path copies boot.cjs into dist', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['build:main']).toContain('boot.cjs')
    expect(pkg.scripts['build:main:win']).toContain('boot.cjs')
    for (const f of ['../../scripts/electron-build-main.ts', '../../scripts/electron-dev.ts']) {
      expect(readFileSync(join(root, f), 'utf8')).toContain('src/main/boot.cjs')
    }
  })
})
