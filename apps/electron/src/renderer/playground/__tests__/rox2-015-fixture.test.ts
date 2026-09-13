import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import {
  PLAYGROUND_ROX2_RUN_STATE,
  playgroundStoryResult,
} from '../registry/types.ts'

const ROOT = join(import.meta.dir, '../../../../../../')

describe('ROX2-015 playground stays fixture', () => {
  test('inventory coverage labels playground as fixture, never live', () => {
    const inventory = readFileSync(join(ROOT, 'plans/rox2/inventory.ts'), 'utf8')
    expect(inventory).toContain("id: 'playground'")
    expect(inventory).toContain('Fixture gallery. Must stay labeled fixture, never live.')
  })

  test('story results are fixture and not claimable as live', () => {
    expect(PLAYGROUND_ROX2_RUN_STATE).toBe('fixture')
    const result = playgroundStoryResult('zen-shell-qa-fixture')
    expect(result.ok).toBe(false)
    expect(result.state).toBe('fixture')
    expect(isClaimableLive(result)).toBe(false)
  })

  test('empty story ids are rejected', () => {
    expect(() => playgroundStoryResult('')).toThrow()
    expect(() => playgroundStoryResult('   ')).toThrow()
  })

  test('playground types cannot assign live as the run state', () => {
    const types = readFileSync(join(ROOT, 'apps/electron/src/renderer/playground/registry/types.ts'), 'utf8')
    expect(types).toContain("export const PLAYGROUND_ROX2_RUN_STATE = 'fixture' as const")
    expect(types).not.toMatch(/PLAYGROUND_ROX2_RUN_STATE = 'live'/)
    expect(types).not.toContain('conation.dev')
  })
})
