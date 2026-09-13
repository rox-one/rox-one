import { describe, expect, test } from 'bun:test'
import { isClaimableLive, queuedResult } from '../../../packages/core/src/rox2/platform-contract.ts'
import { buildRox2Cards } from '../../rox2/registry.ts'
import {
  AUDIT_ISSUE_ROWS,
  buildSameSuffixCrosswalk,
  relateSameSuffix,
} from '../crosswalk.ts'

describe('ROX-AUD / ROX2 crosswalk (#342)', () => {
  const rows = buildSameSuffixCrosswalk()
  const rox2 = buildRox2Cards()

  test('covers ROX-AUD-000 plus 200 independent suffix pairs', () => {
    expect(rows).toHaveLength(201)
    expect(rows[0]).toMatchObject({
      audId: 'ROX-AUD-000',
      rox2Id: 'ROX2-000',
      relation: 'extends',
    })
    expect(rows.slice(1).map((row) => row.rox2Id)).toEqual(
      Array.from({ length: 200 }, (_, index) => `ROX2-${String(index + 1).padStart(3, '0')}`),
    )
    expect(rows.slice(1).every((row) => row.relation === 'independent')).toBe(true)
  })

  test('never treats a same numeric suffix as equivalent', () => {
    expect(rows.some((row) => row.relation === 'equivalent')).toBe(false)
    expect(relateSameSuffix('ROX-AUD-012', 'ROX2-012')).toBe('independent')
    expect(relateSameSuffix('ROX-AUD-031', 'ROX2-031')).toBe('independent')
    expect(relateSameSuffix('ROX-AUD-054', 'ROX2-054')).toBe('independent')
    expect(relateSameSuffix('ROX-AUD-151', 'ROX2-151')).toBe('independent')
    expect(relateSameSuffix('ROX-AUD-181', 'ROX2-181')).toBe('independent')
  })

  test('same-suffix ROX2 titles do not match the AUD GitHub issues', () => {
    const byId = new Map(rox2.map((card) => [card.id, card.title]))
    for (const issue of AUDIT_ISSUE_ROWS) {
      if (issue.audId === 'ROX-AUD-000') continue
      const rox2Title = byId.get(issue.sameSuffixRox2)
      expect(rox2Title).toBeDefined()
      expect(issue.title).not.toBe(rox2Title)
    }
  })

  test('imported GitHub issues keep unique AUD ids and never-equivalent relations', () => {
    const ids = AUDIT_ISSUE_ROWS.map((row) => row.audId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(AUDIT_ISSUE_ROWS.every((row) => row.relation !== 'equivalent')).toBe(true)
    expect(AUDIT_ISSUE_ROWS.map((row) => row.issue).sort((a, b) => a - b)).toEqual(
      [320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340, 341, 342],
    )
  })

  test('queued results stay unclaimable after the parent audit closeout', () => {
    expect(isClaimableLive(queuedResult('conation.write', 'blocked'))).toBe(false)
    expect(isClaimableLive(queuedResult('drive', 'not live'))).toBe(false)
    expect(isClaimableLive(queuedResult('mail', 'not live'))).toBe(false)
  })
})
