import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { isRoadmapRevision, normalizeRoadmap } from '../roadmap.ts'
import { applyProposalItem } from '../roadmap-ai.ts'

/** Execute the actual renderer callback, including its persistence gate. */
function callback(name: string, environment: Record<string, unknown>): Function {
  // ProjectInfoPage owns the tabbed metadata surface; AI persistence belongs
  // to the separately routed Roadmap page and must be exercised there.
  const path = resolve(import.meta.dir, '../../../../../apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx')
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  let matches = 0
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)
      && node.initializer.expression.getText(source) === 'useCallback') {
      expression = node.initializer.arguments[0]
      matches++
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!expression || matches !== 1) throw new Error(`Expected one actual Roadmap callback ${name}; found ${matches}`)
  const code = ts.transpileModule(`const actual = ${expression.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText
  return new Function(...Object.keys(environment), `${code}; return actual;`)(...Object.values(environment))
}

function base() {
  return {
    workspaceId: 'workspace', projectSlug: 'project', today: '2026-09-30', baseLang: 'en',
    roadmapSaverRef: { current: {} }, roadmapRef: { current: normalizeRoadmap({ revision: 'a'.repeat(64) }) },
    aiScopeRef: { current: JSON.stringify(['workspace', 'project']) }, LANGUAGE_NAMES: { en: 'English' },
    t: (key: string) => key, setAiResult: (_result: unknown) => {},
  }
}

describe('integrated project roadmap AI persistence gate', () => {
  test('a refused native save stops AI before any provider request', async () => {
    let calls = 0
    const run = callback('runAi', {
      ...base(), saveTimer: { current: {} }, flushRef: { current: async () => false },
      window: { electronAPI: { runProjectRoadmapAi: async () => { calls++; return { ok: true, mode: 'improve', text: 'stale', effectiveModel: null } } } },
    })
    expect(await run({ mode: 'improve', text: 'draft' })).toMatchObject({ ok: false })
    expect(calls).toBe(0)
  })

  test('AI waits for the current queued native receipt even when debounce has already fired', async () => {
    let release!: (saved: boolean) => void
    const calls: unknown[][] = []
    const published: unknown[] = []
    const environment = base()
    const response = { ok: true, mode: 'improve', text: 'current', requestedModel: 'requested', effectiveModel: null, warning: 'effective model not reported', roadmapRevision: 'b'.repeat(64) }
    const receipt = new Promise<boolean>(resolve => { release = resolve })
    const run = callback('runAi', {
      ...environment, saveTimer: { current: null }, flushRef: { current: async () => {
        const saved = await receipt
        if (saved) environment.roadmapRef.current.revision = 'b'.repeat(64)
        return saved
      } },
      setAiResult: (result: unknown) => { published.push(result) },
      window: { electronAPI: { runProjectRoadmapAi: async (...args: unknown[]) => { calls.push(args); return response } } },
    })
    const pending = run({ mode: 'improve', text: 'draft' })
    await Promise.resolve()
    expect(calls).toEqual([])
    expect(published).toEqual([])
    release(true)
    expect(await pending).toEqual(response)
    expect(calls).toEqual([['workspace', 'project', { mode: 'improve', text: 'draft', roadmapRevision: 'b'.repeat(64), today: '2026-09-30', language: 'English' }]])
    expect(published).toEqual([response])
    expect(response.effectiveModel).toBeNull()
  })

  test('accepting a proposal remains pending until its native receipt and fails after refusal', async () => {
    let release!: (saved: boolean) => void
    const receipt = new Promise<boolean>(resolve => { release = resolve })
    const accept = callback('acceptProposal', {
      today: '2026-09-30', isRoadmapRevision, roadmapRef: { current: { revision: 'a'.repeat(64) } }, updateRoadmap: () => {},
      applyProposalItem: (roadmap: unknown) => roadmap,
      flushRef: { current: () => receipt },
    })
    let finished = false
    const pending = Promise.resolve(accept({}, [{ section: 'goal' }], 'a'.repeat(64))).then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    release(false)
    await expect(pending).rejects.toThrow('PROJECT_ROADMAP_SAVE_REQUIRED')
    expect(finished).toBe(false)
  })

  test('missing current save queue refuses AI without a flush or provider call', async () => {
    let flushes = 0, calls = 0
    const run = callback('runAi', {
      ...base(), roadmapSaverRef: { current: null }, flushRef: { current: async () => { flushes++; return true } },
      window: { electronAPI: { runProjectRoadmapAi: async () => { calls++ } } },
    })
    expect(await run({ mode: 'spec', text: 'draft' })).toEqual({ ok: false, error: 'PROJECT_ROADMAP_SAVE_REQUIRED' })
    expect({ flushes, calls }).toEqual({ flushes: 0, calls: 0 })
  })

  for (const change of ['workspace', 'writer'] as const) {
    test(`${change} change while native save is pending prevents a provider request`, async () => {
      const environment = base()
      const { promise, resolve: release } = Promise.withResolvers<boolean>()
      let calls = 0
      const run = callback('runAi', {
        ...environment, flushRef: { current: () => promise },
        window: { electronAPI: { runProjectRoadmapAi: async () => { calls++ } } },
      })
      const pending = run({ mode: 'spec', text: 'draft' })
      await Promise.resolve()
      if (change === 'workspace') environment.aiScopeRef.current = JSON.stringify(['other-workspace', 'project'])
      else environment.roadmapSaverRef.current = {}
      release(true)
      expect(await pending).toEqual({ ok: false, error: change === 'writer' ? 'PROJECT_ROADMAP_SCOPE_CHANGED' : 'projectRoadmap.ai.scopeChanged' })
      expect(calls).toBe(0)
    })

    test(`a late AI response after ${change} change cannot publish into the current project`, async () => {
      const environment = base()
      const { promise, resolve: release } = Promise.withResolvers<unknown>()
      const { promise: started, resolve: markStarted } = Promise.withResolvers<void>()
      const published: unknown[] = []
      const run = callback('runAi', {
        ...environment, flushRef: { current: async () => true }, setAiResult: (result: unknown) => { published.push(result) },
        window: { electronAPI: { runProjectRoadmapAi: () => { markStarted(); return promise } } },
      })
      const pending = run({ mode: 'improve', text: 'draft' })
      await started
      if (change === 'workspace') environment.aiScopeRef.current = JSON.stringify(['other-workspace', 'project'])
      else environment.roadmapSaverRef.current = {}
      release({ ok: true, mode: 'improve', text: 'obsolete', effectiveModel: 'old-provider' })
      expect(await pending).toEqual({ ok: false, error: 'projectRoadmap.ai.scopeChanged' })
      expect(published).toEqual([])
    })
  }

  test('accepting against a missing or stale revision refuses before editing or saving', async () => {
    for (const revision of [undefined, 'not-a-revision', 'b'.repeat(64)]) {
      let edits = 0, flushes = 0
      const accept = callback('acceptProposal', {
        ...base(), isRoadmapRevision, updateRoadmap: () => { edits++ }, applyProposalItem,
        flushRef: { current: async () => { flushes++; return true } },
      })
      await expect(accept({ goal: 'proposal' }, [{ section: 'goal' }], revision)).rejects.toThrow('PROJECT_ROADMAP_CONFLICT')
      expect({ edits, flushes }).toEqual({ edits: 0, flushes: 0 })
    }
  })

  test('accepting a current proposal returns only the acknowledged native revision', async () => {
    const environment = base()
    const { promise, resolve: release } = Promise.withResolvers<boolean>()
    let finished = false
    const accept = callback('acceptProposal', {
      ...environment, isRoadmapRevision, applyProposalItem,
      updateRoadmap: (update: (roadmap: ReturnType<typeof normalizeRoadmap>) => ReturnType<typeof normalizeRoadmap>) => {
        environment.roadmapRef.current = update(environment.roadmapRef.current)
      },
      flushRef: { current: async () => {
        const saved = await promise
        if (saved) environment.roadmapRef.current.revision = 'c'.repeat(64)
        return saved
      } },
    })
    const pending = accept({ goal: 'accepted proposal' }, [{ section: 'goal' }], 'a'.repeat(64)).then((revision: string) => { finished = true; return revision })
    await Promise.resolve()
    expect(environment.roadmapRef.current.goal).toBe('accepted proposal')
    expect(finished).toBe(false)
    release(true)
    expect(await pending).toBe('c'.repeat(64))
    expect(finished).toBe(true)
  })
})
