import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { binaryMember, bottleMembers, sha256 } from '../../scripts/compliance/verify-bun-runtime'
const TOOLS_ROOT = process.cwd()
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(kind: 'zip' | 'tar', link = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rox-wp48-runtime-archive-test-')))
  roots.push(root)
  const member = kind === 'zip' ? 'bun-darwin-aarch64/bun' : 'bun/1.4.2/bin/bun'
  mkdirSync(join(root, member.substring(0, member.lastIndexOf('/'))), { recursive: true })
  const source = Buffer.from('Synthetic fixture; never executed.')
  if (link) { writeFileSync(join(root, 'target'), source); symlinkSync(join(root, 'target'), join(root, member)) }
  else writeFileSync(join(root, member), source)
  const archive = join(root, kind === 'zip' ? 'fixture.zip' : 'fixture.tgz')
  const args = kind === 'zip' ? ['zip', '-y', '-q', archive, member] : ['tar', '-czf', archive, '-C', root, 'bun']
  const result = Bun.spawnSync(args, { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error('FIXTURE_ARCHIVE_FAILED')
  return { source, member, archive: readFileSync(archive) }
}
test('reads exact regular ZIP binary member without filesystem extraction', async () => {
  const f = fixture('zip')
  expect(await binaryMember(f.archive, f.member, TOOLS_ROOT)).toEqual(f.source)
})
test('rejects binary ZIP member symlink and malformed ZIP bytes', async () => {
  const f = fixture('zip', true)
  await expect(binaryMember(f.archive, f.member, TOOLS_ROOT)).rejects.toThrow('UNSUPPORTED_OFFICIAL_ZIP_ENTRY')
  await expect(binaryMember(Buffer.from('not a zip'), f.member, TOOLS_ROOT)).rejects.toThrow('OFFICIAL_ZIP_UNREADABLE')
})
test('reads checksum-bound bottle member and rejects a different digest', async () => {
  const f = fixture('tar')
  const result = await bottleMembers(f.archive, sha256(f.archive), [f.member], TOOLS_ROOT)
  expect(result.get(f.member)).toEqual(f.source)
  expect(() => bottleMembers(f.archive, '0'.repeat(64), [f.member], TOOLS_ROOT)).toThrow('BOTTLE_IDENTITY_MISMATCH')
})
test('rejects requested bottle symlink member instead of following it', async () => {
  const f = fixture('tar', true)
  await expect(bottleMembers(f.archive, sha256(f.archive), [f.member], TOOLS_ROOT)).rejects.toThrow('UNSUPPORTED_BOTTLE_MEMBER')
})
