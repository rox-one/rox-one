/**
 * Factory-dispatch: OMP LlmConnection → public resolved-context factory → OmpAgent.
 *
 * Direct `createBackend({ provider: 'omp' })` is not enough — this path must
 * start from a seeded connection object and go through
 * `createBackendFromResolvedContext`.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { OmpAgent } from '../../omp-agent.ts'
import {
  BACKEND_CAPABILITIES,
  connectionToAgentProvider,
  createBackendFromResolvedContext,
} from '../factory.ts'
import type { LlmConnection } from '../../../config/llm-connections.ts'
import {
  chatEvents,
  createFakeOmp,
  makeOmpConfig,
  useFakeOmpEnv,
  type FakeOmp,
} from '../../__tests__/omp-fake-cli.ts'

let fake: FakeOmp | null = null
let restoreEnv: (() => void) | null = null
const agents: OmpAgent[] = []

afterEach(() => {
  for (const agent of agents.splice(0)) agent.destroy()
  restoreEnv?.()
  restoreEnv = null
  fake?.cleanup()
  fake = null
})

describe('OMP LlmConnection factory dispatch', () => {
  it('creates OmpAgent from an OMP LlmConnection and completes a fake-CLI turn', async () => {
    fake = createFakeOmp('healthy')
    restoreEnv = useFakeOmpEnv(fake)

    const connection: LlmConnection = {
      slug: 'rox-kimi',
      name: 'ROX',
      providerType: 'omp',
      authType: 'none',
      defaultModel: 'rox/standard',
      models: ['rox/explore', 'rox/standard', 'rox/max', 'rox/vision', 'rox/fast'],
      createdAt: Date.now(),
    }

    expect(connectionToAgentProvider(connection)).toBe('omp')

    const template = makeOmpConfig(fake)
    const agent = createBackendFromResolvedContext({
      context: {
        connection,
        provider: connectionToAgentProvider(connection),
        authType: 'none',
        resolvedModel: connection.defaultModel ?? 'rox/standard',
        capabilities: BACKEND_CAPABILITIES.omp,
      },
      coreConfig: {
        workspace: template.workspace,
        session: template.session,
        isHeadless: true,
      },
      hostRuntime: {
        appRootPath: process.cwd(),
        isPackaged: false,
      },
    })

    expect(agent).toBeInstanceOf(OmpAgent)
    agents.push(agent as OmpAgent)

    const events = await chatEvents(agent, 'hello', 8_000)
    const complete = events.filter((event) => event.type === 'text_complete')
    expect(complete.length).toBeGreaterThan(0)
    expect(events.some((event) => event.type === 'complete')).toBe(true)
    expect(agent.isProcessing()).toBe(false)
  })
})
