import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { planMeetingActions } from '@rox/shared/meeting-agents'
import { buildSummaryPrompt } from '../local-meetings-model'
const renderer = resolve(import.meta.dir, '../../..')
function evaluate(path: string, name: string, bindings: Record<string, unknown>) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let snippet = ''
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) snippet = node.getText(source).replace(/^export\s+/, '')
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) snippet = `const ${name} = ${node.initializer.getText(source)};`
    ts.forEachChild(node, visit)
  }
  visit(source); if (!snippet) throw new Error(`Missing ${name}`)
  const output = ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return new Function(...Object.keys(bindings), `${output}\nreturn ${name};`)(...Object.values(bindings))
}
function analysis(recipeSlash = '', recipeId: string = 'design-review') {
  const calls: Array<{ kind: string; args: any[] }> = []
  const meeting = { id: 'meeting-a', workspaceId: 'ws', title: 'Meeting', participants: [], recipeId }
  const api = {
    readTranscript: async () => ({ revision: 7, segments: [{ id: 's1', startMs: 0, endMs: 1000, text: 'Evidence' }] }),
    claimExtraction: async (...args: any[]) => { calls.push({ kind: 'claim', args }); return { ok: true, value: { ...meeting, extraction: { id: 'run-a', workspaceId: 'ws' } } } },
    attachExtraction: async (...args: any[]) => { calls.push({ kind: 'attach', args }); return { ok: true } },
    failExtraction: async (...args: any[]) => { calls.push({ kind: 'fail', args }); return { ok: true } },
    get: async () => meeting,
  }
  const electronAPI = {
    createSession: async (...args: any[]) => { calls.push({ kind: 'create', args }); return { id: 'analysis-a' } },
    sendMessage: async (...args: any[]) => { calls.push({ kind: 'send', args }) },
  }
  const startAgentRun = evaluate(resolve(renderer, 'lib/extra-screens/agent-run.ts'), 'startAgentRun', { window: { electronAPI } })
  const startMeetingExtraction = evaluate(resolve(renderer, 'lib/meetings/auto-extraction.ts'), 'startMeetingExtraction', {
    extractionBusy: () => false, planMeetingActions, buildSummaryPrompt,
    runtime: { start: startAgentRun }, i18n: { t: (key: string) => key },
  })
  const generateSummary = evaluate(resolve(renderer, 'pages/meetings/LocalMeetingDetail.tsx'), 'generateSummary', {
    api, m: meeting, recipeSlash, language: 'en', startMeetingExtraction,
    onChanged: (value: unknown) => calls.push({ kind: 'changed', args: [value] }),
    onBanner: (value: unknown) => calls.push({ kind: 'banner', args: [value] }),
  })
  return { calls, run: generateSummary as () => Promise<void> }
}
test('actual routed Meeting analysis binds profile through durable claim and safe no-source session', async () => {
  const h = analysis(); await h.run()
  expect(h.calls.find(c => c.kind === 'claim')?.args).toEqual(['meeting-a', { workspaceId: 'ws', transcriptRevision: 7, automatic: false }])
  expect(h.calls.find(c => c.kind === 'create')?.args).toEqual(['ws', { name: 'meetings.local.summaryRunName', permissionMode: 'safe', enabledSourceSlugs: [] }])
  const prompt = h.calls.find(c => c.kind === 'send')?.args[1]
  expect(prompt).toContain('Analysis profile: design-review')
  expect(prompt).toContain('rox.meeting.knowledge, rox.meeting.scribe')
  expect(prompt).toContain('meeting.design-review.v1')
  expect(prompt).toContain('Do not send or change anything')
  expect(prompt).toContain('[segmentId=s1')
  expect(h.calls.find(c => c.kind === 'attach')?.args).toEqual(['meeting-a', { runId: 'run-a', sessionId: 'analysis-a' }])
  expect(h.calls.findIndex(c => c.kind === 'attach')).toBeLessThan(h.calls.findIndex(c => c.kind === 'send'))
  expect(h.calls.at(-1)?.kind).toBe('changed')
  const source = readFileSync(resolve(renderer, 'pages/MeetingsPage.tsx'), 'utf8')
  expect(source).toContain('<LocalMeetingDetail')
})
test('explicit slash profile dispatches once; invalid slash neither claims nor creates a session', async () => {
  const allowed = analysis('/discovery questions'); await allowed.run()
  expect(allowed.calls.filter(c => c.kind === 'create')).toHaveLength(1)
  expect(allowed.calls.find(c => c.kind === 'send')?.args[1]).toContain('Analysis profile: discovery')
  for (const slash of ['/unknown-tool', '/meeting-assist', 'ordinary text']) {
    const denied = analysis(slash, 'standup'); await denied.run()
    expect(denied.calls.filter(c => ['claim', 'create', 'send'].includes(c.kind))).toHaveLength(0)
    expect(denied.calls.at(-1)).toEqual({ kind: 'banner', args: ['summary-failed'] })
  }
})
test('original summary JSON/citation contract remains while profiles add role perspectives', () => {
  const base = { title: 'Meeting', participants: [], segments: [{ id: 's1', startMs: 0, endMs: 1000, text: 'Source' }], language: 'en' as const }
  const original = buildSummaryPrompt(base)
  const profile = buildSummaryPrompt({ ...base, recipeId: 'client' })
  expect(profile.endsWith(original)).toBe(true)
  expect(profile).toContain('do not create tasks, notes, knowledge changes, CRM updates, or external sends')
})
