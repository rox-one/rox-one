import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collect, digest } from '../../scripts/compliance/collect-build-attribution'

const TOOLS_ROOT = process.cwd()
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rox-wp48-attribution-test-')))
  roots.push(root)
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'dist'))
  mkdirSync(join(root, 'node_modules', 'synthetic'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-workspace', version: '1.0.0', license: 'Apache-2.0' }))
  writeFileSync(join(root, 'LICENSE'), 'Fixture license text; no approval.\n')
  writeFileSync(join(root, 'src', 'index.js'), 'import { value } from "synthetic"; console.log(value);\n')
  writeFileSync(join(root, 'node_modules', 'synthetic', 'package.json'), JSON.stringify({ name: 'synthetic', version: '1.0.0', license: 'MIT', main: 'index.js' }))
  writeFileSync(join(root, 'node_modules', 'synthetic', 'index.js'), 'export const value = 123;\n')
  writeFileSync(join(root, 'node_modules', 'synthetic', 'LICENSE'), 'Fixture dependency notice; no actual license claim.\n')
  writeFileSync(join(root, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, workspaces: { '': { name: 'synthetic-workspace', version: '1.0.0' } }, packages: { synthetic: ['synthetic@1.0.0', '', {}, 'sha512-fixture'] } }))
  const build = Bun.spawnSync([process.execPath, 'build', 'src/index.js', '--target', 'bun', '--outdir', 'dist', '--metafile=dist/meta.json'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (build.exitCode !== 0) throw new Error('FIXTURE_BUILD_FAILED:' + build.stderr.toString())
  const options = { root, buildCwd: root, outputRoot: join(root, 'dist'), metafile: join(root, 'dist', 'meta.json'), lock: join(root, 'bun.lock'), toolsRoot: TOOLS_ROOT }
  return { root, options }
}
describe('actual Bun build attribution inputs', () => {
  test('reads exact outputs, bundled package source, installed notice bytes and lock locator', () => {
    const { root, options } = fixture()
    const result = collect(options)
    expect(result.legalApproval).toBe(false)
    expect(result.outputs[0]?.sha256).toBe(digest(readFileSync(join(root, 'dist', 'index.js'))))
    const pkg = result.packages.find(row => row.name === 'synthetic')
    expect(pkg?.version).toBe('1.0.0')
    expect(pkg?.inputs[0]?.sha256).toBe(digest(readFileSync(join(root, 'node_modules', 'synthetic', 'index.js'))))
    expect(pkg?.inputs[0]?.bytesInOutput).toBeGreaterThan(0)
    expect(pkg?.lockMatches.map(row => row.key)).toEqual(['synthetic'])
    expect(pkg?.notices[0]?.text).toBe('Fixture dependency notice; no actual license claim.\n')
    expect(pkg?.findings.map(row => row.code)).toContain('REGISTRY_ARCHIVE_INTEGRITY_NOT_READ_BACK')
  })
  test('rejects changed source byte count rather than attributing new bytes to old graph', () => {
    const { root, options } = fixture()
    writeFileSync(join(root, 'node_modules', 'synthetic', 'index.js'), 'changed after the actual build\n')
    expect(() => collect(options)).toThrow('INPUT_SIZE_MISMATCH')
  })
  test('rejects changed final bundle byte count', () => {
    const { root, options } = fixture()
    writeFileSync(join(root, 'dist', 'index.js'), 'bundle changed\n')
    expect(() => collect(options)).toThrow('OUTPUT_SIZE_MISMATCH')
  })
  test('marks installed version absent from lock as missing rather than using package name', () => {
    const { root, options } = fixture()
    writeFileSync(join(root, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, workspaces: { '': {} }, packages: { synthetic: ['synthetic@0.9.0', '', {}, 'sha512-fixture'] } }))
    const result = collect(options)
    expect(result.findings.map(row => row.code)).toContain('LOCK_LOCATOR_MISSING')
  })
  test('retains ambiguous same-version locator evidence without choosing arbitrary lock row', () => {
    const { root, options } = fixture()
    writeFileSync(join(root, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, workspaces: { '': {} }, packages: { synthetic: ['synthetic@1.0.0', '', {}, 'sha512-fixture'], 'parent/synthetic': ['synthetic@1.0.0', '', {}, 'sha512-other'] } }))
    const result = collect(options)
    expect(result.findings.map(row => row.code)).toContain('LOCK_LOCATOR_AMBIGUOUS')
    expect(result.packages.find(row => row.name === 'synthetic')?.lockMatches).toHaveLength(2)
  })
  test('marks missing dependency license text', () => {
    const { root, options } = fixture()
    rmSync(join(root, 'node_modules', 'synthetic', 'LICENSE'))
    expect(collect(options).findings.map(row => row.code)).toContain('LICENSE_TEXT_MISSING')
  })
  test('rejects an input leaf symlink inside owned fixture without reading or writing through it', () => {
    const { root, options } = fixture()
    const input = join(root, 'node_modules', 'synthetic', 'index.js')
    const target = join(root, 'synthetic-source.js')
    writeFileSync(target, readFileSync(input))
    rmSync(input)
    symlinkSync(target, input)
    expect(() => collect(options)).toThrow('SYMLINK_INPUT_UNVERIFIED')
  })
})
