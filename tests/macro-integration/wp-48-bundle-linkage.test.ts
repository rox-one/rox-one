import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { create as createTar } from 'tar'
import { collect } from '../../scripts/compliance/collect-build-attribution'
import { verifyPackageArchive } from '../../scripts/compliance/verify-registry-attribution'
import { CheckRelease, ProduceSBOM, ValidateBundleLinkage, bundleScopeDigest, artifactDigest, canonical, componentDigest, fileComponentIds, inventory, sha256, type DecisionManifest, type Release } from '../../scripts/compliance/generate-sbom'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function required<T>(value: T | undefined): T { if (value === undefined) throw new Error('Missing fixture'); return value }
async function fixture(multipleOutputs = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wp48-link-'))); roots.push(root)
  const source = join(root, 'source'); const workspace = join(source, 'packages/service'); const dependency = join(source, 'node_modules/fixture-dep'); const output = join(source, 'dist'); const payload = join(root, 'payload')
  for (const path of [workspace, dependency, output, payload]) mkdirSync(path, { recursive: true })
  const notice = 'MIT License\nCopyright fixture only\n'
  writeFileSync(join(root, 'LICENSE'), notice); writeFileSync(join(source, 'LICENSE'), notice)
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: '@fixture/service', version: '1.0.0', license: 'MIT' }))
  writeFileSync(join(workspace, 'index.ts'), "import { external } from 'fixture-dep'; export const local = external + 'local fixture'; console.log(local)")
  writeFileSync(join(dependency, 'package.json'), JSON.stringify({ name: 'fixture-dep', version: '2.0.0', main: 'index.js', license: 'MIT' }))
  writeFileSync(join(dependency, 'index.js'), "export const external = 'registry fixture';")
  writeFileSync(join(dependency, 'LICENSE'), notice)
  const packageRoot = join(root, 'registry/package'); mkdirSync(packageRoot, { recursive: true }); cpSync(dependency, packageRoot, { recursive: true })
  await createTar({ cwd: join(root, 'registry'), file: join(root, 'registry.tgz'), gzip: true, portable: true }, ['package'])
  const archive = readFileSync(join(root, 'registry.tgz')); const integrity = 'sha512-' + createHash('sha512').update(archive).digest('base64')
  const lock = JSON.stringify({ lockfileVersion: 1, workspaces: { 'packages/service': { name: '@fixture/service', version: '1.0.0' } }, packages: { 'fixture-dep': ['fixture-dep@2.0.0', '', {}, integrity] } })
  writeFileSync(join(source, 'bun.lock'), lock)
  if (multipleOutputs) writeFileSync(join(workspace, 'other.ts'), "export const second = 'workspace only fixture'; console.log(second)")
  const processResult = Bun.spawnSync([process.execPath, 'build', './index.ts', ...(multipleOutputs ? ['./other.ts'] : []), '--target=bun', '--format=esm', '--outdir=' + output, '--metafile=' + join(output, 'meta.json')], { cwd: workspace, stdout: 'pipe', stderr: 'pipe' })
  if (processResult.exitCode !== 0) throw new Error(processResult.stderr.toString())
  const evidence = collect({ root: source, buildCwd: workspace, outputRoot: output, metafile: join(output, 'meta.json'), lock: join(source, 'bun.lock'), toolsRoot: process.cwd() })
  for (const emitted of evidence.outputs) cpSync(join(source, emitted.path), join(payload, relative(output, join(source, emitted.path)))); writeFileSync(join(payload, 'LICENSE'), notice)
  const components: Release['components'] = evidence.packages.map((pkg, index) => ({ id: 'component-' + index, kind: pkg.root.includes('node_modules') ? 'dependency' : 'workspace', name: pkg.name, version: pkg.version, ...(pkg.root.includes('node_modules') ? { lockKey: 'fixture-dep', integrity } : {}), licenseExpression: 'MIT', origin: { repository: 'fixture-only', revision: 'b'.repeat(40), path: pkg.root + '/package.json', sha256: pkg.manifestSha256, modifications: '', transfer: 'independent' }, notices: [{ path: 'LICENSE', sha256: sha256(notice) }] }))
  const contributions = evidence.packages.map((pkg, index) => {
    const registryProof = pkg.root.includes('node_modules') ? verifyPackageArchive(pkg, archive) : null
    return { componentId: required(components[index]).id, scopeSha256: bundleScopeDigest(pkg, evidence.lockSha256, registryProof), inputs: pkg.inputs.filter(input => input.bytesInOutput > 0).map(input => ({ path: input.path, sha256: input.sha256, bytesInOutput: input.bytesInOutput })) }
  })
  await createTar({ cwd: payload, file: join(root, 'release.tgz'), gzip: true, portable: true }, inventory(payload).map(file => file.path))
  const artifact: Release['artifacts'][number] = { id: 'service', kind: 'workspace', path: 'release.tgz', contentRoot: 'payload', sha256: sha256(readFileSync(join(root, 'release.tgz'))), platform: 'darwin', arch: 'arm64', buildFlags: { format: 'esm', minify: false, bundled: true }, files: inventory(payload).map(file => file.path.endsWith('.js') ? { ...file, contributions: contributions.flatMap(c => { const meta = JSON.parse(readFileSync(join(output, 'meta.json'), 'utf8')) as { outputs: Record<string, { inputs: Record<string, { bytesInOutput: number }> }> }; const graph = required(Object.entries(meta.outputs).find(([path]) => path.replace(/^\.\//, '') === file.path)?.[1]); const inputs = c.inputs.flatMap(input => { const row = Object.entries(graph.inputs).find(([path]) => relative(workspace, join(source, input.path)) === path.replace(/^\.\//, ''))?.[1]; return row && row.bytesInOutput > 0 ? [{ ...input, bytesInOutput: row.bytesInOutput }] : [] }); return inputs.length ? [{ ...c, inputs }] : [] }) } : { ...file, componentId: required(components[0]).id }), bundle: { sourceRoot: 'source', sourceSha256: artifactDigest(source), buildCwd: 'packages/service', outputRoot: 'dist', lock: { path: 'bun.lock', sha256: sha256(lock) }, metafile: { path: 'dist/meta.json', sha256: evidence.metafileSha256 }, scopes: evidence.packages.map((pkg, index) => ({ componentId: required(components[index]).id, root: pkg.root, manifestSha256: pkg.manifestSha256, ...(pkg.root.includes('node_modules') ? { registryArchive: { path: 'registry.tgz', sha256: sha256(archive) } } : {}) })) } }
  const release: Release = { schemaVersion: 1, sourceRevision: 'a'.repeat(40), lockSha256: sha256(lock), artifacts: [artifact], components }
  const manifest: DecisionManifest = { schemaVersion: 1, policy: 'LICENSE_REVIEW_REQUIRED', reviewers: ['fixture-qualified-reviewer'], requiredBundleArtifacts: ['service'], preservedNotices: [], knownScopes: [], decisions: [] }
  function approve() { const produced = ProduceSBOM(release, lock, root, release.sourceRevision, manifest); manifest.decisions = [...new Set(artifact.files.flatMap(fileComponentIds))].map(id => { const component = required(components.find(c => c.id === id)); return { artifactId: artifact.id, artifactSha256: artifact.sha256, sbomSha256: produced.sbomSha256, buildFlagsSha256: sha256(canonical(artifact.buildFlags)), componentId: id, componentSha256: componentDigest(release, component), origin: component.origin, licenseExpression: 'MIT', notices: component.notices, reviewer: 'fixture-qualified-reviewer', reviewedAt: '2026-09-30T00:00:00Z', outcome: 'approved', evidence: 'SYNTHETIC FIXTURE ONLY; no product approval' } }) }
  const check = () => CheckRelease(release, lock, root, release.sourceRevision, manifest, notice)
  return { root, source, workspace, dependency, release, artifact, components, manifest, approve, check, lock, contributions }
}
test('actual Bun mixed bundle and final tar bind both exact scopes; approval is separately required', async () => {
  const f = await fixture(); expect(ValidateBundleLinkage(f.release, f.artifact, f.lock, f.root)).toEqual([])
  expect(f.contributions.length).toBe(2); expect(f.contributions.every(c => c.inputs.length > 0)).toBe(true)
  expect(f.check().state).toBe('LICENSE_REVIEW_REQUIRED'); expect(f.check().findings.filter(x => x.code === 'SCOPED_DECISION_REQUIRED')).toHaveLength(2)
  f.approve(); expect(f.check().state).toBe('REVIEWED_EXACT_ARTIFACT'); expect(f.check().findings).toEqual([])
  const before = componentDigest(f.release, required(f.components[0])); required(f.artifact.bundle).sourceSha256 = 'c'.repeat(64); expect(componentDigest(f.release, required(f.components[0]))).not.toBe(before)
})
test('missing and single-owner claims fail closed for explicitly bundled producer', async () => {
  const f = await fixture(); delete f.artifact.bundle
  const file = required(f.artifact.files.find(x => x.contributions)); delete file.contributions; file.componentId = required(f.components[0]).id
  expect(f.check().findings).toContainEqual({ code: 'BUNDLE_PROOF_REQUIRED', subject: 'service' })
})
test('deleted scope/input, duplicated component and unknown scope cannot get scoped approval', async () => {
  const f = await fixture(); const file = required(f.artifact.files.find(x => x.contributions)); const original = structuredClone(required(file.contributions))
  file.contributions = original.slice(0, 1); expect(f.check().findings.some(x => x.code === 'BUNDLE_CONTRIBUTIONS_MISMATCH')).toBe(true)
  file.contributions = [required(original[0]), required(original[0])]; expect(f.check().findings.some(x => x.code === 'BUNDLE_PROOF_UNVERIFIED')).toBe(true)
  file.contributions = original; required(required(f.artifact.bundle).scopes[0]).componentId = 'unknown'; expect(f.check().findings.some(x => x.code === 'BUNDLE_SCOPE_IDENTITY_MISMATCH')).toBe(true)
})
test('same length source alteration and metafile claim changes are independently bound', async () => {
  const f = await fixture(); const path = join(f.dependency, 'index.js'); const source = readFileSync(path); writeFileSync(path, source.toString().replace('registry', 'tampered'))
  expect(f.check().findings.some(x => x.code === 'BUNDLE_SOURCE_DIGEST_MISMATCH')).toBe(true)
  expect(f.check().findings.some(x => x.code === 'BUNDLE_REGISTRY_BYTES_MISMATCH')).toBe(true)
  writeFileSync(path, source); required(f.artifact.bundle).metafile.sha256 = 'c'.repeat(64); expect(f.check().findings.some(x => x.code === 'BUNDLE_METAFILE_MISMATCH')).toBe(true)
})
test('registry archive tamper fails even after archive claim hash refresh', async () => {
  const f = await fixture(); const archive = readFileSync(join(f.root, 'registry.tgz')); archive[10] = (archive[10] ?? 0) ^ 1; writeFileSync(join(f.root, 'registry.tgz'), archive)
  const scope = required(required(f.artifact.bundle).scopes.find(x => x.registryArchive)); required(scope.registryArchive).sha256 = sha256(archive)
  expect(f.check().findings.some(x => x.code === 'BUNDLE_PROOF_UNVERIFIED')).toBe(true)
})
test('final emitted program cannot be replaced while only graph and source proofs remain valid', async () => {
  const f = await fixture(); writeFileSync(join(f.root, 'payload/index.js'), 'tampered emitted bytes')
  expect(f.check().findings.some(x => x.code === 'ARTIFACT_INVENTORY_MISMATCH')).toBe(true)
})

test('multiple actual outputs retain only the scopes emitted in each file', async () => {
  const f = await fixture(true); expect(ValidateBundleLinkage(f.release, f.artifact, f.lock, f.root)).toEqual([])
  expect(fileComponentIds(required(f.artifact.files.find(file => file.path === 'other.js')))).toHaveLength(1)
  expect(fileComponentIds(required(f.artifact.files.find(file => file.path === 'index.js')))).toHaveLength(2)
  f.approve(); expect(f.check().findings).toEqual([])
})
test('workspace lock name/version forgery is rejected after refreshing all outer digests', async () => {
  const f = await fixture(); const parsed = JSON.parse(f.lock) as { workspaces: Record<string, { name: string; version: string }> }; required(parsed.workspaces['packages/service']).version = '9.0.0'
  const lock = JSON.stringify(parsed); writeFileSync(join(f.source, 'bun.lock'), lock); f.release.lockSha256 = sha256(lock); required(f.artifact.bundle).lock.sha256 = sha256(lock); required(f.artifact.bundle).sourceSha256 = artifactDigest(f.source)
  expect(ValidateBundleLinkage(f.release, f.artifact, lock, f.root).some(x => x.code === 'BUNDLE_WORKSPACE_SCOPE_MISMATCH')).toBe(true)
})
test('physical path aliases in producer outputs are ambiguous even with refreshed graph hash', async () => {
  const f = await fixture(); const path = join(f.source, 'dist/meta.json'); const meta = JSON.parse(readFileSync(path, 'utf8')) as { outputs: Record<string, unknown> }; const first = required(Object.values(meta.outputs)[0]); meta.outputs['index.js'] = first; meta.outputs['./index.js'] = first; writeFileSync(path, JSON.stringify(meta)); required(f.artifact.bundle).metafile.sha256 = sha256(readFileSync(path)); required(f.artifact.bundle).sourceSha256 = artifactDigest(f.source)
  expect(f.check().findings.some(x => x.code === 'BUNDLE_PROOF_UNVERIFIED')).toBe(true)
})

test('independent trusted review policy denies producer disabling the bundled flag and proof', async () => {
  const f = await fixture(); delete f.artifact.bundle; f.artifact.buildFlags.bundled = false
  for (const file of f.artifact.files) { delete file.contributions; file.componentId = required(f.components[0]).id }
  expect(f.check().findings).toContainEqual({ code: 'TRUSTED_BUNDLE_POLICY_REQUIRED', subject: 'service' })
  f.manifest.requiredBundleArtifacts = ['missing-final-artifact']; expect(f.check().findings).toContainEqual({ code: 'TRUSTED_BUNDLE_POLICY_REQUIRED', subject: 'missing-final-artifact' })
})

test('scope, contribution and input producer ordering cannot change exact review digest', async () => {
  const f = await fixture(); f.approve(); const before = f.check(); required(f.artifact.bundle).scopes.reverse()
  for (const file of f.artifact.files) { file.contributions?.reverse(); for (const contribution of file.contributions ?? []) contribution.inputs.reverse() }
  const after = f.check(); expect(after.sbomSha256).toBe(before.sbomSha256); expect(after.state).toBe('REVIEWED_EXACT_ARTIFACT')
})
test('negative control: installed single-owner checker clears a real dependency bundle hidden under workspace ownership', async () => {
  const f = await fixture()
  type LegacyAuditPort = Pick<typeof import('../../scripts/compliance/generate-sbom'), 'ProduceSBOM' | 'CheckRelease' | 'componentDigest'>
  const legacy = await import(join(process.cwd(), 'scripts/compliance/generate-sbom.ts')) as LegacyAuditPort
  const component = required(f.components.find(c => c.kind === 'workspace'))
  f.release.components = [component]; delete f.artifact.bundle; delete f.artifact.buildFlags.bundled; delete f.manifest.requiredBundleArtifacts
  for (const file of f.artifact.files) { delete file.contributions; file.componentId = component.id }
  const produced = legacy.ProduceSBOM(f.release, f.lock, f.root, f.release.sourceRevision, f.manifest)
  f.manifest.decisions = [{ artifactId: f.artifact.id, artifactSha256: f.artifact.sha256, sbomSha256: produced.sbomSha256, buildFlagsSha256: sha256(canonical(f.artifact.buildFlags)), componentId: component.id, componentSha256: legacy.componentDigest(f.release, component), origin: component.origin, licenseExpression: 'MIT', notices: component.notices, reviewer: 'fixture-qualified-reviewer', reviewedAt: '2026-09-30T00:00:00Z', outcome: 'approved', evidence: 'NEGATIVE CONTROL fixture only: original checker wrongly omits dependency' }]
  expect(legacy.CheckRelease(f.release, f.lock, f.root, f.release.sourceRevision, f.manifest, readFileSync(join(f.root, 'LICENSE'), 'utf8')).state).toBe('REVIEWED_EXACT_ARTIFACT')
  f.manifest.requiredBundleArtifacts = ['service']; expect(f.check().findings).toContainEqual({ code: 'TRUSTED_BUNDLE_POLICY_REQUIRED', subject: 'service' }); expect(f.check().state).toBe('LICENSE_REVIEW_REQUIRED')
})

test('claimed input hash, scope digest and duplicate input contributions cannot be approved', async () => {
  const f = await fixture(); const file = required(f.artifact.files.find(x => x.contributions)); const contribution = required(required(file.contributions)[0]); const input = required(contribution.inputs[0]); const originalHash = input.sha256
  input.sha256 = 'c'.repeat(64); expect(f.check().findings.some(x => x.code === 'BUNDLE_CONTRIBUTIONS_MISMATCH')).toBe(true); input.sha256 = originalHash
  const scopeHash = contribution.scopeSha256; contribution.scopeSha256 = 'd'.repeat(64); expect(f.check().findings.some(x => x.code === 'BUNDLE_CONTRIBUTIONS_MISMATCH')).toBe(true); contribution.scopeSha256 = scopeHash
  contribution.inputs.push(structuredClone(input)); expect(f.check().findings.some(x => x.code === 'BUNDLE_CONTRIBUTIONS_MISMATCH')).toBe(true)
})
