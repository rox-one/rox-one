import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildRightSidebarParam,
  parseRightSidebarParam,
} from '../route-parser'

describe('right sidebar URL round-trip', () => {
  it('round-trips files, history, git, browser, and context', () => {
    const cases = [
      { type: 'history' as const },
      { type: 'git' as const },
      { type: 'browser' as const },
      { type: 'context' as const },
      { type: 'files' as const },
      { type: 'files' as const, path: 'src/main.ts' },
    ]
    for (const panel of cases) {
      const encoded = buildRightSidebarParam(panel)
      expect(encoded).toBeDefined()
      expect(parseRightSidebarParam(encoded)).toEqual(panel)
    }
  })

  it('omits none from the URL and still parses the token', () => {
    expect(buildRightSidebarParam({ type: 'none' })).toBeUndefined()
    expect(parseRightSidebarParam('none')).toEqual({ type: 'none' })
  })

  it('does not treat terminal as a sidebar panel', () => {
    expect(parseRightSidebarParam('terminal')).toBeUndefined()
    const typesSource = readFileSync(join(__dirname, '..', 'types.ts'), 'utf8')
    const union = typesSource.slice(
      typesSource.indexOf('export type RightSidebarPanel'),
      typesSource.indexOf('export type SessionFilter'),
    )
    expect(union).not.toMatch(/['"]terminal['"]/)
    expect(union).toContain("{ type: 'git' }")
    expect(union).toContain("{ type: 'browser' }")
    expect(union).toContain("{ type: 'context' }")
  })
})
