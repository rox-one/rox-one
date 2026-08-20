/**
 * Knowledge hosting probe — env + existsSync only; never loads the addon.
 */
import { describe, expect, it } from 'bun:test'
import { resolveKnowledgeHosting } from '../hosting-mode'

describe('resolveKnowledgeHosting', () => {
  it('defaults to h1', () => {
    expect(
      resolveKnowledgeHosting({
        env: {},
        existsSync: () => true,
        nativeAddonPath: '/tmp/oem-kernel/knowledge-engine.node',
      }),
    ).toBe('h1')
  })

  it('returns h1 when ROX_KNOWLEDGE_H3 is set but addon file is missing', () => {
    expect(
      resolveKnowledgeHosting({
        env: { ROX_KNOWLEDGE_H3: '1' },
        existsSync: () => false,
        nativeAddonPath: '/missing/oem-kernel/knowledge-engine.node',
      }),
    ).toBe('h1')
    expect(
      resolveKnowledgeHosting({
        env: { ROX_KNOWLEDGE_H3: 'true' },
        existsSync: () => false,
        nativeAddonPath: '/missing/oem-kernel/knowledge-engine.node',
      }),
    ).toBe('h1')
  })

  it('returns h3 when env is set and addon path exists', () => {
    const seen: string[] = []
    const addon = '/resources/oem-kernel/knowledge-engine.node'
    expect(
      resolveKnowledgeHosting({
        env: { ROX_KNOWLEDGE_H3: '1' },
        nativeAddonPath: addon,
        existsSync: (p) => {
          seen.push(p)
          return p === addon
        },
      }),
    ).toBe('h3')
    expect(seen).toEqual([addon])
    expect(
      resolveKnowledgeHosting({
        env: { ROX_KNOWLEDGE_H3: 'true' },
        nativeAddonPath: addon,
        existsSync: () => true,
      }),
    ).toBe('h3')
  })
})
