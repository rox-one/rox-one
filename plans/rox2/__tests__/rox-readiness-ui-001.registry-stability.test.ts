import { describe, expect, test } from 'bun:test'
import { buildRox2Cards, discoverAdditionalRox2RpcFiles } from '../registry'

describe('durable ROX2 charter identifiers', () => {
  test('current additional handlers are discoverable without moving charter closeout', () => {
    const cards = buildRox2Cards()
    expect(cards).toHaveLength(200)
    expect(cards.find(card => card.title.startsWith('Closeout:'))?.id).toBe('ROX2-200')
    const additions = discoverAdditionalRox2RpcFiles()
    expect(additions).toContain('packages/server-core/src/handlers/rpc/personal-tasks.ts')
    expect(additions).toContain('packages/server-core/src/handlers/rpc/code-intelligence.ts')
    expect(additions).not.toContain('packages/server-core/src/handlers/rpc/auth.ts')
    expect(additions.some(file => file.includes('.test.'))).toBe(false)
    const cardFiles = new Set(cards.filter(card => card.domain === 'rpc').flatMap(card => card.files))
    expect(additions.every(file => !cardFiles.has(file))).toBe(true)
    expect(cards.every(card => card.status === 'open')).toBe(true)
  })
})
