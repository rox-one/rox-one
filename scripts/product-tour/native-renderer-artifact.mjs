import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

/** @typedef {{ directory: string, names: string[] }} Inventory */
/** @typedef {{ script: string, spinnerLayout: string, sources: Map<string, string>, absentControls: string[], virtualInputs: string[], inventories: Inventory[], esbuildVersion: string }} BuiltRenderer */
/** @typedef {BuiltRenderer & { manifestDigest?: string, outputDigest: string, directory?: string, buildKind: 'fresh' | 'reused' }} RendererArtifact */

export const digest = content => createHash('sha256').update(content).digest('hex')
export const fileDigest = async path => digest(await readFile(path))
export const createFreshRendererDirectory = (base = tmpdir()) => mkdtemp(join(base, 'rox-file-dialog-renderer-'))

/** Bind the parent to the digests reported by its verified passing child. */
export async function adoptVerifiedRendererArtifact(directory, verified) {
  if (!/^[a-f0-9]{64}$/.test(verified.manifestDigest ?? '') || !/^[a-f0-9]{64}$/.test(verified.outputDigest ?? '')) {
    throw new Error('Passing child did not bind a renderer artifact')
  }
  if (await fileDigest(join(directory, 'renderer.json')) !== verified.manifestDigest) throw new Error('Renderer manifest changed before parent adoption')
  if (await fileDigest(join(directory, 'renderer.js')) !== verified.outputDigest) throw new Error('Renderer output changed before parent adoption')
  return verified.manifestDigest
}

/** Bind dependency-resolution manifests as well as actual esbuild inputs. */
export async function bindRendererControls(sources, controls) {
  const directories = new Set()
  const absentControls = []
  for (const path of [...sources.keys(), ...controls]) {
    for (let directory = dirname(path); !directories.has(directory); directory = dirname(directory)) {
      directories.add(directory)
      if (dirname(directory) === directory) break
    }
  }
  for (const path of controls) sources.set(path, await fileDigest(path))
  for (const directory of directories) {
    const path = join(directory, 'package.json')
    try { sources.set(path, await fileDigest(path)) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      absentControls.push(path)
    }
  }
  return absentControls.sort()
}

/** @param {BuiltRenderer} artifact */
async function verifyInputs(artifact) {
  for (const [path, expected] of artifact.sources) {
    if (await fileDigest(path) !== expected) throw new Error(`Renderer input changed: ${path}`)
  }
  for (const path of artifact.absentControls) {
    try { await access(path) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    throw new Error(`Renderer resolution control appeared: ${path}`)
  }
  for (const { directory, names } of artifact.inventories) {
    const actual = (await readdir(directory)).filter(name => name.endsWith('.json')).sort()
    if (JSON.stringify(actual) !== JSON.stringify(names)) throw new Error(`Renderer inventory changed: ${directory}`)
  }
}

/** A later child may use only the manifest adopted by its passing predecessor.
 * No stale artifact is rebuilt or repaired: a missing/tampered input fails.
 * @param {string} directory
 * @param {string | undefined} expectedDigest
 * @returns {Promise<RendererArtifact | null>}
 */
async function readOwnedArtifact(directory, expectedDigest) {
  let content
  try { content = await readFile(join(directory, 'renderer.json')) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (expectedDigest) throw new Error('Owned renderer manifest is missing')
    for (const name of ['renderer.js', 'renderer-claim']) {
      try { await access(join(directory, name)) }
      catch (error) { if (error.code === 'ENOENT') continue; throw error }
      throw new Error('Refusing a partial or previously claimed renderer artifact')
    }
    return null
  }
  if (!expectedDigest) throw new Error('Refusing a renderer artifact from another invocation')
  if (digest(content) !== expectedDigest) throw new Error('Owned renderer manifest changed')
  const manifest = JSON.parse(content.toString())
  if (manifest.version !== 1) throw new Error('Unsupported renderer artifact')
  const script = await readFile(join(directory, 'renderer.js'), 'utf8')
  if (digest(script) !== manifest.outputDigest) throw new Error('Renderer output changed')
  const artifact = { ...manifest, script, sources: new Map(Object.entries(manifest.sources)),
    directory, manifestDigest: expectedDigest, buildKind: /** @type {const} */ ('reused') }
  await verifyInputs(artifact)
  return artifact
}

/** @param {string | undefined} directory
 * @param {string | undefined} expectedDigest
 * @param {() => Promise<BuiltRenderer>} compile
 * @returns {Promise<RendererArtifact>}
 */
export async function loadOrBuildRendererArtifact(directory, expectedDigest, compile) {
  if (directory) {
    const existing = await readOwnedArtifact(directory, expectedDigest)
    if (existing) return existing
  } else if (expectedDigest) throw new Error('Owned renderer directory is missing')
  if (directory) await writeFile(join(directory, 'renderer-claim'), 'One fresh build belongs to this invocation.\n', { flag: 'wx' })
  const built = await compile()
  await verifyInputs(built)
  const outputDigest = digest(built.script)
  if (!directory) return { ...built, outputDigest, buildKind: 'fresh' }
  const { script, sources, ...metadata } = built
  const manifest = JSON.stringify({ version: 1, ...metadata, sources: Object.fromEntries(sources), outputDigest }) + '\n'
  // The directory is unique to this parent. Exclusive writes forbid adoption or
  // overwrite of a partial/foreign artifact instead of silently rebuilding it.
  await writeFile(join(directory, 'renderer.js'), script, { flag: 'wx' })
  await writeFile(join(directory, 'renderer.json'), manifest, { flag: 'wx' })
  const verified = await readOwnedArtifact(directory, digest(manifest))
  return { ...verified, buildKind: 'fresh' }
}

/** @param {RendererArtifact} artifact */
export async function verifyRendererArtifact(artifact) {
  if (artifact.directory) await readOwnedArtifact(artifact.directory, artifact.manifestDigest)
  else {
    if (digest(artifact.script) !== artifact.outputDigest) throw new Error('Renderer output changed')
    await verifyInputs(artifact)
  }
}
