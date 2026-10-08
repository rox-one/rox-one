/**
 * W1-08 (#1505) — `entities.previews.v1` registration.
 *
 * Default OFF, depends on `entities.links.v1`, and never resolves on its own.
 */
import { describe, expect, it } from 'bun:test'
import {
  WORKBENCH_FEATURE_FLAGS,
  WORKBENCH_FLAG,
  isWorkbenchFlagEnabled,
} from '../workbench/flags.ts'

describe('entities.previews.v1', () => {
  const definition = WORKBENCH_FEATURE_FLAGS.find((flag) => flag.id === 'entities.previews.v1')

  it('is registered with defaultValue false', () => {
    expect(WORKBENCH_FLAG.entitiesPreviewsV1).toBe('entities.previews.v1')
    expect(definition).toBeDefined()
    expect(definition?.defaultValue).toBe(false)
    expect(definition?.rollbackSafe).toBe(true)
  })

  it('depends on entities.links.v1', () => {
    expect(definition?.dependencies).toEqual([WORKBENCH_FLAG.entitiesLinksV1])
  })

  it('is off when only the previews flag is requested (negative)', () => {
    expect(isWorkbenchFlagEnabled(WORKBENCH_FLAG.entitiesPreviewsV1, new Set([WORKBENCH_FLAG.entitiesPreviewsV1]))).toBe(false)
  })

  it('is off when nothing is requested (default)', () => {
    expect(isWorkbenchFlagEnabled(WORKBENCH_FLAG.entitiesPreviewsV1, new Set())).toBe(false)
  })

  it('is on only with both flags requested', () => {
    expect(isWorkbenchFlagEnabled(
      WORKBENCH_FLAG.entitiesPreviewsV1,
      new Set([WORKBENCH_FLAG.entitiesLinksV1, WORKBENCH_FLAG.entitiesPreviewsV1]),
    )).toBe(true)
  })
})
