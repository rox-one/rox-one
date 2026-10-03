import { expect, test } from 'bun:test'
import { compareBinary, gitBlob, pinnedSource, releaseAsset, sha256, verifyReleaseArchive } from '../../scripts/compliance/verify-bun-runtime'
const source = Buffer.from('Synthetic release bytes; not an executable.')
const revision = 'a'.repeat(40)
const release = { tag_name: 'bun-v1.4.2', target_commitish: revision, assets: [{ name: 'bun-darwin-aarch64.zip', size: source.length, digest: 'sha256:' + sha256(source), browser_download_url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-darwin-aarch64.zip' }] }
const tag = { object: { type: 'commit', sha: revision } }
test('binds official release tag, commit, platform asset and exact archive digest', () => {
  const asset = releaseAsset(release, tag, '1.4.2', 'bun-darwin-aarch64.zip')
  expect(asset.revision).toBe(revision)
  expect(() => verifyReleaseArchive(asset, source)).not.toThrow()
})
test('rejects altered official archive rather than accepting its version label', () => {
  const asset = releaseAsset(release, tag, '1.4.2', 'bun-darwin-aarch64.zip')
  expect(() => verifyReleaseArchive(asset, Buffer.concat([source, Buffer.from('changed')]))).toThrow('OFFICIAL_RELEASE_DIGEST_MISMATCH')
})
test('rejects tag/source mismatch and producer-selected download origin', () => {
  expect(() => releaseAsset(release, { object: { type: 'commit', sha: 'b'.repeat(40) } }, '1.4.2', 'bun-darwin-aarch64.zip')).toThrow('RELEASE_REVISION_MISMATCH')
  expect(() => releaseAsset({ ...release, assets: release.assets.map(asset => ({ ...asset, browser_download_url: 'https://example.invalid/bun.zip' })) }, tag, '1.4.2', 'bun-darwin-aarch64.zip')).toThrow('UNTRUSTED_RELEASE_ORIGIN')
})
test('retains nonidentical installed binary as a mismatch, not proof of official distribution', () => {
  const result = compareBinary(Buffer.from('Homebrew variant'), Buffer.from('upstream variant'))
  expect(result.exactMatch).toBe(false)
  expect(result.installedSha256).not.toBe(result.upstreamSha256)
  expect(result.legalApproval).toBe(false)
})
test('computes real Git blob identity for bounded upstream source evidence', () => {
  expect(gitBlob(Buffer.alloc(0))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
})
test('rejects untrusted source repository and traversal before network readback', async () => {
  await expect(pinnedSource({ repository: 'producer/forged-bun', revision, path: 'LICENSE' })).rejects.toThrow('UNTRUSTED_SOURCE_IDENTITY')
  await expect(pinnedSource({ repository: 'oven-sh/bun', revision, path: '../LICENSE' })).rejects.toThrow('UNTRUSTED_SOURCE_IDENTITY')
})
