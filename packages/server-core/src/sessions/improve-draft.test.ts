import { describe, expect, it } from 'bun:test'
import { SessionManager, stripImprovedDraft } from './SessionManager.ts'

type ImproveHarness = {
  sessions: Map<string, unknown>
  querySessionLlm: (...args: unknown[]) => Promise<{ text: string; model?: string }>
  improveDraft(sessionId: string, text: string): Promise<{ success: boolean; text?: string; error?: string }>
}

function harness(query: ImproveHarness['querySessionLlm']) {
  const manager = Object.create(SessionManager.prototype) as ImproveHarness
  manager.sessions = new Map([['s1', { id: 's1' }]])
  manager.querySessionLlm = query
  return manager
}

describe('improveDraft', () => {
  it('surfaces the real provider error instead of a generic failure', async () => {
    const manager = harness(async () => {
      throw new Error('Connection "ROX" is not signed in')
    })
    const result = await manager.improveDraft('s1', 'сделай план')
    expect(result).toEqual({ success: false, error: 'Connection "ROX" is not signed in' })
  })

  it('passes the draft to the session LLM and strips wrapping quotes', async () => {
    const seen: unknown[] = []
    const manager = harness(async (...args) => {
      seen.push(args)
      return { text: '«Составь подробный план дня с приоритетами»' }
    })
    const result = await manager.improveDraft('s1', '  сделай план  ')
    expect(result).toEqual({ success: true, text: 'Составь подробный план дня с приоритетами' })
    const [sessionId, request] = seen[0] as [string, { prompt: string }]
    expect(sessionId).toBe('s1')
    expect(request.prompt).toContain('сделай план')
  })

  it('rejects an empty draft and an empty model answer', async () => {
    const manager = harness(async () => ({ text: '   ' }))
    expect((await manager.improveDraft('s1', '   ')).error).toBe('Draft is empty')
    expect((await manager.improveDraft('s1', 'x')).success).toBe(false)
    expect((await manager.improveDraft('missing', 'x')).error).toBe('Session not found')
  })

  it('strips code fences', () => {
    expect(stripImprovedDraft('```\nhello\n```')).toBe('hello')
  })
})
