/**
 * WP-111 `learning:*` RPC tests: registration/gating, workspace binding,
 * payload validation, and owner/workspace stamping for the agent/native
 * actions (`observe`/`recordOutcome`/`recordCorrection`).
 *
 * Harness mirrors memory-io.test.ts: config dir is redirected by
 * memory-test-setup before any module reads it, and the learning service is a
 * call-recording stub — no workspace store is touched.
 */
import '../memory-test-setup' // must run before any module reading CRAFT_CONFIG_DIR
import { describe, expect, it } from 'bun:test'
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import type { HandlerFn, RequestContext, RpcHandlerOptions, RpcServer } from '@rox/server-core/transport'
import type { LearningPolicy, TaskOutcome, UserCorrection } from '@rox/shared/memory/learning'
import type { HandlerDeps, LearningRpcService } from '../../handler-deps'
import { HANDLED_CHANNELS, registerLearningHandlers } from '../learning'

type Recorded = { method: string; args: unknown[] }

function createService(recorded: Recorded[], policies: LearningPolicy[] = []): LearningRpcService {
  const record = (method: string, ...args: unknown[]) => {
    recorded.push({ method, args })
  }
  return {
    observeCompletion: event => record('observeCompletion', event),
    recordCorrection: correction => record('recordCorrection', correction),
    recordOutcome: (workspaceId, outcome) => record('recordOutcome', workspaceId, outcome),
    recordToolOutcome: () => {},
    recordContextUsage: () => {},
    ingestDistilled: async () => ({ handled: false, promoted: false }),
    reflectSession: async (workspaceId, sessionId) => {
      record('reflectSession', workspaceId, sessionId)
      return { candidates: [] }
    },
    runConsolidation: async workspaceId => {
      record('runConsolidation', workspaceId)
      return { candidates: [] }
    },
    runSkillCuration: async workspaceId => {
      record('runSkillCuration', workspaceId)
      return { items: [] }
    },
    runPolicyLearning: async workspaceId => {
      record('runPolicyLearning', workspaceId)
      return { policies: [] }
    },
    runGarbageCollection: async () => ({ archived: 0 }),
    evaluateOutcomes: async () => ({ rolledBack: [] }),
    listCandidates: (workspaceId, filter) => {
      record('listCandidates', workspaceId, filter)
      return []
    },
    getCandidate: (workspaceId, id) => {
      record('getCandidate', workspaceId, id)
      return null
    },
    approveCandidate: async (workspaceId, id) => {
      record('approveCandidate', workspaceId, id)
      return { promoted: true, status: 'active', mutations: [] }
    },
    rejectCandidate: (workspaceId, id, reason) => {
      record('rejectCandidate', workspaceId, id, reason)
      return null
    },
    rollbackCandidate: async (workspaceId, id) => {
      record('rollbackCandidate', workspaceId, id)
      return { reverted: true, mutationIds: [] }
    },
    getTimeline: (workspaceId, limit) => {
      record('getTimeline', workspaceId, limit)
      return []
    },
    getStats: workspaceId => {
      record('getStats', workspaceId)
      return {
        observations: 1,
        candidates: 2,
        activeCandidates: 3,
        rejectedCandidates: 4,
        outcomes: 5,
        mutations: 6,
        revertedMutations: 7,
        policies: 8,
      }
    },
    whenIdle: async () => {},
    listEvidence: (workspaceId, candidateId) => {
      record('listEvidence', workspaceId, candidateId)
      return []
    },
    getOutcome: (workspaceId, id) => {
      record('getOutcome', workspaceId, id)
      return null
    },
    getExperiment: (workspaceId, id) => {
      record('getExperiment', workspaceId, id)
      return null
    },
    getSkillEffectiveness: (workspaceId, targetId) => {
      record('getSkillEffectiveness', workspaceId, targetId)
      return null
    },
    getPolicies: workspaceId => {
      record('getPolicies', workspaceId)
      return policies
    },
    revalidateCandidate: async (workspaceId, id) => {
      record('revalidateCandidate', workspaceId, id)
      return null
    },
  }
}

interface HarnessConfig {
  /** Omit the learning service to exercise the portless-host path. */
  service?: boolean
  /** Value returned by `deps.nativeData.authority.authorize` for principals. */
  principalAuthorized?: boolean
  /** Value returned by `server.isRequestContextCurrent`. */
  requestCurrent?: boolean
  /** Policies served by `getPolicies`. */
  policies?: LearningPolicy[]
}

function createHarness(config: HarnessConfig = {}) {
  const recorded: Recorded[] = []
  const handlers: Record<string, HandlerFn | undefined> = {}
  const options: Record<string, RpcHandlerOptions | undefined> = {}
  const server: RpcServer = {
    handle(channel, handler, handlerOptions) {
      handlers[channel] = handler
      if (handlerOptions) options[channel] = handlerOptions
    },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
    isRequestContextCurrent: () => config.requestCurrent !== false,
  }
  const deps: HandlerDeps = {
    sessionManager: {} as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  }
  if (config.service !== false) deps.learning = createService(recorded, config.policies)
  if (config.principalAuthorized !== undefined) {
    deps.nativeData = {
      authority: { authorize: () => config.principalAuthorized === true },
      journal: {},
      sync: {},
    } as unknown as HandlerDeps['nativeData']
  }
  registerLearningHandlers(server, deps)
  const invokeAs = (ctx: RequestContext, channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers[channel]
    if (!handler) throw new Error(`No handler registered for ${channel}`)
    return handler(ctx, ...args)
  }
  return {
    recorded,
    options,
    handlers,
    invokeAs,
    invoke: (channel: string, ...args: unknown[]) => invokeAs(localContext(), channel, ...args),
  }
}

/** Local Electron client: no principal, workspace bound by the window. */
function localContext(workspaceId = 'ws1'): RequestContext {
  return { clientId: 'c1', workspaceId, webContentsId: null }
}

/** Native principal (agent runtime) — authorization comes from NativeAuthority. */
function nativeContext(workspaceId: string | null = 'ws1'): RequestContext {
  return {
    clientId: 'native-1',
    workspaceId,
    webContentsId: null,
    principal: { issuer: 'native', subject: 'agent', credentialId: 'cred-1', credentialVersion: 1 },
  }
}

async function rejectionCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run()
    return undefined
  } catch (error) {
    return error instanceof CodedError ? error.code : undefined
  }
}

function taskOutcome(overrides: Partial<TaskOutcome> = {}): TaskOutcome {
  return {
    id: 'outcome-1',
    sessionId: 'session-1',
    taskFingerprint: 'fp-1',
    status: 'success',
    userCorrections: 0,
    memoryUsed: [],
    skillsUsed: [],
    errors: [],
    ts: '2026-10-08T00:00:00.000Z',
    ...overrides,
  }
}

function userCorrection(overrides: Partial<UserCorrection> = {}): UserCorrection {
  return {
    id: 'correction-1',
    sessionId: 'session-1',
    original: 'old text',
    corrected: 'new text',
    category: 'fact',
    confidence: 0.9,
    ts: '2026-10-08T00:00:00.000Z',
    ...overrides,
  }
}

function learningPolicy(overrides: Partial<LearningPolicy> = {}): LearningPolicy {
  return {
    id: 'policy-1',
    fingerprint: 'fp-1',
    taskClass: 'refactor',
    preferredSkills: [],
    verification: [],
    delegation: 'neutral',
    confidence: 0.5,
    evidence: [],
    status: 'active',
    createdAt: '2026-10-08T00:00:00.000Z',
    updatedAt: '2026-10-08T00:00:00.000Z',
    ...overrides,
  }
}

const CH = RPC_CHANNELS.learning
const READ_CHANNELS = [
  CH.LIST_CANDIDATES,
  CH.GET_CANDIDATE,
  CH.LIST_EVIDENCE,
  CH.GET_OUTCOME,
  CH.GET_EXPERIMENT,
  CH.GET_STATS,
  CH.GET_SKILL_EFFECTIVENESS,
  CH.GET_POLICY,
  CH.GET_TIMELINE,
] as const
const ACTION_CHANNELS = [
  CH.APPROVE,
  CH.REJECT,
  CH.ROLLBACK,
  CH.REVALIDATE,
  CH.FORCE_REFLECT,
  CH.CONSOLIDATE,
  CH.CURATE_SKILLS,
  CH.RUN_POLICY_LEARNING,
] as const
const AGENT_CHANNELS = [CH.OBSERVE, CH.RECORD_OUTCOME, CH.RECORD_CORRECTION] as const

describe('learning:* registration', () => {
  it('registers every channel in HANDLED_CHANNELS and nothing else', () => {
    const harness = createHarness()
    expect(HANDLED_CHANNELS).toHaveLength(20)
    expect(Object.keys(harness.handlers).sort()).toEqual([...HANDLED_CHANNELS].sort())
  })

  it('covers the whole learning namespace exactly once', () => {
    expect([...HANDLED_CHANNELS].sort()).toEqual(Object.values(CH).sort())
  })

  it('declares a native grant for every channel', () => {
    const harness = createHarness()
    for (const channel of HANDLED_CHANNELS) {
      expect(harness.options[channel]?.nativeAction).toBeDefined()
    }
    for (const channel of READ_CHANNELS) {
      expect(harness.options[channel]).toEqual({ nativeAction: 'read' })
    }
    for (const channel of ACTION_CHANNELS) {
      expect(harness.options[channel]).toEqual({ nativeAction: 'write' })
    }
    for (const channel of AGENT_CHANNELS) {
      expect(harness.options[channel]).toEqual({ access: 'nativeOrLocalElectron', nativeAction: 'write' })
    }
  })

  it('answers UNSUPPORTED_OPERATION when the host exposes no learning service', async () => {
    const harness = createHarness({ service: false })
    expect(await rejectionCode(() => harness.invoke(CH.GET_STATS, 'ws1'))).toBe('UNSUPPORTED_OPERATION')
    expect(await rejectionCode(() => harness.invoke(CH.APPROVE, 'ws1', 'cand-1'))).toBe('UNSUPPORTED_OPERATION')
    expect(await rejectionCode(() => harness.invoke(
      CH.OBSERVE,
      { workspaceId: 'ws1', sessionId: 'session-1', reason: 'complete' },
    ))).toBe('UNSUPPORTED_OPERATION')
  })
})

describe('learning:* reads', () => {
  it('binds the request to the window workspace and passes the filter through', async () => {
    const harness = createHarness()
    expect(await harness.invoke(CH.LIST_CANDIDATES, 'ws1', { status: 'candidate' })).toEqual([])
    expect(await harness.invoke(CH.LIST_CANDIDATES, 'ws1')).toEqual([])
    expect(harness.recorded).toEqual([
      { method: 'listCandidates', args: ['ws1', { status: 'candidate' }] },
      { method: 'listCandidates', args: ['ws1', undefined] },
    ])
  })

  it('refuses a payload workspace that disagrees with the bound workspace', async () => {
    const harness = createHarness()
    expect(await rejectionCode(() => harness.invoke(CH.GET_CANDIDATE, 'ws2', 'cand-1'))).toBe('FORBIDDEN')
    expect(harness.recorded).toEqual([])
  })

  it('requires a workspace when neither the binding nor the payload supplies one', async () => {
    const harness = createHarness()
    const unbound: RequestContext = { clientId: 'c1', workspaceId: null, webContentsId: null }
    expect(await rejectionCode(() => harness.invokeAs(unbound, CH.GET_STATS))).toBe('INVALID_PAYLOAD')
    expect(harness.recorded).toEqual([])
  })

  it('validates ids, filters, limits and target ids before touching the service', async () => {
    const harness = createHarness()
    const invalid = 'INVALID_PAYLOAD'
    expect(await rejectionCode(() => harness.invoke(CH.LIST_CANDIDATES, 'ws1', { status: 'exploded' }))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.LIST_CANDIDATES, 'ws1', []))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.GET_CANDIDATE, 'ws1', ''))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.GET_CANDIDATE, 'ws1', 'x'.repeat(300)))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.GET_CANDIDATE, 'ws1', 'bad\u0000id'))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.LIST_EVIDENCE, 'ws1', 42))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.GET_SKILL_EFFECTIVENESS, 'ws1', null))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.GET_TIMELINE, 'ws1', 0))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.GET_TIMELINE, 'ws1', 1.5))).toBe(invalid)
    expect(harness.recorded).toEqual([])
  })

  it('lists the workspace evidence ledger and one candidate evidence set', async () => {
    const harness = createHarness()
    await harness.invoke(CH.LIST_EVIDENCE, 'ws1')
    await harness.invoke(CH.LIST_EVIDENCE, 'ws1', 'cand-1')
    expect(harness.recorded).toEqual([
      { method: 'listEvidence', args: ['ws1', undefined] },
      { method: 'listEvidence', args: ['ws1', 'cand-1'] },
    ])
  })

  it('serves all learned policies and narrows to a single id', async () => {
    const policies = [learningPolicy({ id: 'policy-1' }), learningPolicy({ id: 'policy-2' })]
    const harness = createHarness({ policies })
    expect(await harness.invoke(CH.GET_POLICY, 'ws1')).toEqual(policies)
    expect(await harness.invoke(CH.GET_POLICY, 'ws1', 'policy-2')).toEqual([policies[1]])
    expect(await rejectionCode(() => harness.invoke(CH.GET_POLICY, 'ws1', ''))).toBe('INVALID_PAYLOAD')
    expect(harness.recorded.map(entry => entry.method)).toEqual(['getPolicies', 'getPolicies'])
  })

  it('passes an explicit timeline limit through', async () => {
    const harness = createHarness()
    await harness.invoke(CH.GET_TIMELINE, 'ws1', 25)
    expect(harness.recorded).toEqual([{ method: 'getTimeline', args: ['ws1', 25] }])
  })
})

describe('learning:* actions', () => {
  it('delegates the candidate lifecycle to the scoped workspace', async () => {
    const harness = createHarness()
    await harness.invoke(CH.APPROVE, 'ws1', 'cand-1')
    await harness.invoke(CH.REJECT, 'ws1', 'cand-2', 'not repeatable')
    await harness.invoke(CH.REJECT, 'ws1', 'cand-3')
    await harness.invoke(CH.ROLLBACK, 'ws1', 'cand-4')
    await harness.invoke(CH.REVALIDATE, 'ws1', 'cand-5')
    await harness.invoke(CH.FORCE_REFLECT, 'ws1', 'session-1')
    expect(harness.recorded).toEqual([
      { method: 'approveCandidate', args: ['ws1', 'cand-1'] },
      { method: 'rejectCandidate', args: ['ws1', 'cand-2', 'not repeatable'] },
      { method: 'rejectCandidate', args: ['ws1', 'cand-3', undefined] },
      { method: 'rollbackCandidate', args: ['ws1', 'cand-4'] },
      { method: 'revalidateCandidate', args: ['ws1', 'cand-5'] },
      { method: 'reflectSession', args: ['ws1', 'session-1'] },
    ])
  })

  it('delegates the background learning passes', async () => {
    const harness = createHarness()
    await harness.invoke(CH.CONSOLIDATE, 'ws1')
    await harness.invoke(CH.CURATE_SKILLS, 'ws1')
    await harness.invoke(CH.RUN_POLICY_LEARNING, 'ws1')
    expect(harness.recorded).toEqual([
      { method: 'runConsolidation', args: ['ws1'] },
      { method: 'runSkillCuration', args: ['ws1'] },
      { method: 'runPolicyLearning', args: ['ws1'] },
    ])
  })

  it('validates action arguments before touching the service', async () => {
    const harness = createHarness()
    const invalid = 'INVALID_PAYLOAD'
    expect(await rejectionCode(() => harness.invoke(CH.APPROVE, 'ws1', ''))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.REVALIDATE, 'ws1', 7))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.FORCE_REFLECT, 'ws1', null))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.REJECT, 'ws1', 'cand-1', 'x'.repeat(2_001)))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.APPROVE, 'ws2', 'cand-1'))).toBe('FORBIDDEN')
    expect(harness.recorded).toEqual([])
  })
})

describe('learning:* agent actions', () => {
  it('records a completion observation for the local agent runtime', async () => {
    const harness = createHarness()
    await harness.invoke(CH.OBSERVE, { workspaceId: 'ws1', sessionId: 'session-1', reason: 'complete' })
    expect(harness.recorded).toEqual([
      { method: 'observeCompletion', args: [{ workspaceId: 'ws1', sessionId: 'session-1', reason: 'complete' }] },
    ])
  })

  it('rejects an unknown observation before recording it', async () => {
    const harness = createHarness()
    const invalid = 'INVALID_PAYLOAD'
    expect(await rejectionCode(() => harness.invoke(
      CH.OBSERVE,
      { workspaceId: 'ws1', sessionId: 'session-1', reason: 'exploded' },
    ))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(
      CH.OBSERVE,
      { workspaceId: 'ws1', sessionId: 'session-1' },
    ))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.OBSERVE, { workspaceId: 'ws1', reason: 'complete' }))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.OBSERVE, undefined))).toBe(invalid)
    expect(harness.recorded).toEqual([])
  })

  it('stamps outcomes with the authenticated owner and workspace', async () => {
    const harness = createHarness()
    await harness.invoke(CH.RECORD_OUTCOME, {
      workspaceId: 'ws1',
      outcome: taskOutcome({ workspaceId: 'other-workspace', owner: { issuer: 'forged', subject: 'someone-else' } }),
    })
    expect(harness.recorded).toHaveLength(1)
    const [call] = harness.recorded
    expect(call.method).toBe('recordOutcome')
    expect(call.args[0]).toBe('ws1')
    expect(call.args[1]).toMatchObject({ id: 'outcome-1', workspaceId: 'ws1', status: 'success' })
    // The local runtime has no principal: no owner may be recorded, forged or otherwise.
    expect(JSON.stringify(call.args[1])).not.toContain('forged')
  })

  it('stamps corrections with the authenticated owner and workspace', async () => {
    const harness = createHarness()
    await harness.invoke(CH.RECORD_CORRECTION, {
      workspaceId: 'ws1',
      correction: userCorrection({ workspaceId: 'other-workspace', owner: { issuer: 'forged', subject: 'someone-else' } }),
    })
    expect(harness.recorded).toHaveLength(1)
    const [call] = harness.recorded
    expect(call.method).toBe('recordCorrection')
    expect(call.args[0]).toMatchObject({ id: 'correction-1', workspaceId: 'ws1', category: 'fact' })
    expect(JSON.stringify(call.args[0])).not.toContain('forged')
  })

  it('validates outcome and correction rows before recording them', async () => {
    const harness = createHarness()
    const invalid = 'INVALID_PAYLOAD'
    const outcome = (overrides: Record<string, unknown>) =>
      harness.invoke(CH.RECORD_OUTCOME, { workspaceId: 'ws1', outcome: { ...taskOutcome(), ...overrides } })
    expect(await rejectionCode(() => outcome({ status: 'exploded' }))).toBe(invalid)
    expect(await rejectionCode(() => outcome({ id: '' }))).toBe(invalid)
    expect(await rejectionCode(() => outcome({ ts: undefined }))).toBe(invalid)
    expect(await rejectionCode(() => outcome({ userCorrections: -1 }))).toBe(invalid)
    expect(await rejectionCode(() => outcome({ memoryUsed: 'lesson' }))).toBe(invalid)
    expect(await rejectionCode(() => outcome({ qualityScore: -0.5 }))).toBe(invalid)
    expect(await rejectionCode(() => outcome({ verification: { testsPassed: 1.5 } }))).toBe(invalid)
    expect(await rejectionCode(() => outcome({ verification: { buildPassed: 'yes' } }))).toBe(invalid)
    expect(await rejectionCode(() => harness.invoke(CH.RECORD_OUTCOME, { workspaceId: 'ws1' }))).toBe(invalid)
    const correction = (overrides: Record<string, unknown>) =>
      harness.invoke(CH.RECORD_CORRECTION, { workspaceId: 'ws1', correction: { ...userCorrection(), ...overrides } })
    expect(await rejectionCode(() => correction({ category: 'vibes' }))).toBe(invalid)
    expect(await rejectionCode(() => correction({ confidence: 1.5 }))).toBe(invalid)
    expect(await rejectionCode(() => correction({ original: '' }))).toBe(invalid)
    expect(await rejectionCode(() => correction({ sessionId: null }))).toBe(invalid)
    expect(await rejectionCode(() => correction({ sourceObservationIds: [null] }))).toBe(invalid)
    expect(harness.recorded).toEqual([])
  })

  it('keeps a valid verification snapshot and optional metrics', async () => {
    const harness = createHarness()
    await harness.invoke(CH.RECORD_OUTCOME, {
      workspaceId: 'ws1',
      outcome: taskOutcome({ durationMs: 1_200, qualityScore: 0.75, verification: { testsPassed: 12, buildPassed: true } }),
    })
    const [call] = harness.recorded
    expect(call.args[1]).toMatchObject({
      durationMs: 1_200,
      qualityScore: 0.75,
      verification: { testsPassed: 12, buildPassed: true },
    })
  })

  it('denies a native caller without the write grant', async () => {
    const harness = createHarness({ principalAuthorized: false })
    expect(await rejectionCode(() => harness.invokeAs(
      nativeContext('ws1'),
      CH.OBSERVE,
      { workspaceId: 'ws1', sessionId: 'session-1', reason: 'complete' },
    ))).toBe('FORBIDDEN')
    expect(harness.recorded).toEqual([])
  })

  it('denies a granted native caller once the request context is stale', async () => {
    const harness = createHarness({ principalAuthorized: true, requestCurrent: false })
    expect(await rejectionCode(() => harness.invokeAs(
      nativeContext('ws1'),
      CH.RECORD_OUTCOME,
      { workspaceId: 'ws1', outcome: taskOutcome() },
    ))).toBe('FORBIDDEN')
    expect(harness.recorded).toEqual([])
  })

  it('denies a native caller with no bound workspace', async () => {
    const harness = createHarness({ principalAuthorized: true })
    expect(await rejectionCode(() => harness.invokeAs(
      nativeContext(null),
      CH.OBSERVE,
      { workspaceId: null, sessionId: 'session-1', reason: 'complete' },
    ))).toBe('FORBIDDEN')
    expect(harness.recorded).toEqual([])
  })

  it('uses the bound workspace for a granted native caller', async () => {
    const harness = createHarness({ principalAuthorized: true })
    await harness.invokeAs(nativeContext('ws1'), CH.OBSERVE, { sessionId: 'session-1', reason: 'timeout' })
    expect(harness.recorded).toEqual([
      { method: 'observeCompletion', args: [{ workspaceId: 'ws1', sessionId: 'session-1', reason: 'timeout' }] },
    ])
    expect(await rejectionCode(() => harness.invokeAs(
      nativeContext('ws1'),
      CH.OBSERVE,
      { workspaceId: 'ws2', sessionId: 'session-1', reason: 'timeout' },
    ))).toBe('FORBIDDEN')
  })

  it('stamps the native principal identity as owner', async () => {
    const harness = createHarness({ principalAuthorized: true })
    await harness.invokeAs(nativeContext('ws1'), CH.RECORD_OUTCOME, {
      workspaceId: 'ws1',
      outcome: taskOutcome({ owner: { issuer: 'forged', subject: 'someone-else' } }),
    })
    expect(harness.recorded).toEqual([
      {
        method: 'recordOutcome',
        args: ['ws1', taskOutcome({ workspaceId: 'ws1', owner: { issuer: 'native', subject: 'agent' } })],
      },
    ])
  })
})