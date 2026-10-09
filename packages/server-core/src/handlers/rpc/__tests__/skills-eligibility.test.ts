/**
 * skills:getEligibility — the RPC surface of the eligibility report. Verifies
 * the channel is registered and the handler returns the full report plus the
 * frozen per-skill verdict, resolved against a real workspace fixture.
 */

import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'

const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'skills-eligibility-rpc-')))
mkdirSync(join(workspaceRoot, 'skills', 'fixture'), { recursive: true })
writeFileSync(
  join(workspaceRoot, 'skills', 'fixture', 'SKILL.md'),
  '---\nname: Fixture\ndescription: Fixture skill\n---\nDo fixture work.',
)

mock.module('@rox/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => (id === 'ws-test' ? { id, rootPath: workspaceRoot } : null),
  getWorkspaces: () => [],
}))

type Handler = (ctx: unknown, ...args: unknown[]) => unknown

interface EligibilityResult {
  eligible: boolean
  reason?: string
  report: {
    eligible: Array<{ slug: string }>
    ineligible: unknown[]
    collisions: unknown[]
  }
}

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('skills:getEligibility', () => {
  it('registers the channel and returns the eligibility report', async () => {
    const { registerSkillsHandlers, HANDLED_CHANNELS } = await import('../skills.ts')
    expect(HANDLED_CHANNELS).toContain(RPC_CHANNELS.skills.GET_ELIGIBILITY)

    const handlers = new Map<string, Handler>()
    const server = {
      handle(channel: string, handler: Handler) {
        handlers.set(channel, handler)
      },
    } as unknown as RpcServer
    registerSkillsHandlers(server, { platform: {} } as HandlerDeps)

    const ctx = { clientId: 'native-client', workspaceId: 'ws-test', webContentsId: null }
    const result = (await handlers.get(RPC_CHANNELS.skills.GET_ELIGIBILITY)!(ctx, 'ws-test', 'fixture')) as EligibilityResult

    expect(result.eligible).toBe(true)
    expect(result.report.eligible.some(skill => skill.slug === 'fixture')).toBe(true)
    expect(Array.isArray(result.report.ineligible)).toBe(true)
    expect(Array.isArray(result.report.collisions)).toBe(true)
  })

  it('reports an unknown slug as ineligible with a reason', async () => {
    const { registerSkillsHandlers } = await import('../skills.ts')
    const handlers = new Map<string, Handler>()
    const server = {
      handle(channel: string, handler: Handler) {
        handlers.set(channel, handler)
      },
    } as unknown as RpcServer
    registerSkillsHandlers(server, { platform: {} } as HandlerDeps)

    const ctx = { clientId: 'native-client', workspaceId: 'ws-test', webContentsId: null }
    const result = (await handlers.get(RPC_CHANNELS.skills.GET_ELIGIBILITY)!(ctx, 'ws-test', 'no-such-skill')) as EligibilityResult

    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('no-such-skill')
  })

  it('reports a collision for the queried slug across the ordered root plan', async () => {
    // Same slug provided by the workspace and the OMP workspace tier.
    const skill = 'collision-fixture'
    for (const [dir, body] of [
      [join(workspaceRoot, 'skills', skill), 'workspace copy'],
      [join(workspaceRoot, '.omp', 'skills', skill), 'omp copy'],
    ] as const) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), `---\nname: Collision\ndescription: ${body}\n---\n${body}`)
    }

    const { registerSkillsHandlers } = await import('../skills.ts')
    const handlers = new Map<string, Handler>()
    const server = {
      handle(channel: string, handler: Handler) {
        handlers.set(channel, handler)
      },
    } as unknown as RpcServer
    registerSkillsHandlers(server, { platform: {} } as HandlerDeps)

    const ctx = { clientId: 'native-client', workspaceId: 'ws-test', webContentsId: null }
    const result = (await handlers.get(RPC_CHANNELS.skills.GET_ELIGIBILITY)!(ctx, 'ws-test', skill)) as EligibilityResult

    expect(result.eligible).toBe(true)
    expect(result.report.collisions).toEqual([
      { name: skill, winner: 'workspace', shadowed: ['omp-workspace'] },
    ])
  })
})