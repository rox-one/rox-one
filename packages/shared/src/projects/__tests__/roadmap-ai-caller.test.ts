import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { normalizeRoadmap } from '../roadmap.ts'

/** Execute the actual renderer callback, including its persistence gate. */
function callback(name: string, environment: Record<string, unknown>): Function {
  const path = resolve(import.meta.dir, '../../../../../apps/electron/src/renderer/pages/ProjectInfoPage.tsx')
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      expression = node.initializer.arguments[0]
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!expression) throw new Error(`Actual callback ${name} missing`)
  const code = ts.transpileModule(`const actual = ${expression.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText
  return new Function(...Object.keys(environment), `${code}; return actual;`)(...Object.values(environment))
}

const base = { workspaceId: 'workspace', projectSlug: 'project', today: '2026-09-30', baseLang: 'en', roadmapSaverRef: { current: {} }, roadmapRef: { current: normalizeRoadmap({ revision: 'a'.repeat(64) }) }, LANGUAGE_NAMES: { en: 'English' } }

describe('integrated project roadmap AI persistence gate', () => {
  test('a refused native save stops AI before any provider request', async () => {
    let calls = 0
    const run = callback('runAi', {
      ...base, saveTimer: { current: {} }, flushRef: { current: async () => false },
      window: { electronAPI: { runProjectRoadmapAi: async () => { calls++; return { ok: true, mode: 'improve', text: 'stale' } } } },
    })
    expect(await run({ mode: 'improve', text: 'draft' })).toMatchObject({ ok: false })
    expect(calls).toBe(0)
  })

  test('AI waits for the current queued native receipt even when debounce has already fired', async () => {
    let release!: (saved: boolean) => void
    let calls = 0
    const receipt = new Promise<boolean>(resolve => { release = resolve })
    const run = callback('runAi', {
      ...base, saveTimer: { current: null }, flushRef: { current: () => receipt },
      window: { electronAPI: { runProjectRoadmapAi: async () => { calls++; return { ok: true, mode: 'improve', text: 'current' } } } },
    })
    const pending = run({ mode: 'improve', text: 'draft' })
    await Promise.resolve()
    expect(calls).toBe(0)
    release(true)
    expect(await pending).toMatchObject({ ok: true, text: 'current' })
    expect(calls).toBe(1)
  })

  test('accepting a proposal remains pending until its native receipt and fails after refusal', async () => {
    let release!: (saved: boolean) => void
    const receipt = new Promise<boolean>(resolve => { release = resolve })
    const accept = callback('acceptProposal', {
      today: '2026-09-30', isRoadmapRevision: () => true, roadmapRef: { current: { revision: 'a'.repeat(64) } }, updateRoadmap: () => {},
      applyProposalItem: (roadmap: unknown) => roadmap,
      flushRef: { current: () => receipt },
    })
    let finished = false
    const pending = Promise.resolve(accept({}, [{ section: 'goal' }], 'a'.repeat(64))).then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    release(false)
    await expect(pending).rejects.toThrow('PROJECT_ROADMAP_SAVE_REQUIRED')
  })
})
