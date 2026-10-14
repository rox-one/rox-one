/**
 * Cookbooks sidecar — integration test (SPEC §Testing п.2, §Amendment 1).
 *
 * Spawns the REAL vendored sidecar through the runtime (interpreter resolved by
 * the production chain: managed toolchain → UV_PYTHON → PATH) and proves the
 * data plane end-to-end: the discovery line parses, the runtime reaches
 * `running`, `apiCatalog()` returns the 13 catalog cards mapped to the DTO,
 * `apiDocument()` returns the stored notebook, the sidecar still 401s an
 * unauthenticated caller, and SIGINT stops the host with exit code 0.
 *
 * No view is mounted any more — the surface is native React over IPC.
 *
 * Skips with a named reason only when no Python interpreter exists at all.
 */
import { afterAll, expect, it } from 'bun:test'
import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getToolchain } from '@rox/shared/toolchain-runtime'
import { CookbooksRuntime, type CookbooksChild, type CookbooksSpawnFn } from '../cookbooks-runtime'

const COOKBOOKS_DIR = join(import.meta.dir, '..', '..', '..', 'resources', 'cookbooks')

async function detectPython(): Promise<string | null> {
  try {
    const managed = await getToolchain().resolver.findExecutable('python3')
    if (managed && existsSync(managed)) return managed
  } catch {
    /* resolver unavailable — fall through to the explicit sources */
  }
  const uvPython = process.env.UV_PYTHON?.trim()
  if (uvPython && existsSync(uvPython)) return uvPython
  for (const segment of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    const candidate = join(segment, 'python3')
    if (existsSync(candidate)) return candidate
  }
  return null
}

const pythonPath = await detectPython()
const sidecarIt = pythonPath ? it : it.skip

const tempDirs: string[] = []
afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

sidecarIt(
  pythonPath ? 'spawns the vendored sidecar and answers the data plane' : 'python-not-found',
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'rox-cookbooks-it-'))
    tempDirs.push(workspace)

    if (!existsSync(COOKBOOKS_DIR)) throw new Error(`vendored snapshot missing: ${COOKBOOKS_DIR}`)

    let exitCode: number | null | undefined
    const spawn: CookbooksSpawnFn = (command, args, options) => {
      const child = nodeSpawn(command, args, options)
      child.on('exit', (code) => { exitCode = code })
      return child as unknown as CookbooksChild
    }

    const runtime = new CookbooksRuntime({
      spawn,
      resolvePython: async () => pythonPath,
      getCookbooksDir: () => COOKBOOKS_DIR,
      getWorkspaceDir: () => workspace,
    })

    const status = await runtime.ensure()
    expect(status.state).toBe('running')
    expect(status.port).toBeGreaterThan(0)
    expect(JSON.stringify(status)).not.toContain('token')

    const startup = runtime.getStartup()
    expect(startup).not.toBeNull()

    // The JSON surface stays token-gated: main is the only authenticated caller.
    const unauthorized = await fetch(`http://127.0.0.1:${startup!.port}/catalog`)
    expect(unauthorized.status).toBe(401)

    const cards = await runtime.apiCatalog()
    expect(cards).toHaveLength(13)
    for (const card of cards) {
      expect(typeof card.id).toBe('string')
      expect(card.id.length).toBeGreaterThan(0)
      expect(typeof card.title).toBe('string')
      expect(typeof card.vendor).toBe('string')
      expect(['ipynb', 'md']).toContain(card.kind)
      expect(Array.isArray(card.secretsHave)).toBe(true)
      expect(Array.isArray(card.secretsMissing)).toBe(true)
      expect(typeof card.disabled).toBe('boolean')
    }

    const notebook = cards.find((card) => card.kind === 'ipynb' && !card.disabled)
    expect(notebook).toBeDefined()
    const document = await runtime.apiDocument(notebook!.id)
    expect(document.itemId).toBe(notebook!.id)
    expect(document.kind).toBe('ipynb')
    expect(document.supported).toBe(true)
    expect(document.cells.length).toBeGreaterThan(0)
    expect(document.cells.some((cell) => cell.cellType === 'code')).toBe(true)
    expect(document.text).toBeNull()

    await runtime.stop()
    expect(exitCode).toBe(0)
    expect(runtime.getStatus().state).toBe('stopped')
  },
  30_000,
)
