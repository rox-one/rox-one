import { afterEach, describe, expect, it } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  assertNotesImportPaths,
  getConfigDir,
  isImportProvenancedRelativePath,
  setOwnedRootAdapter,
} from '../owned-root-policy.ts'

afterEach(() => {
  setOwnedRootAdapter(null)
})

describe('getConfigDir', () => {
  it('resolves after boot from an injected adapter, not import-time env', () => {
    setOwnedRootAdapter({ resolveConfigDir: () => '/tmp/injected-craft-root' })
    expect(getConfigDir()).toBe('/tmp/injected-craft-root')
  })

  it('does not require CRAFT_CONFIG_DIR as a production fallback when an adapter is injected', () => {
    const previous = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = '/tmp/should-not-win'
    try {
      setOwnedRootAdapter({ resolveConfigDir: () => '/tmp/owned-root' })
      expect(getConfigDir()).toBe('/tmp/owned-root')
    } finally {
      if (previous === undefined) delete process.env.CRAFT_CONFIG_DIR
      else process.env.CRAFT_CONFIG_DIR = previous
    }
  })

  it('restores the default adapter and reads env lazily', () => {
    setOwnedRootAdapter({ resolveConfigDir: () => '/tmp/injected-craft-root' })
    setOwnedRootAdapter(null)
    const previousCraft = process.env.CRAFT_CONFIG_DIR
    const previousRox = process.env.ROX_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = '/tmp/lazy-config-dir'
    delete process.env.ROX_CONFIG_DIR
    try {
      expect(getConfigDir()).toBe('/tmp/lazy-config-dir')
    } finally {
      if (previousCraft === undefined) delete process.env.CRAFT_CONFIG_DIR
      else process.env.CRAFT_CONFIG_DIR = previousCraft
      if (previousRox === undefined) delete process.env.ROX_CONFIG_DIR
      else process.env.ROX_CONFIG_DIR = previousRox
    }
  })

  it('default owned state is ~/.rox on a clean home, not ~/ROX', () => {
    setOwnedRootAdapter(null)
    const previousCraft = process.env.CRAFT_CONFIG_DIR
    const previousRox = process.env.ROX_CONFIG_DIR
    delete process.env.CRAFT_CONFIG_DIR
    delete process.env.ROX_CONFIG_DIR
    try {
      const dir = getConfigDir()
      expect(dir === join(homedir(), '.rox') || dir === join(homedir(), '.craft-agent')).toBe(true)
      expect(getConfigDir()).not.toContain('/ROX')
    } finally {
      if (previousCraft === undefined) delete process.env.CRAFT_CONFIG_DIR
      else process.env.CRAFT_CONFIG_DIR = previousCraft
      if (previousRox === undefined) delete process.env.ROX_CONFIG_DIR
      else process.env.ROX_CONFIG_DIR = previousRox
    }
  })
})

describe('assertNotesImportPaths', () => {
  it('rejects relative import roots', () => {
    expect(() => assertNotesImportPaths({ sourceRoot: 'vault' })).toThrow(/absolute path/)
    expect(() => assertNotesImportPaths({ sourceRoot: './vault' })).toThrow(/absolute path/)
  })

  it('rejects a relative destination when provided', () => {
    expect(() =>
      assertNotesImportPaths({ sourceRoot: '/abs/vault', destinationRoot: 'notes' }),
    ).toThrow(/absolute path/)
  })

  it('accepts absolute source and destination', () => {
    expect(() =>
      assertNotesImportPaths({ sourceRoot: '/abs/vault', destinationRoot: '/abs/notes' }),
    ).not.toThrow()
  })

  it('rejects equal or nested source and destination', () => {
    expect(() =>
      assertNotesImportPaths({ sourceRoot: '/abs/vault', destinationRoot: '/abs/vault' }),
    ).toThrow(/must not equal/)
    expect(() =>
      assertNotesImportPaths({ sourceRoot: '/abs/vault', destinationRoot: '/abs/vault/notes' }),
    ).toThrow(/inside the source/)
    expect(() =>
      assertNotesImportPaths({ sourceRoot: '/abs/notes/vault', destinationRoot: '/abs/notes' }),
    ).toThrow(/inside the destination/)
  })
})

describe('isImportProvenancedRelativePath', () => {
  it('matches notes/imports and assets/imports prefixes', () => {
    expect(isImportProvenancedRelativePath('imports/alpha.md')).toBe(true)
    expect(isImportProvenancedRelativePath('imports')).toBe(true)
    expect(isImportProvenancedRelativePath('assets/imports/picture.png')).toBe(true)
    expect(isImportProvenancedRelativePath('daily/today.md')).toBe(false)
    expect(isImportProvenancedRelativePath('imported.md')).toBe(false)
  })
})
