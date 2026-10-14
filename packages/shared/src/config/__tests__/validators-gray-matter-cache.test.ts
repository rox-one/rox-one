import { describe, expect, it } from 'bun:test'
import matter from 'gray-matter'
import { validateSkillContent } from '../validators.ts'

const matterCache = (matter as unknown as { cache: Record<string, unknown> }).cache

describe('validateSkillContent gray-matter cache', () => {
  it('parses frontmatter without retaining the content in matter.cache', () => {
    const content = `---
name: Cache Probe Shared
description: Skill parsed by the shared validator
---

# Instructions

Shared validator body.
`
    const keysBefore = Object.keys(matterCache).length

    const result = validateSkillContent(content, 'cache-probe-shared')

    expect(result.errors).toEqual([])
    expect(Object.keys(matterCache).length).toBe(keysBefore)
    expect(content in matterCache).toBe(false)
  })
})
