import { expect, test } from 'bun:test'
import { OmpAgent } from '../omp-agent'
import { createFakeOmp, makeOmpConfig } from './omp-fake-cli'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept }); return { promise, resolve } }
function methodFixture() {
  const fake = createFakeOmp()
  const agent = new OmpAgent(makeOmpConfig(fake))
  const current = agent as unknown as {
    subprocess: unknown; autoApproveAtSpawn: boolean; _isProcessing: boolean; runtimeObservationRunId: string;
    send: (frame: Record<string, unknown>) => void;
    executeHostSessionTool: (name: string, args: Record<string, unknown>) => Promise<{ content: string; isError: boolean }>;
    executeHostToolCall: (id: string, name: string, args: Record<string, unknown>) => Promise<void>;
    pendingHostToolCalls: Map<string, { cancelled: boolean }>
  }
  const sent: Record<string, unknown>[] = []
  // Controlled actual-method ownership test. This child identity is not a
  // launched native process; real child cancellation is covered separately.
  current.subprocess = Object.freeze({ fixtureChild: true })
  current.autoApproveAtSpawn = true; current._isProcessing = true; current.runtimeObservationRunId = 'owned-turn'
  current.send = frame => { sent.push(frame) }
  return { agent, current, sent, dispose() { current.subprocess = null; current._isProcessing = false; agent.destroy(); fake.cleanup() } }
}

test('actual OmpAgent suppresses a superseded frame result and preserves the current pending entry', async () => {
  const fixture = methodFixture()
  const old = deferred<{ content: string; isError: boolean }>(); const fresh = deferred<{ content: string; isError: boolean }>()
  const invoked: unknown[] = []
  fixture.current.executeHostSessionTool = async (_name, args) => { invoked.push(args.version); return args.version === 'old' ? old.promise : fresh.promise }
  try {
    const first = fixture.current.executeHostToolCall('reused-frame', 'bash', { version: 'old' })
    const oldEntry = fixture.current.pendingHostToolCalls.get('reused-frame')!
    const second = fixture.current.executeHostToolCall('reused-frame', 'bash', { version: 'current' })
    const currentEntry = fixture.current.pendingHostToolCalls.get('reused-frame')!
    expect(currentEntry).not.toBe(oldEntry)
    old.resolve({ content: 'OLD_RESULT', isError: false }); await first
    expect(fixture.sent).toHaveLength(0)
    expect(fixture.current.pendingHostToolCalls.get('reused-frame')).toBe(currentEntry)
    fresh.resolve({ content: 'CURRENT_RESULT', isError: false }); await second
    expect(invoked).toEqual(['old', 'current'])
    expect(fixture.sent).toEqual([{ type: 'host_tool_result', id: 'reused-frame', result: { content: [{ type: 'text', text: 'CURRENT_RESULT' }] } }])
    expect(fixture.current.pendingHostToolCalls.has('reused-frame')).toBe(false)
  } finally { old.resolve({ content: '', isError: true }); fresh.resolve({ content: '', isError: true }); fixture.dispose() }
})

test('an old permission response cannot execute a superseded actual host frame', async () => {
  const fixture = methodFixture()
  const permissions: string[] = []; const invoked: unknown[] = []
  fixture.current.autoApproveAtSpawn = false
  fixture.agent.onPermissionRequest = request => { permissions.push(request.requestId) }
  fixture.current.executeHostSessionTool = async (_name, args) => { invoked.push(args.version); return { content: String(args.version), isError: false } }
  try {
    const first = fixture.current.executeHostToolCall('reused-frame', 'bash', { version: 'old' })
    const second = fixture.current.executeHostToolCall('reused-frame', 'bash', { version: 'current' })
    expect(permissions).toHaveLength(2)
    fixture.agent.respondToPermission(permissions[0]!, true); await first
    expect(invoked).toHaveLength(0); expect(fixture.sent).toHaveLength(0)
    fixture.agent.respondToPermission(permissions[1]!, true); await second
    expect(invoked).toEqual(['current'])
    expect(fixture.sent).toEqual([{ type: 'host_tool_result', id: 'reused-frame', result: { content: [{ type: 'text', text: 'current' }] } }])
  } finally { fixture.dispose() }
})
