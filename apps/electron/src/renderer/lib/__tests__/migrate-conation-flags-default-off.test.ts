import { beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CONATION_FEATURE_STORAGE_KEYS,
  CONATION_FLAGS_DEFAULT_OFF_MIGRATE_KEY,
  CONATION_WORKBENCH_KEY_PREFIX,
  migrateConationFlagsDefaultOff,
} from '../migrate-conation-flags-default-off'

function memoryStorage(seed: Record<string, string> = {}): Storage & {
  data: Record<string, string>
} {
  const data: Record<string, string> = { ...seed }
  const api: Storage & { data: Record<string, string> } = {
    data,
    get length() {
      return Object.keys(data).length
    },
    clear() {
      for (const key of Object.keys(data)) delete data[key]
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null
    },
    setItem(key: string, value: string) {
      data[key] = String(value)
    },
    removeItem(key: string) {
      delete data[key]
    },
    key(index: number) {
      return Object.keys(data)[index] ?? null
    },
  }
  return api
}

describe('migrateConationFlagsDefaultOff', () => {
  beforeEach(() => {
    // no shared global — each test builds its own Storage
  })

  it('rewrites sticky JSON true → false for known conation keys', () => {
    const storage = memoryStorage({
      'craft-feature-workbench-conation-canvas': 'true',
      'craft-feature-workbench-conation-board': 'true',
      'craft-feature-workbench-conation-shell': 'true',
      'craft-feature-skills-conation-surfaces': 'true',
      'craft-feature-unified-shell': 'true',
    })

    const result = migrateConationFlagsDefaultOff(storage)

    expect(result.ran).toBe(true)
    expect(result.cleared.sort()).toEqual(
      [
        'craft-feature-skills-conation-surfaces',
        'craft-feature-workbench-conation-board',
        'craft-feature-workbench-conation-canvas',
        'craft-feature-workbench-conation-shell',
      ].sort(),
    )
    expect(storage.getItem('craft-feature-workbench-conation-canvas')).toBe('false')
    expect(storage.getItem('craft-feature-workbench-conation-board')).toBe('false')
    expect(storage.getItem('craft-feature-workbench-conation-shell')).toBe('false')
    expect(storage.getItem('craft-feature-skills-conation-surfaces')).toBe('false')
    // Non-conation sibling must not be touched
    expect(storage.getItem('craft-feature-unified-shell')).toBe('true')
    expect(storage.getItem(CONATION_FLAGS_DEFAULT_OFF_MIGRATE_KEY)).toBe('1')
  })

  it('is one-shot: second call leaves intentional true alone', () => {
    const storage = memoryStorage({
      'craft-feature-workbench-conation-canvas': 'true',
    })
    expect(migrateConationFlagsDefaultOff(storage).ran).toBe(true)
    expect(storage.getItem('craft-feature-workbench-conation-canvas')).toBe('false')

    storage.setItem('craft-feature-workbench-conation-canvas', 'true')
    const second = migrateConationFlagsDefaultOff(storage)
    expect(second.ran).toBe(false)
    expect(second.cleared).toEqual([])
    expect(storage.getItem('craft-feature-workbench-conation-canvas')).toBe('true')
  })

  it('also clears prefix sibling keys QA may stick outside KEYS', () => {
    const storage = memoryStorage({
      'craft-feature-workbench-conation-fund-extra': 'true',
      'craft-feature-workbench-conation-board': 'false',
    })
    const result = migrateConationFlagsDefaultOff(storage)
    expect(result.ran).toBe(true)
    expect(result.cleared).toContain('craft-feature-workbench-conation-fund-extra')
    expect(storage.getItem('craft-feature-workbench-conation-fund-extra')).toBe('false')
    expect(storage.getItem('craft-feature-workbench-conation-board')).toBe('false')
  })

  it('treats missing storage as no-op', () => {
    expect(migrateConationFlagsDefaultOff(null)).toEqual({ ran: false, cleared: [] })
    expect(migrateConationFlagsDefaultOff(undefined)).toEqual({ ran: false, cleared: [] })
  })

  it('exports every KEYS conation storage string under the craft- prefix', () => {
    expect(CONATION_FEATURE_STORAGE_KEYS.length).toBeGreaterThanOrEqual(12)
    for (const key of CONATION_FEATURE_STORAGE_KEYS) {
      expect(
        key.startsWith(CONATION_WORKBENCH_KEY_PREFIX) ||
          key === 'craft-feature-skills-conation-surfaces',
      ).toBe(true)
    }
    expect(CONATION_FEATURE_STORAGE_KEYS).toContain('craft-feature-workbench-conation-canvas')
    expect(CONATION_FEATURE_STORAGE_KEYS).toContain('craft-feature-workbench-conation-board')
  })
})

describe('conation atom source defaults stay false', () => {
  it('conation-shell.ts atomWithStorage defaults are false', () => {
    const source = readFileSync(join(import.meta.dir, '../../atoms/conation-shell.ts'), 'utf8')
    expect(source).toContain("KEYS.featureWorkbenchConationShell")
    expect(source).toContain("KEYS.featureWorkbenchConationInspector")
    expect(source).toContain("KEYS.featureSkillsConationSurfaces")
    // Every atomWithStorage boolean default in this file must be false
    const defaults = [...source.matchAll(/atomWithStorage<boolean>\(\s*[^,]+,\s*(true|false)/g)].map(
      (m) => m[1],
    )
    expect(defaults.length).toBeGreaterThanOrEqual(3)
    expect(defaults.every((d) => d === 'false')).toBe(true)
  })

  it('unified-shell.ts conation atomWithStorage defaults are false', () => {
    const source = readFileSync(join(import.meta.dir, '../../atoms/unified-shell.ts'), 'utf8')
    const conationBlocks = [
      'featureWorkbenchConationSoupClient',
      'featureWorkbenchConationNotesBridge',
      'featureWorkbenchConationDriveRead',
      'featureWorkbenchConationCanvas',
      'featureWorkbenchConationBoard',
      'featureWorkbenchConationMail',
      'featureWorkbenchConationDssClient',
      'featureWorkbenchConationSessionApply',
    ]
    for (const key of conationBlocks) {
      expect(source).toContain(`KEYS.${key}`)
      const re = new RegExp(
        `KEYS\\.${key}\\)[\\s\\S]*?atomWithStorage<boolean>\\([\\s\\S]*?,\\s*(true|false)`,
      )
      // Fallback: find the atom declaration near the KEYS reference
      const idx = source.indexOf(`KEYS.${key}`)
      expect(idx).toBeGreaterThanOrEqual(0)
      const window = source.slice(idx, idx + 220)
      expect(window).toMatch(/,\s*false\s*,/)
      expect(window).not.toMatch(/,\s*true\s*,/)
    }
  })

  it('bootstrap runs migrate before dynamic main import', () => {
    const bootstrap = readFileSync(join(import.meta.dir, '../../bootstrap.ts'), 'utf8')
    expect(bootstrap).toContain("migrateConationFlagsDefaultOff")
    expect(bootstrap).toContain("from './lib/migrate-conation-flags-default-off'")
    const migrateCall = bootstrap.indexOf('migrateConationFlagsDefaultOff(')
    const mainImport = bootstrap.indexOf("import('./main')")
    expect(migrateCall).toBeGreaterThanOrEqual(0)
    expect(mainImport).toBeGreaterThan(migrateCall)
  })
})
