import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
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
  const api = {
    createSession: async (...args: any[]) => { calls.push({ kind: 'create', args }); return { id: 'analysis-a' } },
    sendMessage: async (...args: any[]) => { calls.push({ kind: 'send', args }) },
  }
  const startAgentRun = evaluate(resolve(renderer, 'lib/extra-screens/agent-run.ts'), 'startAgentRun', { window: { electronAPI: api } })
  const generateSummary = evaluate(resolve(renderer, 'pages/meetings/LocalMeetingDetail.tsx'), 'generateSummary', {
    workspaceId: 'ws', transcript: { revision: 7, segments: [{ id: 's1', startMs: 0, endMs: 1000, text: 'Evidence' }] },
    m: { id: 'meeting-a', title: 'Meeting', participants: [], recipeId }, recipeSlash, language: 'en',
    buildSummaryPrompt, startAgentRun, t: (key: string) => key,
    update: async (patch: unknown) => calls.push({ kind: 'update', args: [patch] }),
    onBanner: (value: unknown) => calls.push({ kind: 'banner', args: [value] }),
  })
  return { calls, run: generateSummary as () => Promise<void> }
}
test('actual routed Meeting analysis callback binds profile to existing safe session and source revision', async () => {
  const h = analysis(); await h.run()
  expect(h.calls.find(c => c.kind === 'create')?.args).toEqual(['ws', { name: 'meetings.local.summaryRunName', permissionMode: 'safe' }])
  const prompt = h.calls.find(c => c.kind === 'send')?.args[1]
  expect(prompt).toContain('Analysis profile: design-review')
  expect(prompt).toContain('rox.meeting.knowledge, rox.meeting.scribe')
  expect(prompt).toContain('meeting.design-review.v1')
  expect(prompt).toContain('Do not send or change anything')
  expect(prompt).toContain('[segmentId=s1')
  expect(h.calls.find(c => c.kind === 'update')?.args[0]).toMatchObject({ summaryRun: { sessionId: 'analysis-a', transcriptRevision: 7 } })
  const source = readFileSync(resolve(renderer, 'pages/MeetingsPage.tsx'), 'utf8')
  expect(source).toContain('<LocalMeetingDetail')
})
test('explicit slash profile dispatches once; invalid or unpermitted slash never creates a session', async () => {
  const allowed = analysis('/discovery questions'); await allowed.run()
  expect(allowed.calls.filter(c => c.kind === 'create')).toHaveLength(1)
  expect(allowed.calls.find(c => c.kind === 'send')?.args[1]).toContain('Analysis profile: discovery')
  for (const slash of ['/unknown-tool', '/meeting-assist', 'ordinary text']) {
    const denied = analysis(slash, 'standup'); await denied.run()
    expect(denied.calls.filter(c => c.kind === 'create' || c.kind === 'send')).toHaveLength(0)
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
