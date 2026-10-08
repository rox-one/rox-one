import { describe, expect, test } from 'bun:test'
import {
  COMMAND_CATALOGUE,
  CommandMiddlewareChain,
  CommandRegistry,
  CommandRegistryError,
  PLACEHOLDER_PAYLOAD_SCHEMA,
  SYSTEM_PING_SCHEMA,
  canonicalCommandRequest,
  composeCommandMiddleware,
  createCommandEnvelope,
  duplicateReceipt,
  isCommandType,
  payloadByteLength,
  registerCommandCatalogue,
  type CommandDefinition,
  type CommandPipelineContext,
} from '../index.ts'
import { ROX2_PERMISSIONS } from '../../rox2/platform-contract.ts'

function def(type: string, extra: Partial<CommandDefinition<unknown>> = {}): CommandDefinition<unknown> {
  return { type: type as `${string}.${string}`, module: 'test', authority: 'local', verb: 'write', schema: PLACEHOLDER_PAYLOAD_SCHEMA, schemaBound: false, ...extra }
}

describe('CommandRegistry', () => {
  test('define rejects duplicates and invalid names', () => {
    const registry = new CommandRegistry()
    registry.define(def('demo.create'))
    expect(() => registry.define(def('demo.create'))).toThrow(CommandRegistryError)
    expect(() => registry.define(def('Demo.Bad'))).toThrow(/Invalid command type/)
    expect(() => registry.define(def('nodot'))).toThrow(/Invalid command type/)
  })

  test('capability discovery: unknown → flag_off → not_bound → available', () => {
    const flags = new Set<string>()
    const registry = new CommandRegistry({ isFlagEnabled: flag => flags.has(flag) })
    registry.define(def('demo.flagged', { flag: 'demo.v1' }))
    registry.define(def('demo.plain'))
    expect(registry.capability('demo.missing')).toEqual({ type: 'demo.missing', available: false, reason: 'unknown_command' })
    expect(registry.capability('demo.flagged')).toMatchObject({ available: false, reason: 'flag_off' })
    expect(registry.capability('demo.plain')).toMatchObject({ available: false, reason: 'not_bound' })
    registry.bind('demo.flagged', () => ({}))
    registry.bind('demo.plain', () => ({}))
    expect(registry.capability('demo.flagged')).toMatchObject({ available: false, reason: 'flag_off' })
    flags.add('demo.v1')
    expect(registry.capability('demo.flagged')).toMatchObject({ available: true })
    expect(registry.capability('demo.flagged')).not.toHaveProperty('reason')
    expect(registry.capability('demo.plain')).toMatchObject({ available: true })
  })

  test('a throwing flag source fails closed', () => {
    const registry = new CommandRegistry({ isFlagEnabled: () => { throw new Error('boom') } })
    registry.define(def('demo.flagged', { flag: 'x' }))
    registry.bind('demo.flagged', () => ({}))
    expect(registry.capability('demo.flagged')).toMatchObject({ available: false, reason: 'flag_off' })
  })

  test('bind requires a defined type and rejects a second handler', () => {
    const registry = new CommandRegistry()
    expect(() => registry.bind('demo.none', () => ({}))).toThrow(/Unknown command/)
    registry.define(def('demo.one'))
    registry.bind('demo.one', () => ({}))
    expect(() => registry.bind('demo.one', () => ({}))).toThrow(/already bound/)
    expect(registry.unbind('demo.one')).toBe(true)
    registry.bind('demo.one', () => ({}))
  })

  test('bindSchema replaces the placeholder and sets the risk class', () => {
    const registry = new CommandRegistry()
    registry.define(def('demo.typed'))
    expect(registry.get('demo.typed')?.schemaBound).toBe(false)
    registry.bindSchema('demo.typed', SYSTEM_PING_SCHEMA, { riskClass: () => 'consequential' })
    const bound = registry.get('demo.typed')!
    expect(bound.schemaBound).toBe(true)
    expect(bound.schema).toBe(SYSTEM_PING_SCHEMA as never)
    expect(bound.riskClass?.({}, { workspaceId: 'w', actor: { principalId: 'p', kind: 'user' } })).toBe('consequential')
  })
})

describe('command catalogue', () => {
  test('registers every name exactly once, all well-formed, verbs from ROX2_PERMISSIONS', () => {
    const registry = new CommandRegistry()
    registerCommandCatalogue(registry)
    const names = COMMAND_CATALOGUE.map(entry => entry.type)
    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThan(250)
    for (const entry of COMMAND_CATALOGUE) {
      expect(isCommandType(entry.type)).toBe(true)
      expect((ROX2_PERMISSIONS as readonly string[]).includes(entry.verb)).toBe(true)
      expect(['by-target', 'workspace', 'local']).toContain(entry.authority)
    }
  })

  test('only system.ping has a bound schema; every catalogue command starts not_bound', () => {
    const registry = new CommandRegistry({ isFlagEnabled: () => true })
    registerCommandCatalogue(registry)
    const bound = registry.list().filter(entry => entry.schemaBound).map(entry => entry.type)
    expect(bound).toEqual(['system.ping'])
    for (const capability of registry.capabilities()) {
      expect(capability).toMatchObject({ available: false, reason: 'not_bound' })
    }
  })

  test('contains the spec names siblings depend on', () => {
    const names = new Set(COMMAND_CATALOGUE.map(entry => entry.type))
    for (const name of [
      'tasks.update_status', 'im.send_message', 'im.create_chat', 'docs.move_note_to_shared', 'goals.create_check_in',
      'goals.record_check_in_summary', 'spaces.create', 'links.add', 'entities.pin', 'commands.batch',
      'calendar.create_time_block', 'people.invite', 'identity.activate_placeholder', 'agents.provision_personal_agent',
      'docs.ensure_daily_note', 'drive.open_upload', 'reminders.create', 'workspaces.create', 'tasks.create_from_message',
    ]) expect(names.has(name as never)).toBe(true)
    // Queries are not commands.
    for (const query of ['im.history', 'docs.home', 'agenda.today', 'people.get_overview', 'links.backlinks']) {
      expect(names.has(query as never)).toBe(false)
    }
  })

  test('the placeholder schema accepts plain objects only', () => {
    expect(PLACEHOLDER_PAYLOAD_SCHEMA.safeParse({ a: 1 }).success).toBe(true)
    for (const bad of [null, [], 'x', 3, new Date()]) expect(PLACEHOLDER_PAYLOAD_SCHEMA.safeParse(bad).success).toBe(false)
  })

  test('system.ping schema is strict', () => {
    expect(SYSTEM_PING_SCHEMA.safeParse({}).success).toBe(true)
    expect(SYSTEM_PING_SCHEMA.safeParse({ nonce: 'n' })).toEqual({ success: true, data: { nonce: 'n' } })
    expect(SYSTEM_PING_SCHEMA.safeParse({ nonce: 'x'.repeat(129) }).success).toBe(false)
    expect(SYSTEM_PING_SCHEMA.safeParse({ extra: true }).success).toBe(false)
  })
})

describe('envelope helpers', () => {
  test('createCommandEnvelope defaults idempotencyKey to commandId', () => {
    const envelope = createCommandEnvelope('system.ping', { nonce: 'a' }, { now: () => new Date('2026-10-08T00:00:00Z') })
    expect(envelope.idempotencyKey).toBe(envelope.commandId)
    expect(envelope.issuedAt).toBe('2026-10-08T00:00:00.000Z')
    expect(envelope).not.toHaveProperty('target')
  })

  test('canonical request is key-order independent and covers effect fields', () => {
    const a = canonicalCommandRequest({ type: 'x.y', payload: { b: 1, a: { d: 2, c: 3 } } })
    const b = canonicalCommandRequest({ type: 'x.y', payload: { a: { c: 3, d: 2 }, b: 1 } })
    expect(a).toBe(b)
    expect(canonicalCommandRequest({ type: 'x.y', payload: {}, expectedRevision: 1 })).not.toBe(canonicalCommandRequest({ type: 'x.y', payload: {} }))
  })

  test('payloadByteLength counts UTF-8 bytes and rejects unserialisable payloads', () => {
    expect(payloadByteLength({ a: 'я' })).toBe(new TextEncoder().encode('{"a":"я"}').length)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(payloadByteLength(cyclic)).toBe(Number.POSITIVE_INFINITY)
    expect(payloadByteLength(undefined)).toBe(Number.POSITIVE_INFINITY)
  })

  test('duplicateReceipt keeps the original effect', () => {
    const original = { commandId: 'c', status: 'applied' as const, revision: 2, eventIds: ['e'] }
    expect(duplicateReceipt(original)).toEqual({ commandId: 'c', status: 'duplicate', original, revision: 2, eventIds: ['e'] })
  })
})

describe('middleware chain', () => {
  test('runs in order around the terminal and can short-circuit', async () => {
    const order: string[] = []
    const chain = new CommandMiddlewareChain()
    chain.use({ name: 'a', run: async (_ctx, next) => { order.push('a>'); const r = await next(); order.push('<a'); return r } })
    chain.use({ name: 'b', run: async (_ctx, next) => { order.push('b'); return next() } })
    expect(() => chain.use({ name: 'a', run: async (_c, n) => n() })).toThrow(/Duplicate/)
    expect(() => chain.use({ name: 'execute', run: async (_c, n) => n() })).toThrow(/reserved/)
    expect(chain.names()).toEqual(['a', 'b'])
    const run = composeCommandMiddleware(chain.list(), async () => { order.push('terminal'); return { commandId: 'c', status: 'applied' } })
    const receipt = await run({} as CommandPipelineContext)
    expect(receipt.status).toBe('applied')
    expect(order).toEqual(['a>', 'b', 'terminal', '<a'])

    const deny = new CommandMiddlewareChain().use({ name: 'deny', run: async () => ({ commandId: 'c', status: 'rejected', error: { code: 'FORBIDDEN', message: 'no' } }) })
    let reached = false
    const denied = await composeCommandMiddleware(deny.list(), async () => { reached = true; return { commandId: 'c', status: 'applied' } })({} as CommandPipelineContext)
    expect(denied.status).toBe('rejected')
    expect(reached).toBe(false)
  })
})
