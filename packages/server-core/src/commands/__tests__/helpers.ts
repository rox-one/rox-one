import { CommandRegistry, PLACEHOLDER_PAYLOAD_SCHEMA, type CommandDefinition } from '@rox/core/commands'
import { createCommandRegistry } from '../registry'

/** Registry with the full catalogue + system.ping + a local and a workspace counter command. */
export function testRegistry(options: { flags?: Set<string> } = {}) {
  const flags = options.flags ?? new Set<string>()
  const registry = createCommandRegistry({ isFlagEnabled: flag => flags.has(flag) })
  const state = { value: 0, revision: 0, calls: 0 }
  const counter = (type: string, authority: CommandDefinition['authority']): CommandDefinition<unknown> => ({
    type: type as `${string}.${string}`,
    module: 'test',
    authority,
    verb: 'write',
    schema: PLACEHOLDER_PAYLOAD_SCHEMA,
    schemaBound: false,
  })
  registry.define(counter('test.increment', 'local'))
  registry.define(counter('test.remote_increment', 'workspace'))
  registry.define(counter('test.unbound', 'local'))
  const handler = (ctx: { envelope: { expectedRevision?: number }; payload: unknown; conflict(rev: number, current?: unknown): never }) => {
    state.calls += 1
    const payload = ctx.payload as { by?: number; fail?: boolean }
    if (ctx.envelope.expectedRevision !== undefined && ctx.envelope.expectedRevision !== state.revision) {
      ctx.conflict(state.revision, { value: state.value })
    }
    if (payload.fail) throw new Error('boom')
    state.value += payload.by ?? 1
    state.revision += 1
    return {
      ref: { kind: 'task' as const, id: 'counter' },
      revision: state.revision,
      result: { value: state.value },
      events: [{ type: 'task.task_status_change' as const, payload: { value: state.value } }],
    }
  }
  registry.bind('test.increment', handler)
  registry.bind('test.remote_increment', handler)
  return { registry, state, flags }
}

export function envelope(type: string, payload: unknown, extra: Record<string, unknown> = {}) {
  return {
    commandId: (extra.commandId as string | undefined) ?? crypto.randomUUID(),
    type,
    payload,
    issuedAt: '2026-10-08T00:00:00.000Z',
    ...extra,
  }
}

export const ACTOR = { principalId: 'user-1', kind: 'user' as const }
export const WS = 'ws-1'

export { CommandRegistry }
