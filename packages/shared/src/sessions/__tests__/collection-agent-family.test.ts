import { describe, expect, it } from 'bun:test'
import { classifyAgentFamily } from '../collection-agent-family.ts'
import { filterSessionMeta, type CollectionSessionMeta } from '../collection-query.ts'

function meta(partial: Partial<CollectionSessionMeta> & { id: string }): CollectionSessionMeta {
  return { lastMessageAt: 0, createdAt: 0, ...partial }
}

describe('classifyAgentFamily', () => {
  it('maps known model and connection strings', () => {
    expect(classifyAgentFamily({ model: 'claude-sonnet-4' })).toBe('claude')
    expect(classifyAgentFamily({ model: 'gpt-4.1', llmConnection: 'anthropic-work' })).toBe('claude')
    expect(classifyAgentFamily({ model: 'openai-codex' })).toBe('codex')
    expect(classifyAgentFamily({ model: 'hermes-3' })).toBe('hermes')
    expect(classifyAgentFamily({ model: 'opencode-go' })).toBe('opencode')
    expect(classifyAgentFamily({ model: 'rox/standard' })).toBe('omp')
    expect(classifyAgentFamily({ model: 'kimi', llmConnection: 'oh-my-pi' })).toBe('omp')
    expect(classifyAgentFamily({ model: 'gpt-4o' })).toBe('other')
    expect(classifyAgentFamily({})).toBe('other')
  })
})

describe('filterSessionMeta agentFamily', () => {
  it('OR within families, AND with other chips', () => {
    const claude = meta({ id: '1', model: 'claude-opus', sessionStatus: 'todo' })
    const omp = meta({ id: '2', model: 'rox/fast', sessionStatus: 'todo' })
    const other = meta({ id: '3', model: 'gpt-4o', sessionStatus: 'done' })

    expect(filterSessionMeta(claude, { agentFamily: ['claude', 'omp'] }, true)).toBe(true)
    expect(filterSessionMeta(omp, { agentFamily: ['claude', 'omp'] }, true)).toBe(true)
    expect(filterSessionMeta(other, { agentFamily: ['claude', 'omp'] }, true)).toBe(false)
    expect(filterSessionMeta(claude, { agentFamily: ['claude'], status: ['done'] }, true)).toBe(false)
    expect(filterSessionMeta(claude, { agentFamily: ['claude'], status: ['todo'] }, true)).toBe(true)
  })
})
