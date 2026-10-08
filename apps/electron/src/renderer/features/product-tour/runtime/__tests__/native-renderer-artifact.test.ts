import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { adoptVerifiedRendererArtifact, bindRendererControls, createFreshRendererDirectory, digest, fileDigest,
  loadOrBuildRendererArtifact, verifyRendererArtifact } from '../../../../../../../../scripts/product-tour/native-renderer-artifact.mjs'

const temporary: string[] = []
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }) })

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'rox-renderer-artifact-proof-'))
  temporary.push(base)
  const themes = join(base, 'themes')
  await mkdir(themes)
  await mkdir(join(base, 'nested'))
  const paths = { source: join(base, 'nested', 'renderer.ts'), tsconfig: join(base, 'tsconfig.json'), lock: join(base, 'bun.lock'),
    package: join(base, 'package.json'), helper: join(base, 'plugin.mjs'), css: join(base, 'style.css'), theme: join(themes, 'dark.json') }
  for (const [name, path] of Object.entries(paths)) await writeFile(path, JSON.stringify({ name, current: true }))
  const directory = await createFreshRendererDirectory(base)
  let builds = 0
  const compile = async () => {
    builds++
    const sources = new Map<string, string>()
    for (const path of [paths.source, paths.css, paths.theme]) sources.set(path, await fileDigest(path))
    const absentControls = await bindRendererControls(sources, [paths.tsconfig, paths.lock, paths.package, paths.helper])
    return { script: `// Actual fixture source bytes\n${await readFile(paths.source, 'utf8')}`, spinnerLayout: '.spinner{position:relative}',
      sources, absentControls, virtualInputs: [], inventories: [{ directory: themes, names: ['dark.json'] }], esbuildVersion: 'unit-fixture' }
  }
  const built = await loadOrBuildRendererArtifact(directory, undefined, compile)
  const adopted = await adoptVerifiedRendererArtifact(directory, built)
  return { base, themes, paths, directory, compile, built, adopted, builds: () => builds }
}

test('one invocation builds fresh once and verifies the same output and inputs for reuse', async () => {
  const f = await fixture()
  const reused = await loadOrBuildRendererArtifact(f.directory, f.adopted, f.compile)
  expect(f.built.buildKind).toBe('fresh')
  expect(reused.buildKind).toBe('reused')
  expect(reused.script).toBe(f.built.script)
  expect(reused.outputDigest).toBe(f.built.outputDigest)
  expect(reused.sources.get(f.paths.package)).toBe(await fileDigest(f.paths.package))
  await verifyRendererArtifact(reused)
  expect(f.builds()).toBe(1)
})

for (const kind of ['source', 'tsconfig', 'lock', 'package', 'helper', 'css', 'theme'] as const) {
  test(`a changed actual ${kind} input fails reuse without rebuilding`, async () => {
    const f = await fixture()
    await writeFile(f.paths[kind], 'Changed after the verified build')
    await expect(loadOrBuildRendererArtifact(f.directory, f.adopted, f.compile)).rejects.toThrow('Renderer input changed')
    expect(f.builds()).toBe(1)
  })
}

test('tampering with the served JS output fails rather than rebuilding it', async () => {
  const f = await fixture()
  await writeFile(join(f.directory, 'renderer.js'), 'export const substituted = true')
  await expect(loadOrBuildRendererArtifact(f.directory, f.adopted, f.compile)).rejects.toThrow('Renderer output changed')
  expect(f.builds()).toBe(1)
})

test('a newly added actual theme refuses reuse even when all old theme files are unchanged', async () => {
  const f = await fixture()
  await writeFile(join(f.themes, 'new.json'), '{}')
  await expect(loadOrBuildRendererArtifact(f.directory, f.adopted, f.compile)).rejects.toThrow('Renderer inventory changed')
  expect(f.builds()).toBe(1)
})

test('a deleted actual theme refuses reuse without falling back to a fresh build', async () => {
  const f = await fixture()
  await rm(f.paths.theme)
  await expect(loadOrBuildRendererArtifact(f.directory, f.adopted, f.compile)).rejects.toThrow()
  expect(f.builds()).toBe(1)
})

test('a changed manifest cannot attest its own substituted input hash', async () => {
  const f = await fixture()
  await writeFile(f.paths.source, 'substituted input')
  const manifestPath = join(f.directory, 'renderer.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.sources[f.paths.source] = await fileDigest(f.paths.source)
  await writeFile(manifestPath, JSON.stringify(manifest) + '\n')
  await expect(loadOrBuildRendererArtifact(f.directory, f.adopted, f.compile)).rejects.toThrow('Owned renderer manifest changed')
  expect(f.builds()).toBe(1)
})

for (const kind of ['manifest', 'output'] as const) {
  test(`a changed ${kind} between passing child verification and parent adoption is rejected`, async () => {
    const f = await fixture()
    const path = join(f.directory, kind === 'manifest' ? 'renderer.json' : 'renderer.js')
    await writeFile(path, (await readFile(path, 'utf8')) + ' ')
    await expect(adoptVerifiedRendererArtifact(f.directory, f.built)).rejects.toThrow(`Renderer ${kind} changed before parent adoption`)
    expect(f.builds()).toBe(1)
  })
}

test('a missing adopted artifact fails instead of silently compiling a replacement', async () => {
  const f = await fixture()
  await rm(join(f.directory, 'renderer.json'))
  await expect(loadOrBuildRendererArtifact(f.directory, f.adopted, f.compile)).rejects.toThrow('Owned renderer manifest is missing')
  expect(f.builds()).toBe(1)
})

test('separate outer invocations create unique directories and cannot adopt an earlier artifact', async () => {
  const f = await fixture()
  const successor = await createFreshRendererDirectory(f.base)
  expect(successor).not.toBe(f.directory)
  await expect(loadOrBuildRendererArtifact(f.directory, undefined, f.compile)).rejects.toThrow('another invocation')
  await expect(loadOrBuildRendererArtifact(successor, f.adopted, f.compile)).rejects.toThrow('Owned renderer manifest is missing')
  const fresh = await loadOrBuildRendererArtifact(successor, undefined, f.compile)
  expect(fresh.buildKind).toBe('fresh')
  expect(f.builds()).toBe(2)
})

test('post-case verification detects a source changed while the browser was using the closed artifact', async () => {
  const f = await fixture()
  await writeFile(f.paths.source, 'Changed during the actual case')
  await expect(verifyRendererArtifact(f.built)).rejects.toThrow('Renderer input changed')
  expect(f.builds()).toBe(1)
  expect(digest(f.built.script)).toBe(f.built.outputDigest)
})

test('a failed first compile claims the invocation so a later case cannot retry it', async () => {
  const base = await mkdtemp(join(tmpdir(), 'rox-failed-artifact-proof-'))
  temporary.push(base)
  const directory = await createFreshRendererDirectory(base)
  let calls = 0
  const fail = async () => { calls++; throw new Error('Actual first build failed') }
  await expect(loadOrBuildRendererArtifact(directory, undefined, fail)).rejects.toThrow('Actual first build failed')
  await expect(loadOrBuildRendererArtifact(directory, undefined, fail)).rejects.toThrow('previously claimed')
  expect(calls).toBe(1)
})

test('a JS-only artifact is rejected before any compile begins', async () => {
  const base = await mkdtemp(join(tmpdir(), 'rox-partial-artifact-proof-'))
  temporary.push(base)
  const directory = await createFreshRendererDirectory(base)
  await writeFile(join(directory, 'renderer.js'), 'A prior incomplete or foreign output')
  let calls = 0
  const compile = async () => { calls++; throw new Error('Must not compile') }
  await expect(loadOrBuildRendererArtifact(directory, undefined, compile)).rejects.toThrow('partial')
  expect(calls).toBe(0)
})

test('a previously absent package resolution manifest cannot appear after the verified build', async () => {
  const f = await fixture()
  const added = join(f.base, 'nested', 'package.json')
  expect(f.built.absentControls).toContain(added)
  await writeFile(added, '{"type":"module","sideEffects":false}')
  await expect(loadOrBuildRendererArtifact(f.directory, f.adopted, f.compile)).rejects.toThrow('resolution control appeared')
  await expect(verifyRendererArtifact(f.built)).rejects.toThrow('resolution control appeared')
  expect(f.builds()).toBe(1)
})
