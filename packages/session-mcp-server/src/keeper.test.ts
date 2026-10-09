import { describe, it, expect } from 'bun:test'
import {
  handleKeeperTool,
  isKeeperRevealAllowed,
  KEEPER_ALLOW_REVEAL_ENV,
  KEEPER_TOOL,
  sanitizeKeeperOutput,
  type KeeperAction,
  type KeeperRpc,
} from './keeper.ts'

// ---------------------------------------------------------------------------
// Fake transport — records calls, never touches a vault.
// ---------------------------------------------------------------------------

interface Call {
  action: KeeperAction
  params: Record<string, unknown>
}

interface FakeRpc extends KeeperRpc {
  calls: Call[]
  responses: Record<string, unknown>
}

function createFakeRpc(): FakeRpc {
  const rpc: FakeRpc = {
    calls: [],
    responses: {},
    async call(action, params) {
      rpc.calls.push({ action, params })
      return rpc.responses[action]
    },
  }
  return rpc
}

function parseResult(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0].text)
}

function view(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'item-1',
    kind: 'login',
    title: 'Example',
    username: 'alice',
    tags: [],
    folders: ['Work'],
    createdAt: 1,
    updatedAt: 2,
    hasPassword: true,
    hasTotpSecret: false,
    // Non-null on purpose: the tool must not trust the projection.
    password: 'hunter2',
    totpSecret: null,
    ...overrides,
  }
}

const ALLOW_ENV = { [KEEPER_ALLOW_REVEAL_ENV]: '1' }

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe('KEEPER_TOOL schema', () => {
  it('is named keeper and requires an action from the known set', () => {
    expect(KEEPER_TOOL.name).toBe('keeper')
    const schema = KEEPER_TOOL.inputSchema as {
      required?: string[]
      properties?: Record<string, { enum?: string[] }>
      additionalProperties?: boolean
    }
    expect(schema.required).toEqual(['action'])
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties?.action?.enum).toEqual(['list', 'get', 'create', 'update', 'delete'])
    expect(schema.properties?.field?.enum).toEqual(['password', 'totpSecret'])
  })
})

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

describe('sanitizeKeeperOutput', () => {
  it('nulls secrets even when reveal is not authorized', () => {
    const clean = sanitizeKeeperOutput({ items: [view()] }, false) as {
      items: Array<Record<string, unknown>>
    }
    expect(clean.items[0].password).toBeNull()
    expect(JSON.stringify(clean)).not.toContain('hunter2')
  })

  it('keeps a revealed block only when reveal is authorized', () => {
    const payload = { ...view(), revealed: { field: 'password', value: 'hunter2' } }
    const denied = sanitizeKeeperOutput(payload, false) as Record<string, unknown>
    expect(denied.revealed).toBeUndefined()
    expect(denied.password).toBeNull()

    const allowed = sanitizeKeeperOutput(payload, true) as Record<string, unknown>
    expect(allowed.revealed).toEqual({ field: 'password', value: 'hunter2' })
    expect(allowed.password).toBeNull()
  })
})

describe('isKeeperRevealAllowed', () => {
  it('is fail-closed unless the flag is exactly "1"', () => {
    expect(isKeeperRevealAllowed({})).toBe(false)
    expect(isKeeperRevealAllowed({ [KEEPER_ALLOW_REVEAL_ENV]: 'yes' })).toBe(false)
    expect(isKeeperRevealAllowed(ALLOW_ENV)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

describe('handleKeeperTool', () => {
  it('rejects an unknown action', async () => {
    const rpc = createFakeRpc()
    const result = await handleKeeperTool({ action: 'purge' }, { rpc })
    expect(result.isError).toBe(true)
    expect(rpc.calls).toHaveLength(0)
  })

  it('lists masked items', async () => {
    const rpc = createFakeRpc()
    rpc.responses.list = { items: [view()], folders: [{ id: 'folder-work', name: 'Work' }] }
    const result = await handleKeeperTool({ action: 'list' }, { rpc })
    expect(result.isError).toBe(false)
    expect(rpc.calls[0]).toEqual({ action: 'list', params: {} })
    expect(result.content[0].text).not.toContain('hunter2')
  })

  it('passes a folder filter through to the transport', async () => {
    const rpc = createFakeRpc()
    rpc.responses.list = { items: [] }
    await handleKeeperTool({ action: 'list', folder: 'Work' }, { rpc })
    expect(rpc.calls[0].params).toEqual({ folder: 'Work' })
  })

  it('gets an item masked when reveal is not requested', async () => {
    const rpc = createFakeRpc()
    rpc.responses.get = view()
    const result = await handleKeeperTool({ action: 'get', id: 'item-1' }, { rpc })
    expect(rpc.calls[0].params).toEqual({ id: 'item-1' })
    expect(result.content[0].text).not.toContain('hunter2')
    expect((parseResult(result) as Record<string, unknown>).password).toBeNull()
  })

  it('refuses reveal when the operator flag is missing and never calls the transport', async () => {
    const rpc = createFakeRpc()
    rpc.responses.get = view()
    const result = await handleKeeperTool(
      { action: 'get', id: 'item-1', reveal: true },
      { rpc, env: {} },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(KEEPER_ALLOW_REVEAL_ENV)
    expect(rpc.calls).toHaveLength(0)
  })

  it('reveals only with both reveal:true and the operator flag', async () => {
    const rpc = createFakeRpc()
    rpc.responses.get = { ...view(), revealed: { field: 'password', value: 'hunter2' } }
    const result = await handleKeeperTool(
      { action: 'get', id: 'item-1', reveal: true, field: 'password' },
      { rpc, env: ALLOW_ENV },
    )
    expect(result.isError).toBe(false)
    expect(rpc.calls[0].params).toEqual({ id: 'item-1', field: 'password', reveal: true })
    const payload = parseResult(result) as Record<string, unknown>
    expect(payload.revealed).toEqual({ field: 'password', value: 'hunter2' })
    expect(payload.password).toBeNull()
  })

  it('creates an item and never echoes the secret', async () => {
    const rpc = createFakeRpc()
    rpc.responses.create = view({ password: null })
    const result = await handleKeeperTool(
      { action: 'create', item: { kind: 'login', title: 'Bank', password: 'hunter2' } },
      { rpc },
    )
    expect(result.isError).toBe(false)
    expect(rpc.calls[0]).toEqual({
      action: 'create',
      params: { item: { kind: 'login', title: 'Bank', password: 'hunter2' } },
    })
    expect(result.content[0].text).not.toContain('hunter2')
  })

  it('updates an item', async () => {
    const rpc = createFakeRpc()
    rpc.responses.update = view()
    const result = await handleKeeperTool(
      { action: 'update', id: 'item-1', patch: { title: 'Renamed' } },
      { rpc },
    )
    expect(result.isError).toBe(false)
    expect(rpc.calls[0]).toEqual({ action: 'update', params: { id: 'item-1', patch: { title: 'Renamed' } } })
  })

  it('deletes an item', async () => {
    const rpc = createFakeRpc()
    rpc.responses.delete = { id: 'item-1' }
    const result = await handleKeeperTool({ action: 'delete', id: 'item-1' }, { rpc })
    expect(result.isError).toBe(false)
    expect(rpc.calls[0]).toEqual({ action: 'delete', params: { id: 'item-1' } })
  })

  it('requires an id for get/update/delete', async () => {
    const rpc = createFakeRpc()
    for (const action of ['get', 'update', 'delete'] as const) {
      const result = await handleKeeperTool({ action }, { rpc })
      expect(result.isError).toBe(true)
    }
    expect(rpc.calls).toHaveLength(0)
  })

  it('surfaces a transport error without leaking details', async () => {
    const rpc = createFakeRpc()
    rpc.responses.get = { error: 'keeper-vault-locked' }
    const result = await handleKeeperTool({ action: 'get', id: 'item-1' }, { rpc })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('keeper-vault-locked')
  })

  it('reports a clear error when no transport is wired', async () => {
    const result = await handleKeeperTool({ action: 'list' }, {})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('no vault transport')
  })

  it('uses the injected _precomputedResult on Codex and still masks it', async () => {
    const rpc = createFakeRpc()
    const result = await handleKeeperTool(
      { action: 'get', id: 'item-1', _precomputedResult: JSON.stringify(view()) },
      { rpc },
    )
    expect(result.isError).toBe(false)
    expect(rpc.calls).toHaveLength(0)
    expect(result.content[0].text).not.toContain('hunter2')
  })
})