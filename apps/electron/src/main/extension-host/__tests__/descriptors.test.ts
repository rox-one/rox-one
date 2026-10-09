/**
 * Descriptor scan (wave-3 c2.5 / f.7).
 *
 * Fixtures: valid / invalid / mixed packages, symlink escape, duplicate roots
 * (first wins) — plus an IMPORT SPY proving the scan never executes package
 * code (the entry writes a sentinel file only when imported).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSandboxExtensionDescriptors } from '../descriptors'

const SPY_MARKER = join(tmpdir(), 'rox-descriptor-spy-marker')

let tmp: string
let configDir: string
let sandboxRoot: string
let envRoot: string
const previousSandboxRoot = process.env.CRAFT_EXTENSION_SANDBOX_ROOT

function writePackage(
  root: string,
  name: string,
  manifest: unknown,
  entry = 'export const commands = []\n',
): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(dir, 'index.js'), entry)
  return dir
}

const validManifest = (id: string) => ({
  id,
  name: id,
  version: '1.0.0',
  runtime: 'craft-sandbox',
  permissions: [],
})

beforeEach(() => {
  delete process.env.DESCRIPTOR_SPY_MARKER
  if (existsSync(SPY_MARKER)) rmSync(SPY_MARKER, { force: true })
  tmp = mkdtempSync(join(tmpdir(), 'rox-descriptors-'))
  configDir = join(tmp, 'config')
  sandboxRoot = join(configDir, 'extensions', 'sandbox')
  envRoot = join(tmp, 'env-sandbox')
  mkdirSync(sandboxRoot, { recursive: true })
  mkdirSync(envRoot, { recursive: true })
  delete process.env.CRAFT_EXTENSION_SANDBOX_ROOT
})

afterEach(() => {
  if (previousSandboxRoot === undefined) delete process.env.CRAFT_EXTENSION_SANDBOX_ROOT
  else process.env.CRAFT_EXTENSION_SANDBOX_ROOT = previousSandboxRoot
  delete process.env.DESCRIPTOR_SPY_MARKER
  if (existsSync(SPY_MARKER)) rmSync(SPY_MARKER, { force: true })
  rmSync(tmp, { recursive: true, force: true })
})

function scan() {
  return loadSandboxExtensionDescriptors({ configDir, sandboxRootEnv: envRoot })
}

describe('loadSandboxExtensionDescriptors', () => {
  it('returns a valid descriptor with runtime, entry path and hash', () => {
    writePackage(sandboxRoot, 'alpha', validManifest('alpha'))
    const descriptors = scan()
    expect(descriptors).toHaveLength(1)
    const alpha = descriptors[0]!
    expect(alpha.status).toBe('ok')
    expect(alpha.id).toBe('alpha')
    expect(alpha.runtime).toBe('craft-sandbox')
    expect(alpha.entryPath).toBe(realpathSync(join(sandboxRoot, 'alpha', 'index.js')))
    expect(alpha.descriptorHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('never executes package code (import spy marker absent)', () => {
    process.env.DESCRIPTOR_SPY_MARKER = SPY_MARKER
    writePackage(
      sandboxRoot,
      'spy',
      validManifest('spy'),
      "import { writeFileSync } from 'node:fs'\n" +
        'writeFileSync(process.env.DESCRIPTOR_SPY_MARKER, "executed")\n' +
        'export const commands = []\n',
    )
    const descriptors = scan()
    expect(descriptors[0]?.status).toBe('ok')
    expect(existsSync(SPY_MARKER)).toBe(false)
  })

  it('flags an invalid package and keeps scanning the rest of the batch', () => {
    writePackage(sandboxRoot, 'bad', { ...validManifest('bad'), runtime: 'not-a-runtime' })
    writePackage(sandboxRoot, 'good', validManifest('good'))
    const descriptors = scan()
    expect(descriptors).toHaveLength(2)
    const bad = descriptors.find((d) => d.id === 'bad')!
    const good = descriptors.find((d) => d.id === 'good')!
    expect(bad.status).toBe('invalid')
    expect(bad.issues?.length).toBeGreaterThan(0)
    expect(good.status).toBe('ok')
  })

  it('rejects a symlinked package that escapes the sandbox root', () => {
    const outside = join(tmp, 'outside')
    writePackage(outside, 'evil', validManifest('evil'))
    symlinkSync(join(outside, 'evil'), join(sandboxRoot, 'evil'))

    const descriptors = scan()
    const evil = descriptors.find((d) => d.dir.endsWith('evil'))!
    expect(evil.status).toBe('invalid')
    expect(evil.issues?.[0]).toMatch(/package-outside-sandbox/)
  })

  it('rejects a symlinked entry that escapes an allowlisted package', () => {
    const dir = writePackage(sandboxRoot, 'linked', validManifest('linked'))
    const outsideEntry = join(tmp, 'outside-entry.js')
    writeFileSync(outsideEntry, 'export const commands = []\n')
    rmSync(join(dir, 'index.js'))
    symlinkSync(outsideEntry, join(dir, 'index.js'))

    const descriptors = scan()
    const linked = descriptors.find((d) => d.id === 'linked')!
    expect(linked.status).toBe('invalid')
    expect(linked.issues?.[0]).toMatch(/entryPath-rejected/)
  })

  it('flags a missing entry module', () => {
    const dir = join(sandboxRoot, 'noentry')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(validManifest('noentry')))
    const descriptors = scan()
    const noentry = descriptors.find((d) => d.id === 'noentry')!
    expect(noentry.status).toBe('invalid')
    expect(noentry.issues).toEqual(['missingEntry'])
  })

  it('keeps the first id and flags later duplicates as shadowed', () => {
    writePackage(sandboxRoot, 'dup', validManifest('dup'))
    writePackage(envRoot, 'dup-env', validManifest('dup'))

    const descriptors = scan()
    expect(descriptors).toHaveLength(2)
    const first = descriptors.find((d) => d.dir === join(sandboxRoot, 'dup'))!
    const shadowed = descriptors.find((d) => d.dir === join(envRoot, 'dup-env'))!
    expect(first.status).toBe('ok')
    expect(shadowed.status).toBe('invalid')
    expect(shadowed.issues?.[0]).toBe(`shadowed:${join(sandboxRoot, 'dup')}`)
  })

  it('is stable: identical content yields an identical hash', () => {
    writePackage(sandboxRoot, 'stable', validManifest('stable'))
    const first = scan()[0]!.descriptorHash
    const second = scan()[0]!.descriptorHash
    expect(second).toBe(first)
  })
})