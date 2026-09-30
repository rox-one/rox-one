import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { digest } from '../../scripts/compliance/collect-build-attribution'
import { verifyIntegrity, verifyPackageArchive } from '../../scripts/compliance/verify-registry-attribution'

const fixtures: string[] = []
afterEach(() => { for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rox-wp48-registry-test-')))
  fixtures.push(root)
  mkdirSync(join(root, 'package'))
  const manifest = JSON.stringify({ name: 'synthetic', version: '1.0.0', license: 'MIT' })
  const input = 'export const value = 123;\n'
  const license = 'Synthetic license text, no legal claim.\n'
  writeFileSync(join(root, 'package', 'package.json'), manifest)
  writeFileSync(join(root, 'package', 'index.js'), input)
  writeFileSync(join(root, 'package', 'LICENSE'), license)
  const tar = Bun.spawnSync(['tar', '-czf', join(root, 'package.tgz'), '-C', root, 'package'], { stdout: 'pipe', stderr: 'pipe' })
  if (tar.exitCode !== 0) throw new Error('FIXTURE_ARCHIVE_FAILED')
  const source = readFileSync(join(root, 'package.tgz'))
  const integrity = 'sha512-' + createHash('sha512').update(source).digest('base64')
  const pkg = { root: 'node_modules/synthetic', name: 'synthetic', version: '1.0.0', manifestSha256: digest(manifest), licenseDeclaration: 'MIT', repositoryDeclaration: null, lockMatches: [{ key: 'synthetic', row: ['synthetic@1.0.0', '', {}, integrity] }], workspaceLock: null, notices: [{ path: 'node_modules/synthetic/LICENSE', sha256: digest(license), bytes: license.length, text: license }], inputs: [{ path: 'node_modules/synthetic/index.js', sha256: digest(input), bytes: input.length, bytesInOutput: 10, packageRoot: 'node_modules/synthetic', imports: [] }], findings: [] }
  return { pkg, source, integrity }
}
test('matches installed source, manifest and exact notice bytes to an integrity-pinned genuine archive', () => {
  const { pkg, source } = fixture()
  const result = verifyPackageArchive(pkg, source)
  expect(result.manifestMatches).toBe(true)
  expect(result.inputs[0]?.matches).toBe(true)
  expect(result.notices[0]?.matches).toBe(true)
  expect(result.findings).toEqual([])
  expect(result.legalApproval).toBe(false)
})
test('rejects archive modification before treating any member as origin evidence', () => {
  const { source, integrity } = fixture()
  expect(() => verifyIntegrity(Buffer.concat([source, Buffer.from('tampered')]), integrity)).toThrow('REGISTRY_INTEGRITY_MISMATCH')
})
test('detects installed source changes even when their byte length is unchanged', () => {
  const { pkg, source } = fixture()
  const input = pkg.inputs[0]
  if (!input) throw new Error('FIXTURE_INPUT_MISSING')
  input.sha256 = digest('export const value = 456;\n')
  expect(verifyPackageArchive(pkg, source).findings.map(row => row.code)).toContain('REGISTRY_INPUT_MISMATCH')
})
test('does not misattribute an install-generated notice to a registry package member', () => {
  const { pkg, source } = fixture()
  pkg.notices.push({ path: 'node_modules/synthetic/dist/LICENSE', sha256: digest('install generated text'), bytes: 22, text: 'install generated text' })
  const result = verifyPackageArchive(pkg, source)
  expect(result.notices[1]?.matches).toBe(false)
  expect(result.findings.map(row => row.code)).toContain('INSTALLED_NOTICE_NOT_REGISTRY_MEMBER')
})
