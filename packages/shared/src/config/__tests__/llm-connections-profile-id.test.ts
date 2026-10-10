import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  filterLlmConnectionsForProfile,
  type LlmConnection,
} from '../llm-connections'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

function connection(overrides: Partial<LlmConnection> = {}): LlmConnection {
  return {
    slug: 'shared-connection',
    name: 'Shared',
    providerType: 'anthropic',
    authType: 'api_key',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

// ============================================================
// Pure filter: optional per-person keying
// ============================================================

describe('filterLlmConnectionsForProfile', () => {
  it('is a strict no-op when no profile is supplied', () => {
    const input = [
      connection(),
      connection({ slug: 'alice-only', profileId: 'alice' }),
      connection({ slug: 'bob-only', profileId: 'bob' }),
    ]

    const out = filterLlmConnectionsForProfile(input)

    expect(out).toEqual(input)
    // A fresh array, so callers can never mutate the stored config through it.
    expect(out).not.toBe(input)
  })

  it('treats a blank profile as absent', () => {
    const input = [connection({ slug: 'keyed', profileId: 'alice' })]
    expect(filterLlmConnectionsForProfile(input, '')).toEqual(input)
    expect(filterLlmConnectionsForProfile(input, '   ')).toEqual(input)
    expect(filterLlmConnectionsForProfile(input, undefined)).toEqual(input)
  })

  it('keeps shared rows and the requested profile, drops the rest', () => {
    const shared = connection({ slug: 'shared' })
    const alice = connection({ slug: 'alice-only', profileId: 'alice' })
    const bob = connection({ slug: 'bob-only', profileId: 'bob' })

    expect(filterLlmConnectionsForProfile([shared, alice, bob], 'alice').map(c => c.slug))
      .toEqual(['shared', 'alice-only'])
    expect(filterLlmConnectionsForProfile([shared, alice, bob], 'bob').map(c => c.slug))
      .toEqual(['shared', 'bob-only'])
  })

  it('returns only shared rows for a profile with no own connections', () => {
    const shared = connection({ slug: 'shared' })
    const alice = connection({ slug: 'alice-only', profileId: 'alice' })
    expect(filterLlmConnectionsForProfile([shared, alice], 'carol').map(c => c.slug))
      .toEqual(['shared'])
  })
})

// ============================================================
// Load-time filter through getLlmConnections (isolated config dir)
// ============================================================

const CONNECTION_A = connection({
  slug: 'shared-a',
  name: 'Shared A',
  providerType: 'pi',
  authType: 'api_key',
})

const CONNECTION_B = connection({
  slug: 'shared-b',
  name: 'Shared B',
  createdAt: 1_700_000_000_001,
})

const CONNECTION_C = connection({
  slug: 'alice-c',
  name: 'Alice C',
  createdAt: 1_700_000_000_002,
  profileId: 'alice',
})

function setup(llmConnections: LlmConnection[]) {
  const configDir = mkdtempSync(join(tmpdir(), 'rox-profile-scope-'))
  const workspaceRoot = join(configDir, 'workspaces', 'my-workspace')
  mkdirSync(workspaceRoot, { recursive: true })

  writeFileSync(
    join(workspaceRoot, 'config.json'),
    JSON.stringify(
      {
        id: 'ws-config-1',
        name: 'My Workspace',
        slug: 'my-workspace',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
      null,
      2,
    ),
    'utf-8',
  )

  const configPath = join(configDir, 'config.json')
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        workspaces: [
          {
            id: 'ws-1',
            name: 'My Workspace',
            rootPath: workspaceRoot,
            createdAt: 1_700_000_000_000,
          },
        ],
        activeWorkspaceId: 'ws-1',
        activeSessionId: null,
        llmConnections,
      },
      null,
      2,
    ),
    'utf-8',
  )

  /** Run getLlmConnections(profileId?) in a clean subprocess; return the JSON it prints. */
  function readConnections(profileId?: string): Array<Record<string, unknown>> {
    const argExpr = profileId === undefined ? '' : JSON.stringify(profileId)
    const run = Bun.spawnSync(
      [
        process.execPath,
        '--eval',
        `import { getLlmConnections } from '${STORAGE_MODULE_PATH}';` +
          `process.stdout.write(JSON.stringify(getLlmConnections(${argExpr})));`,
      ],
      {
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir, ROX_CONFIG_DIR: configDir },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    if (run.exitCode !== 0) {
      throw new Error(`getLlmConnections subprocess failed:\n${run.stderr.toString()}`)
    }
    return JSON.parse(run.stdout.toString()) as Array<Record<string, unknown>>
  }

  return { configDir, configPath, readConnections }
}

describe('getLlmConnections profile scoping', () => {
  it('returns the stored array unchanged when no profile is supplied', () => {
    const fixture = [CONNECTION_A, CONNECTION_B, CONNECTION_C]
    const { configPath, readConnections } = setup(fixture)

    const out = readConnections()

    // bun-types' deep-equality overloads take Record<string, unknown>[]; a named
    // interface has no index signature, so the comparison goes through a plain
    // structural view (the assertion itself is unchanged).
    expect(out as unknown as Array<Record<string, unknown>>).toEqual(fixture as unknown as Array<Record<string, unknown>>)
    // The field must not be injected into anything it was absent from.
    expect(Object.keys(out[0]!)).not.toContain('profileId')
    expect(Object.keys(out[1]!)).not.toContain('profileId')
    // The stored llmConnections block is untouched by the scoped read; a second
    // read leaves the file byte-identical (no churn from the new field).
    const afterFirstRead = readFileSync(configPath, 'utf-8')
    const persisted: unknown = JSON.parse(afterFirstRead)
    expect(
      persisted !== null && typeof persisted === 'object' && 'llmConnections' in persisted
        ? persisted.llmConnections
        : undefined,
    ).toEqual(fixture)
    readConnections()
    expect(readFileSync(configPath, 'utf-8')).toBe(afterFirstRead)
  })

  it('filters out other profiles when one is supplied', () => {
    const { readConnections } = setup([CONNECTION_A, CONNECTION_B, CONNECTION_C])

    expect(readConnections('alice').map(c => c.slug)).toEqual(['shared-a', 'shared-b', 'alice-c'])
    // A different profile sees only the unkeyed rows.
    expect(readConnections('bob').map(c => c.slug)).toEqual(['shared-a', 'shared-b'])
  })

  it('saves an unkeyed connection without emitting a profileId field', () => {
    const { configPath } = setup([CONNECTION_A])
    const raw = readFileSync(configPath, 'utf-8')
    // toEqual above pins the parsed shape; this pins the stored bytes.
    expect(raw).toContain('"slug": "shared-a"')
    expect(raw).not.toContain('profileId')
  })
})