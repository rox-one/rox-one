import { describe, it, expect } from 'bun:test'
import {
  isKeeperRevealAllowed,
  KEEPER_ALLOW_REVEAL_ENV,
  parseKeeperArgs,
  runKeeperCommand,
  type KeeperIo,
  type KeeperRpc,
} from '../keeper.ts'
import { parseArgs } from '../index.ts'

// ---------------------------------------------------------------------------
// Fake RPC transport — never touches a vault, records every call.
// ---------------------------------------------------------------------------

interface RpcCall {
  channel: string
  args: unknown[]
}

interface FakeRpc extends KeeperRpc {
  calls: RpcCall[]
  responses: Record<string, unknown>
  channels(): string[]
}

function createFakeRpc(): FakeRpc {
  const rpc: FakeRpc = {
    calls: [],
    responses: {},
    async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      rpc.calls.push({ channel, args })
      return rpc.responses[channel]
    },
    channels(): string[] {
      return rpc.calls.map((call) => call.channel)
    },
  }
  return rpc
}

interface Captured {
  io: KeeperIo
  out: string[]
  json: unknown[]
  err: string[]
}

function capture(): Captured {
  const out: string[] = []
  const json: unknown[] = []
  const err: string[] = []
  return {
    out,
    json,
    err,
    io: {
      out: (line) => out.push(line),
      outJson: (value) => json.push(value),
      err: (line) => err.push(line),
    },
  }
}

function view(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'item-1',
    kind: 'login',
    title: 'Example',
    username: 'alice',
    url: 'https://example.com',
    tags: [],
    folders: ['Work'],
    createdAt: 1,
    updatedAt: 2,
    hasPassword: true,
    hasTotpSecret: false,
    // Deliberately non-null: guards must not trust the projection.
    password: 'hunter2',
    totpSecret: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

describe('parseKeeperArgs', () => {
  it('parses list with --folder', () => {
    const args = parseKeeperArgs(['list', '--folder', 'Work'])
    expect(args.sub).toBe('list')
    expect(args.folder).toBe('Work')
  })

  it('parses get with --reveal and --field totp', () => {
    const args = parseKeeperArgs(['get', 'item-1', '--reveal', '--field', 'totp'])
    expect(args.sub).toBe('get')
    expect(args.id).toBe('item-1')
    expect(args.reveal).toBe(true)
    expect(args.field).toBe('totpSecret')
  })

  it('parses create flags including stdin markers', () => {
    const args = parseKeeperArgs([
      'create',
      '--title', 'Bank',
      '--username', 'alice',
      '--url', 'https://bank.example',
      '--notes', '2FA on',
      '--folder', 'Money',
      '--totp',
      'JBSWY3DPEHPK3PXP',
      '--password-stdin',
    ])
    expect(args.sub).toBe('create')
    expect(args.title).toBe('Bank')
    expect(args.username).toBe('alice')
    expect(args.url).toBe('https://bank.example')
    expect(args.notes).toBe('2FA on')
    expect(args.folder).toBe('Money')
    expect(args.totp).toBe('JBSWY3DPEHPK3PXP')
    expect(args.passwordFromStdin).toBe(true)
  })

  it('rejects an unknown flag', () => {
    expect(() => parseKeeperArgs(['list', '--wat'])).toThrow('Unknown keeper flag: --wat')
  })

  it('requires a known subcommand', () => {
    expect(() => parseKeeperArgs([])).toThrow()
    expect(() => parseKeeperArgs(['frobnicate'])).toThrow('Unknown keeper subcommand: frobnicate')
  })
})

describe('parseArgs keeper --url routing', () => {
  it('keeps the server --url and routes a later --url to the keeper tail', () => {
    const args = parseArgs([
      'bun', 'index.ts',
      '--url', 'ws://localhost:3000',
      'keeper', 'create',
      '--title', 'Bank',
      '--url', 'https://bank.example',
    ])
    expect(args.command).toBe('keeper')
    expect(args.url).toBe('ws://localhost:3000')
    const parsed = parseKeeperArgs(args.rest)
    expect(parsed.url).toBe('https://bank.example')
  })
})

// ---------------------------------------------------------------------------
// Reveal gating
// ---------------------------------------------------------------------------

describe('isKeeperRevealAllowed', () => {
  it('is fail-closed unless the env flag is exactly "1"', () => {
    expect(isKeeperRevealAllowed({})).toBe(false)
    expect(isKeeperRevealAllowed({ [KEEPER_ALLOW_REVEAL_ENV]: 'true' })).toBe(false)
    expect(isKeeperRevealAllowed({ [KEEPER_ALLOW_REVEAL_ENV]: '1' })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

describe('keeper list', () => {
  it('prints masked views and never leaks a secret from the projection', async () => {
    const rpc = createFakeRpc()
    rpc.responses['keeper:list'] = {
      items: [view(), view({ id: 'item-2', title: 'Other', folders: ['Home'] })],
      folders: [{ id: 'folder-work', name: 'Work' }],
    }
    const cap = capture()

    const code = await runKeeperCommand(rpc, { rest: ['list'], json: true }, { io: cap.io })

    expect(code).toBe(0)
    const payload = cap.json[0] as { items: Array<Record<string, unknown>> }
    expect(payload.items).toHaveLength(2)
    expect(JSON.stringify(payload)).not.toContain('hunter2')
    expect(payload.items[0].password).toBeNull()
  })

  it('filters by folder name (case-insensitive)', async () => {
    const rpc = createFakeRpc()
    rpc.responses['keeper:list'] = {
      items: [view(), view({ id: 'item-2', title: 'Other', folders: ['Home'] })],
      folders: [],
    }
    const cap = capture()

    await runKeeperCommand(rpc, { rest: ['list', '--folder', 'work'], json: true }, { io: cap.io })

    const payload = cap.json[0] as { items: Array<Record<string, unknown>> }
    expect(payload.items.map((item) => item.id)).toEqual(['item-1'])
  })
})

describe('keeper get (masked)', () => {
  it('never prints the password and points at the reveal gate', async () => {
    const rpc = createFakeRpc()
    rpc.responses['keeper:get'] = view()
    const cap = capture()

    const code = await runKeeperCommand(rpc, { rest: ['get', 'item-1'], json: false }, { io: cap.io })

    expect(code).toBe(0)
    const text = cap.out.join('\n')
    expect(text).not.toContain('hunter2')
    expect(text).toContain('password: (hidden')
    expect(rpc.channels()).toEqual(['keeper:get'])
  })

  it('masks a secret smuggled into a JSON projection', async () => {
    const rpc = createFakeRpc()
    rpc.responses['keeper:get'] = view()
    const cap = capture()

    await runKeeperCommand(rpc, { rest: ['get', 'item-1'], json: true }, { io: cap.io })

    expect(JSON.stringify(cap.json[0])).not.toContain('hunter2')
    expect((cap.json[0] as Record<string, unknown>).password).toBeNull()
  })
})

describe('keeper get --reveal gating', () => {
  it('refuses (fail-closed) when the env flag is missing and never calls reveal', async () => {
    const rpc = createFakeRpc()
    rpc.responses['keeper:get'] = view()
    const cap = capture()

    const code = await runKeeperCommand(
      rpc,
      { rest: ['get', 'item-1', '--reveal'], json: false },
      { io: cap.io, env: {} },
    )

    expect(code).toBe(1)
    expect(rpc.channels()).toEqual(['keeper:get'])
    expect(cap.err.join('\n')).toContain(KEEPER_ALLOW_REVEAL_ENV)
    expect(cap.out.join('\n')).not.toContain('hunter2')
  })

  it('reveals to stdout only when the env flag is set', async () => {
    const rpc = createFakeRpc()
    rpc.responses['keeper:get'] = view()
    rpc.responses['keeper:reveal'] = { id: 'item-1', field: 'password', value: 'hunter2' }
    const cap = capture()

    const code = await runKeeperCommand(
      rpc,
      { rest: ['get', 'item-1', '--reveal'], json: false },
      { io: cap.io, env: { [KEEPER_ALLOW_REVEAL_ENV]: '1' } },
    )

    expect(code).toBe(0)
    expect(rpc.channels()).toEqual(['keeper:get', 'keeper:reveal'])
    expect(rpc.calls[1].args[0]).toEqual({ id: 'item-1', field: 'password' })
    expect(cap.out.join('\n')).toContain('password: hunter2')
  })

  it('does not reveal a field the item does not carry', async () => {
    const rpc = createFakeRpc()
    rpc.responses['keeper:get'] = view({ hasPassword: false, password: null })
    const cap = capture()

    const code = await runKeeperCommand(
      rpc,
      { rest: ['get', 'item-1', '--reveal'], json: false },
      { io: cap.io, env: { [KEEPER_ALLOW_REVEAL_ENV]: '1' } },
    )

    expect(code).toBe(1)
    expect(rpc.channels()).toEqual(['keeper:get'])
    expect(cap.err.join('\n')).toContain('No password stored')
  })
})

describe('keeper create', () => {
  it('sends the secret and never echoes it back', async () => {
    const rpc = createFakeRpc()
    rpc.responses['keeper:create'] = view({ hasPassword: true, password: null })
    const cap = capture()

    const code = await runKeeperCommand(
      rpc,
      {
        rest: ['create', '--title', 'Bank', '--username', 'alice', '--password', 'hunter2', '--folder', 'Money'],
        json: false,
      },
      { io: cap.io },
    )

    expect(code).toBe(0)
    const request = rpc.calls[0].args[0] as { item: Record<string, unknown> }
    expect(request.item).toMatchObject({ kind: 'login', title: 'Bank', username: 'alice', password: 'hunter2', folders: ['Money'] })
    expect(cap.out.join('\n')).not.toContain('hunter2')
  })

  it('reads an omitted password from a piped stdin', async () => {
    const rpc = createFakeRpc()
    rpc.responses['keeper:create'] = view()
    const cap = capture()

    await runKeeperCommand(
      rpc,
      { rest: ['create', '--title', 'Bank'], json: false },
      { io: cap.io, stdin: async () => 'from-stdin\n' },
    )

    const request = rpc.calls[0].args[0] as { item: Record<string, unknown> }
    expect(request.item.password).toBe('from-stdin')
  })
})

describe('keeper delete', () => {
  it('deletes by id', async () => {
    const rpc = createFakeRpc()
    const cap = capture()

    const code = await runKeeperCommand(rpc, { rest: ['delete', 'item-9'], json: false }, { io: cap.io })

    expect(code).toBe(0)
    expect(rpc.calls[0]).toEqual({ channel: 'keeper:delete', args: ['item-9'] })
  })
})

describe('keeper status', () => {
  it('prints the unlock status', async () => {
    const rpc = createFakeRpc()
    rpc.responses['keeper:unlockStatus'] = {
      scope: 'personal',
      keyAvailable: true,
      vaultExists: true,
      available: true,
    }
    const cap = capture()

    const code = await runKeeperCommand(rpc, { rest: ['status'], json: false }, { io: cap.io })

    expect(code).toBe(0)
    expect(cap.out.join('\n')).toContain('available: true')
  })
})