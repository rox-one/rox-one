import { strict as assert } from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OmpAgent } from '@rox/shared/agent/omp-agent'
import { ensureConfigDir } from '@rox/shared/config/storage'
import { createFakeOmp, makeOmpConfig, useFakeOmpEnv } from '@rox/shared/agent/__tests__/omp-fake-cli'
import { RuntimeTraceService } from './service'
import type { RuntimeEvent } from '@rox/core/runtime-trace'

const scenario = process.argv[2]!
ensureConfigDir()
const fake = createFakeOmp(scenario === 'transport' ? 'host-tool-bash-cancel' : 'host-tool-bash-abort')
const restore = useFakeOmpEnv(fake)
const agent = new OmpAgent(makeOmpConfig(fake))
const session = { id: 'parent', workspaceId: 'ws-test', directory: join(process.env.ROX_CONFIG_DIR!, 'parent') }
const emitted: RuntimeEvent[] = []
const trace = new RuntimeTraceService(id => id === session.id ? session : undefined, event => emitted.push(event))
const run = await trace.begin(session.id, 'Isolated cancellation fixture')
let aborted = false
try {
  for await (const event of agent.chat('Isolated cancellation fixture')) {
    await trace.agentEvent(session.id, event as never, { structuredHostTerminals: true, originRun: run })
    if (scenario === 'model' && !aborted && event.type === 'runtime_observation' && event.observation.kind === 'terminal.output') {
      aborted = true
      await agent.abort('isolated cancellation fixture')
    }
  }
  await trace.finish(session.id, scenario === 'model' ? 'interrupted' : 'complete', run)
  fake.setScenario('healthy')
  await agent.reconnect()
  const successor = await trace.begin(session.id, 'Successor fixture')
  for await (const event of agent.chat('Successor fixture')) await trace.agentEvent(session.id, event as never, { originRun: successor })
  await trace.finish(session.id, 'complete', successor)
  // The real local process continues after transport cancellation. Wait for its independent
  // completion marker, then prove its late stdout/result was not delivered to the old/new turn.
  const deadline = Date.now() + 3000
  while (!existsSync(join(fake.workspaceRoot, 'fixture-finished')) && Date.now() < deadline) await Bun.sleep(10)
  assert.equal(readFileSync(join(fake.workspaceRoot, 'fixture-finished'), 'utf8'), 'finished')
  const coverage = emitted.find(event => event.kind === 'trace.coverage')
  assert.equal(coverage?.kind, 'trace.coverage')
  if (coverage?.kind !== 'trace.coverage') throw new Error('Missing cancellation coverage')
  assert.deepEqual(coverage.payload.coverage.missing, ['unconfirmed-host-process-termination'])
  assert.equal(coverage.toolUseId, 'exact-cancel-call')
  assert.equal(coverage.elapsedMs, undefined)
  const terminal = emitted.filter(event => event.kind.startsWith('terminal.'))
  assert.ok(terminal.some(event => event.kind === 'terminal.started'))
  assert.ok(terminal.some(event => event.kind === 'terminal.output' && event.payload.stdout?.text === 'before-cancel'))
  assert.equal(terminal.some(event => event.kind === 'terminal.completed'), false)
  assert.equal(terminal.filter(event => event.kind === 'terminal.output').map(event => event.payload.stdout?.text ?? '').join('').includes('late-after-cancel'), false)
  assert.equal(terminal.some(event => event.kind === 'terminal.output' && event.payload.durationMs?.state === 'known'), false)
  assert.equal(fake.readRpcLog().some(event => event.type === 'host_tool_result' && event.id === 'htc-cancel'), false)
  const recovered = new RuntimeTraceService(id => id === session.id ? session : undefined, () => {})
  const snapshot = await recovered.getSnapshot({ workspaceId: 'ws-test', sessionId: session.id, rootRunId: run.rootRunId })
  assert.ok(snapshot.coverage.missing.includes('unconfirmed-host-process-termination'))
  assert.ok(snapshot.runs[0]?.coverage.missing.includes('unconfirmed-host-process-termination'))
  assert.notEqual(successor.rootRunId, run.rootRunId)
  assert.equal(emitted.some(event => event.rootRunId === successor.rootRunId && event.toolUseId === 'exact-cancel-call'), false)
  console.log(`runtime cancellation ${scenario} fixture passed`)
} finally { agent.destroy(); restore(); fake.cleanup() }
process.exit(0)
