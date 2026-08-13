/**
 * Bundled config-defaults.json and FALLBACK_CONFIG_DEFAULTS must stay identical.
 *
 * Production change that fails this suite:
 * - JSON `thinkingLevel` set to legacy `"think"` (or any non-THINKING_LEVEL_IDS value)
 * - JSON / TS `permissionMode` drifting off `'allow-all'`
 * - Any other field diverging between the two documents
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { THINKING_LEVEL_IDS } from '../../agent/thinking-levels.ts'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..')
const BUNDLED_DEFAULTS_PATH = join(REPO_ROOT, 'apps', 'electron', 'resources', 'config-defaults.json')
const STORAGE_SOURCE_PATH = join(import.meta.dir, '..', 'storage.ts')

function loadBundledDefaults(): Record<string, unknown> {
  return JSON.parse(readFileSync(BUNDLED_DEFAULTS_PATH, 'utf-8')) as Record<string, unknown>
}

/**
 * Evaluate the FALLBACK_CONFIG_DEFAULTS object literal from storage.ts.
 * Parsing the source (not the write-path) is required: getBundledAssetsDir can
 * copy the JSON itself, which would make a disk-roundtrip comparison tautological.
 */
function loadFallbackDefaults(): Record<string, unknown> {
  const source = readFileSync(STORAGE_SOURCE_PATH, 'utf-8')
  const needle = 'const FALLBACK_CONFIG_DEFAULTS'
  const start = source.indexOf(needle)
  if (start < 0) {
    throw new Error('FALLBACK_CONFIG_DEFAULTS not found in storage.ts')
  }
  const brace = source.indexOf('{', start)
  if (brace < 0) {
    throw new Error('FALLBACK_CONFIG_DEFAULTS object literal not found')
  }

  let depth = 0
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let escape = false
  for (let i = brace; i < source.length; i++) {
    const ch = source[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\' && (inSingle || inDouble || inTemplate)) {
      escape = true
      continue
    }
    if (!inDouble && !inTemplate && ch === "'") {
      inSingle = !inSingle
      continue
    }
    if (!inSingle && !inTemplate && ch === '"') {
      inDouble = !inDouble
      continue
    }
    if (!inSingle && !inDouble && ch === '`') {
      inTemplate = !inTemplate
      continue
    }
    if (inSingle || inDouble || inTemplate) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const literal = source.slice(brace, i + 1)
        return new Function(`"use strict"; return (${literal})`)() as Record<string, unknown>
      }
    }
  }
  throw new Error('FALLBACK_CONFIG_DEFAULTS object literal did not close')
}

function workspaceDefaults(doc: Record<string, unknown>): Record<string, unknown> {
  const ws = doc.workspaceDefaults
  if (ws === null || typeof ws !== 'object') {
    throw new Error('workspaceDefaults missing')
  }
  return ws as Record<string, unknown>
}

describe('config-defaults source of truth', () => {
  it('bundled thinkingLevel is a current value, not legacy "think"', () => {
    const thinkingLevel = workspaceDefaults(loadBundledDefaults()).thinkingLevel
    expect(thinkingLevel).not.toBe('think')
    expect(THINKING_LEVEL_IDS as readonly string[]).toContain(thinkingLevel)
  })

  it('fallback permission mode matches the bundle (allow-all) and cyclable modes match', () => {
    const bundled = workspaceDefaults(loadBundledDefaults())
    const fallback = workspaceDefaults(loadFallbackDefaults())
    expect(bundled.permissionMode).toBe('allow-all')
    expect(fallback.permissionMode).toBe('allow-all')
    expect(fallback.cyclablePermissionModes).toEqual(bundled.cyclablePermissionModes)
  })

  it('fails if the TypeScript fallback and the JSON diverge', () => {
    expect(loadFallbackDefaults()).toEqual(loadBundledDefaults())
  })
})
