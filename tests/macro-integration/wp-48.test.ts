import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { create as createTar, Header } from 'tar'
import { AuditFileOrigin, CheckRelease, DecisionManifestSchema, ProduceSBOM, ReleaseSchema, archiveInventory, artifactDigest, canonical, componentDigest, fileComponentIds, inventory, parseLock, sha256, type Component, type DecisionManifest, type Release } from '../../scripts/compliance/generate-sbom'

const sourceRevision = 'a'.repeat(40)
const originRevision = 'b'.repeat(40)
const cleanup: string[] = []
afterEach(() => { for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function requiredFixtureValue<T>(value: T | null | undefined, subject: string): T {
  if (value === null || value === undefined) throw new Error('Missing fixture value: ' + subject)
  return value
}

function fixture() {
  const root = mkdtempSync(join(process.env.WP48_TMPDIR ?? tmpdir(), 'wp48-'))
  cleanup.push(root)
  const notice = 'MIT License\nCopyright (c) fixture author\nPermission is hereby granted to use this fixture.\n'
  writeFileSync(join(root, 'LICENSE'), notice)
  const lock = `{
    // Bun JSONC retains nested pins and native target metadata.
    "lockfileVersion": 1,
    "workspaces": { "packages/workspace": { "name": "@rox/workspace", "version": "1.0.0" } },
    "packages": {
      "sync": ["sync@2.0.0", "", { "dependencies": { "media": "^1.0.0" } }, "sha512-sync"],
      "media": ["media@1.0.0", "", { "os": "linux", "cpu": "arm64" }, "sha512-media"],
      "sync/media": ["media@1.1.0", "", {}, "sha512-nested"],
      "electron": ["electron@39.2.7", "", {}, "sha512-electron"],
    },
  }`
  const components: Component[] = [
    { id: 'workspace', kind: 'workspace', name: '@rox/workspace', version: '1.0.0' },
    { id: 'sync', kind: 'dependency', name: 'sync', version: '2.0.0', lockKey: 'sync', integrity: 'sha512-sync' },
    { id: 'media', kind: 'dependency', name: 'media', version: '1.1.0', lockKey: 'sync/media', integrity: 'sha512-nested' },
    { id: 'electron', kind: 'dependency', name: 'electron', version: '39.2.7', lockKey: 'electron', integrity: 'sha512-electron' },
  ].map(c => ({ ...c, origin: { repository: 'independent/upstream', revision: originRevision, path: c.id + '/source.ts', sha256: sha256('upstream ' + c.id), modifications: '', transfer: 'dependency' }, licenseExpression: 'MIT', notices: [{ path: 'LICENSE', sha256: sha256(notice) }] } as Component))
  const artifacts: Release['artifacts'] = components.map(c => {
    const contentRoot = 'payload-' + c.id
    mkdirSync(join(root, contentRoot))
    writeFileSync(join(root, contentRoot, 'code.js'), 'export const component = ' + JSON.stringify(c.id))
    writeFileSync(join(root, contentRoot, 'LICENSE'), notice)
    return { id: c.id, kind: c.id as Release['artifacts'][number]['kind'], path: contentRoot, contentRoot, sha256: artifactDigest(join(root, contentRoot)), platform: 'linux', arch: 'arm64', buildFlags: { format: 'esm', minify: false, devRuntime: false }, files: inventory(join(root, contentRoot)).map(f => ({ ...f, componentId: c.id })) }
  })
  const release: Release = { schemaVersion: 1, sourceRevision, lockSha256: sha256(lock), artifacts, components }
  const manifest: DecisionManifest = { schemaVersion: 1, policy: 'LICENSE_REVIEW_REQUIRED', reviewers: ['fixture-reviewer'], preservedNotices: [{ path: 'LICENSE', sha256: sha256(notice) }], knownScopes: [], decisions: [] }
  function approve() {
    const produced = ProduceSBOM(release, lock, root, sourceRevision, manifest)
    manifest.decisions = artifacts.flatMap(a => [...new Set(a.files.flatMap(fileComponentIds))].map(componentId => {
      const c = requiredFixtureValue(components.find(c => c.id === componentId), 'owned component')
      return { artifactId: a.id, artifactSha256: a.sha256, sbomSha256: produced.sbomSha256, buildFlagsSha256: sha256(canonical(a.buildFlags)), componentId, componentSha256: componentDigest(release, c), origin: structuredClone(c.origin), licenseExpression: requiredFixtureValue(c.licenseExpression, 'license expression'), notices: structuredClone(c.notices), reviewer: 'fixture-reviewer', reviewedAt: '2026-09-30T00:00:00Z', outcome: 'approved' as const, evidence: 'Fixture-only qualified-review evidence, not a live receipt' }
    }))
  }
  function check(bundle = notice) { return CheckRelease(release, lock, root, sourceRevision, manifest, bundle) }
  return { root, lock, release, manifest, notice, approve, check }
}

describe('WP-48 exact artifact compliance (fixture evidence, not product completion)', () => {
  test('pins workspace/sync/media/Electron including nested and native records', () => {
    const f = fixture()
    f.approve()
    const result = f.check()
    expect(result.state).toBe('REVIEWED_EXACT_ARTIFACT')
    expect(result.findings).toEqual([])
    const pins = result.sbom.lock.packages
    expect(pins.find(p => p.key === 'sync/media')).toMatchObject({ version: '1.1.0', integrity: 'sha512-nested' })
    expect(pins.find(p => p.key === 'media')?.dependencies).toEqual({ os: 'linux', cpu: 'arm64' })
    expect(result.sbom.lock.workspaces['packages/workspace']).toEqual({ name: '@rox/workspace', version: '1.0.0' })
    expect(result.sbom.lock.packages.every(p => p.licenseReview === 'LICENSE_REVIEW_REQUIRED')).toBe(true)
  })
  test('rejects a broad or wrong nested dependency pin', () => {
    const f = fixture()
    requiredFixtureValue(f.release.components[2], 'component 2').lockKey = 'media'
    f.approve()
    expect(f.check().findings).toContainEqual({ code: 'LOCK_COMPONENT_MISMATCH', subject: 'media' })
  })
  test('seed: unreviewed copied web file is denied, root never overrides web scope', () => {
    const f = fixture()
    const c = requiredFixtureValue(f.release.components[0], 'component 0')
    c.origin = { repository: 'macro-inc/macro', revision: originRevision, path: 'apps/web/copied.ts', sha256: sha256('copied upstream'), modifications: 'adapted imports', transfer: 'copy' }
    f.manifest.knownScopes = [
      { repository: 'macro-inc/macro', revision: originRevision, path: '', licenseExpression: 'AGPL-3.0-only', evidencePath: 'LICENSE.txt', evidenceSha256: sha256('AGPL evidence') },
      { repository: 'macro-inc/macro', revision: originRevision, path: 'apps/web', licenseExpression: 'LicenseRef-All-Rights-Reserved', evidencePath: 'apps/web/LICENSE', evidenceSha256: sha256('ARR evidence') },
    ]
    const denied = f.check()
    expect(denied.state).toBe('LICENSE_REVIEW_REQUIRED')
    expect(denied.findings).toContainEqual({ code: 'COPIED_SOURCE_UNREVIEWED', subject: c.id })
    expect(denied.findings).toContainEqual({ code: 'ROOT_WEB_SCOPE_CONFLICT', subject: c.id })
    expect(requiredFixtureValue(denied.sbom.components.find(component => component.id === c.id), 'audited component').scopeEvidence.map(s => s.licenseExpression)).toEqual(['AGPL-3.0-only', 'LicenseRef-All-Rights-Reserved'])
    f.approve()
    expect(f.check().findings).toContainEqual({ code: 'ROOT_WEB_SCOPE_CONFLICT', subject: c.id })
    requiredFixtureValue(f.manifest.decisions[0], 'decision 0').conflictResolution = 'Fixture-specific rights grant for this file and artifact'
    expect(f.check().state).toBe('REVIEWED_EXACT_ARTIFACT')
  })
  test('rejects origin dot-segment aliases rather than bypassing known web scope', () => {
    const f = fixture()
    const component = requiredFixtureValue(f.release.components[0], 'component')
    for (const path of ['apps/./web/copied.ts', './apps/web/copied.ts', 'apps/web/.']) {
      component.origin.path = path
      expect(() => ReleaseSchema.parse(f.release)).toThrow()
    }
    for (const path of ['apps/./web', './apps/web', 'apps/web/.']) {
      f.manifest.knownScopes = [{ repository: component.origin.repository, revision: originRevision, path, licenseExpression: 'LicenseRef-Reserved', evidencePath: 'apps/web/LICENSE', evidenceSha256: sha256('reserved') }]
      expect(() => DecisionManifestSchema.parse(f.manifest)).toThrow()
    }
  })
  test('file scope boundary does not confuse apps/website with apps/web', () => {
    const f = fixture()
    const c = requiredFixtureValue(f.release.components[0], 'component 0')
    c.origin.path = 'apps/website/file.ts'
    f.manifest.knownScopes = [{ repository: c.origin.repository, revision: originRevision, path: 'apps/web', licenseExpression: 'LicenseRef-Reserved', evidencePath: 'apps/web/LICENSE', evidenceSha256: sha256('reserved') }]
    expect(AuditFileOrigin(c, f.manifest)).toEqual([])
  })
  for (const field of ['artifactSha256', 'sbomSha256', 'buildFlagsSha256', 'componentSha256'] as const) {
    test('rejects stale decision ' + field, () => {
      const f = fixture()
      f.approve()
      requiredFixtureValue(f.manifest.decisions[0], 'decision 0')[field] = '0'.repeat(64)
      expect(f.check().findings).toContainEqual({ code: 'SCOPED_DECISION_REQUIRED', subject: 'workspace:workspace' })
    })
  }
  test('rejects wrong origin, untrusted reviewer, duplicate decisions and rejected outcome', () => {
    const f = fixture()
    for (const mutate of [
      () => { requiredFixtureValue(f.manifest.decisions[0], 'decision 0').origin.path = 'another/file.ts' },
      () => { requiredFixtureValue(f.manifest.decisions[0], 'decision 0').reviewer = 'outsider' },
      () => { f.manifest.decisions.push(structuredClone(requiredFixtureValue(f.manifest.decisions[0], 'decision 0'))) },
      () => { requiredFixtureValue(f.manifest.decisions[0], 'decision 0').outcome = 'rejected' },
    ]) {
      f.approve(); mutate()
      expect(f.check().findings).toContainEqual({ code: 'SCOPED_DECISION_REQUIRED', subject: 'workspace:workspace' })
    }
  })
  test('changed exact build flags invalidate review even when payload stays identical', () => {
    const f = fixture()
    f.approve()
    const artifact = requiredFixtureValue(f.release.artifacts[2], 'artifact 2')
    artifact.buildFlags.enableGplCodec = true
    expect(() => f.check()).toThrow('UNSUPPORTED_BUILD_FLAGS')
    delete artifact.buildFlags.enableGplCodec
    artifact.buildFlags.minify = true
    expect(f.check().findings).toContainEqual({ code: 'SCOPED_DECISION_REQUIRED', subject: 'media:media' })
  })
  test('unknown licenses and absent flags cannot be cleared by approval', () => {
    const f = fixture()
    requiredFixtureValue(f.release.components[2], 'component 2').licenseExpression = null
    requiredFixtureValue(f.release.artifacts[2], 'artifact 2').buildFlags = {}
    // An approved decision cannot invent a license for an unknown component.
    const result = f.check()
    expect(result.findings).toContainEqual({ code: 'LICENSE_REVIEW_REQUIRED', subject: 'media' })
    expect(result.findings).toContainEqual({ code: 'BUILD_FLAGS_MISSING', subject: 'media' })
  })
  test('rejects missing notice bytes, tampered notice hash and unshipped notice', () => {
    const f = fixture()
    f.approve()
    expect(f.check('').findings).toContainEqual({ code: 'NOTICE_TEXT_MISSING', subject: 'LICENSE' })
    writeFileSync(join(f.root, 'LICENSE'), 'changed copyright')
    expect(f.check().findings).toContainEqual({ code: 'NOTICE_DIGEST_MISMATCH', subject: 'LICENSE' })
    requiredFixtureValue(f.release.artifacts[0], 'artifact 0').files = requiredFixtureValue(f.release.artifacts[0], 'artifact 0').files.filter(p => p.path !== 'LICENSE')
    expect(f.check().findings).toContainEqual({ code: 'NOTICE_NOT_SHIPPED', subject: 'workspace:LICENSE' })
  })
  test('undeclared shipped file and altered archive bytes are blocked independently', () => {
    const f = fixture()
    const a = requiredFixtureValue(f.release.artifacts[0], 'artifact 0')
    a.path = 'signed.tar'
    createTar({ cwd: join(f.root, a.contentRoot), file: join(f.root, a.path), sync: true }, ['LICENSE', 'code.js'])
    a.sha256 = artifactDigest(join(f.root, a.path))
    f.approve()
    expect(f.check().state).toBe('REVIEWED_EXACT_ARTIFACT')
    writeFileSync(join(f.root, a.contentRoot, 'unreviewed.ts'), 'copied web source')
    writeFileSync(join(f.root, a.path), 'changed signed archive')
    expect(f.check().findings).toContainEqual({ code: 'ARTIFACT_INVENTORY_MISMATCH', subject: 'workspace' })
    expect(f.check().findings).toContainEqual({ code: 'ARTIFACT_DIGEST_MISMATCH', subject: 'workspace' })
  })
  test('actual archive bytes must equal staged inventory, and arbitrary signed-looking files remain unverified', () => {
    const f = fixture()
    const artifact = requiredFixtureValue(f.release.artifacts[0], 'artifact')
    artifact.path = 'release.tgz'
    createTar({ cwd: join(f.root, artifact.contentRoot), file: join(f.root, artifact.path), sync: true, gzip: true }, ['LICENSE', 'code.js'])
    artifact.sha256 = artifactDigest(join(f.root, artifact.path))
    f.approve()
    expect(f.check().state).toBe('REVIEWED_EXACT_ARTIFACT')
    writeFileSync(join(f.root, artifact.contentRoot, 'code.js'), 'different archive contents')
    artifact.files = inventory(join(f.root, artifact.contentRoot)).map(file => ({ ...file, componentId: 'workspace' }))
    f.approve()
    expect(f.check().findings).toContainEqual({ code: 'ARCHIVE_INVENTORY_MISMATCH', subject: 'workspace' })
    artifact.path = 'signed.dmg'
    writeFileSync(join(f.root, artifact.path), 'unsupported signed-looking artifact')
    artifact.sha256 = artifactDigest(join(f.root, artifact.path))
    f.approve()
    expect(f.check().findings).toContainEqual({ code: 'ARCHIVE_CONTENT_UNVERIFIED', subject: 'workspace' })
  })
  test('archive link metadata, duplicate entries, traversal and malformed bytes never create filesystem links', () => {
    const makeEntry = (path: string, type: 'File' | 'SymbolicLink') => {
      const header = new Header({ path, type, size: 0, mode: 0o644, ...(type === 'SymbolicLink' ? { linkpath: 'outside' } : {}) })
      header.encode()
      return requiredFixtureValue(header.block, 'encoded archive header')
    }
    for (const bytes of [Buffer.from('not an archive'),
      Buffer.concat([makeEntry('../escape', 'File'), Buffer.alloc(1024)]),
      Buffer.concat([makeEntry('link', 'SymbolicLink'), Buffer.alloc(1024)]),
      Buffer.concat([makeEntry('duplicate', 'File'), makeEntry('duplicate', 'File'), Buffer.alloc(1024)])]) {
      expect(() => archiveInventory(bytes)).toThrow()
    }
  })
  test('public build flags reject arbitrary string values before audit serialization', () => {
    const f = fixture()
    const artifact = requiredFixtureValue(f.release.artifacts[0], 'artifact')
    artifact.buildFlags.description = 'PRIVATE_FIXTURE_VALUE_SENTINEL'
    expect(() => f.check()).toThrow('UNSUPPORTED_BUILD_FLAGS')
    delete artifact.buildFlags.description
    artifact.buildFlags.format = 'PRIVATE_FIXTURE_VALUE_SENTINEL'
    expect(() => f.check()).toThrow('UNSUPPORTED_BUILD_FLAGS')
  })
  test('rejects unknown mutation fields, forged actor, duplicate IDs and path escape', () => {
    const f = fixture()
    expect(() => ReleaseSchema.parse({ ...f.release, actor: 'owner' })).toThrow()
    expect(() => DecisionManifestSchema.parse({ ...f.manifest, bypass: true })).toThrow()
    requiredFixtureValue(f.release.artifacts[0], 'artifact 0').contentRoot = '../escape'
    expect(() => f.check()).toThrow()
    requiredFixtureValue(f.release.artifacts[0], 'artifact 0').contentRoot = 'payload-workspace'
    f.release.components.push(structuredClone(requiredFixtureValue(f.release.components[0], 'component 0')))
    expect(() => f.check()).toThrow('DUPLICATE_COMPONENT')
  })
  test('symlink ancestor cannot redirect audited payload outside staging', () => {
    const f = fixture()
    symlinkSync(join(f.root, 'payload-workspace'), join(f.root, 'redirect'))
    requiredFixtureValue(f.release.artifacts[0], 'artifact 0').contentRoot = 'redirect'
    expect(() => f.check()).toThrow('SYMLINK_REVIEW_REQUIRED')
  })
  test('lock or revision drift fails before any approval', () => {
    const f = fixture()
    expect(() => ProduceSBOM(f.release, f.lock + '\n', f.root, sourceRevision, f.manifest)).toThrow('LOCK_DIGEST_MISMATCH')
    expect(() => ProduceSBOM(f.release, f.lock, f.root, 'c'.repeat(40), f.manifest)).toThrow('SOURCE_REVISION_MISMATCH')
    expect(() => parseLock('{ malformed')).toThrow('INVALID_LOCK_JSONC')
  })
  test('SBOM digest is deterministic across producer file/component/artifact ordering', () => {
    const f = fixture()
    f.approve()
    const before = f.check().sbomSha256
    f.release.artifacts.reverse()
    f.release.components.reverse()
    for (const artifact of f.release.artifacts) artifact.files.reverse()
    const after = f.check()
    expect(after.sbomSha256).toBe(before)
    expect(after.state).toBe('REVIEWED_EXACT_ARTIFACT')
  })
  test('unknown file ownership and secret flags fail closed', () => {
    const f = fixture()
    requiredFixtureValue(requiredFixtureValue(f.release.artifacts[0], 'artifact 0').files[0], 'artifact file').componentId = 'unreviewed-plugin'
    expect(f.check().findings).toContainEqual({ code: 'UNKNOWN_COMPONENT', subject: 'workspace:LICENSE' })
    requiredFixtureValue(f.release.artifacts[0], 'artifact 0').buildFlags.OAUTH_CLIENT_SECRET = 'PRIVATE_WP-48'
    expect(() => f.check()).toThrow('SECRET_BUILD_FLAG_FORBIDDEN')
  })
  test('CLI input errors never expose producer paths through filesystem error messages', async () => {
    const f = fixture()
    const script = resolve(import.meta.dir, '../../scripts/compliance/generate-sbom.ts')
    const privatePath = join(f.root, 'PRIVATE_FIXTURE_PATH_SENTINEL.json')
    const child = Bun.spawn([process.execPath, script, 'check', '--release', privatePath, '--root', f.root, '--lock', 'lock', '--decisions', 'decisions', '--notices', 'notices', '--source-revision', sourceRevision, '--review-revision', 'd'.repeat(40), '--auditor-revision', 'e'.repeat(40), '--output', 'output'], { stdout: 'pipe', stderr: 'pipe' })
    expect(await child.exited).toBe(2)
    const error = await new Response(child.stderr).text()
    expect(error.trim()).toBe('COMPLIANCE_AUDIT_FAILED')
    expect(error).not.toContain(privatePath)
    expect(error).not.toContain('PRIVATE_FIXTURE_PATH_SENTINEL')
  })
  test('CLI executes the real audit, reloads disk evidence and returns denial after mutation', async () => {
    const f = fixture()
    f.approve()
    const script = resolve(import.meta.dir, '../../scripts/compliance/generate-sbom.ts')
    writeFileSync(join(f.root, 'release.json'), JSON.stringify(f.release))
    writeFileSync(join(f.root, 'decisions.json'), JSON.stringify(f.manifest))
    writeFileSync(join(f.root, 'bun.lock'), f.lock)
    writeFileSync(join(f.root, 'NOTICES.txt'), f.notice)
    const argv = [process.execPath, script, 'check', '--release', join(f.root, 'release.json'), '--root', f.root, '--lock', join(f.root, 'bun.lock'), '--decisions', join(f.root, 'decisions.json'), '--notices', join(f.root, 'NOTICES.txt'), '--source-revision', sourceRevision, '--review-revision', 'd'.repeat(40), '--auditor-revision', 'e'.repeat(40), '--output', join(f.root, 'audit.json')]
    const first = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' })
    expect(await first.exited).toBe(0)
    const persisted = JSON.parse(readFileSync(join(f.root, 'audit.json'), 'utf8'))
    expect(persisted.state).toBe('REVIEWED_EXACT_ARTIFACT')
    expect(persisted.reviewBinding).toEqual({ reviewRevision: 'd'.repeat(40), auditorRevision: 'e'.repeat(40),
      decisionManifestSha256: sha256(readFileSync(join(f.root, 'decisions.json'))), noticeBundleSha256: sha256(f.notice) })
    writeFileSync(join(f.root, 'payload-media', 'code.js'), 'unreviewed changed codec')
    const second = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' })
    expect(await second.exited).toBe(1)
    const denied = JSON.parse(readFileSync(join(f.root, 'audit.json'), 'utf8'))
    expect(denied.state).toBe('LICENSE_REVIEW_REQUIRED')
    expect(denied.findings).toContainEqual({ code: 'ARTIFACT_DIGEST_MISMATCH', subject: 'media' })
    // Disk-backed audit evidence is not a command/outbox recovery receipt.
  })
})
