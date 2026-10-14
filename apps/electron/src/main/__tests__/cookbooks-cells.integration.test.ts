/**
 * Cookbooks sidecar — structural cell mutations integration test (SPEC wave 10).
 *
 * End-to-end proof that the four `/cells/*` routes mutate the REAL vendored
 * document through the runtime: add → duplicate → move → delete each answer
 * `{ok, index}` and the re-read document reflects the change; while a run of
 * the same item is active every mutation is refused with a sidecar 409.
 *
 * The scenario is GATED on the vendored sidecar actually exposing `/cells/add`
 * (added by the `P1` lab slice): until that snapshot is re-vendored this test
 * skips with a named reason rather than failing. Same for a missing interpreter.
 */
import { afterAll, expect, it } from 'bun:test'
import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getToolchain } from '@rox/shared/toolchain-runtime'
import { CookbooksApiError } from '../../shared/cookbooks'
import { CookbooksRuntime, type CookbooksChild, type CookbooksSpawnFn } from '../cookbooks-runtime'

const COOKBOOKS_DIR = join(import.meta.dir, '..', '..', '..', 'resources', 'cookbooks')
const HOST_PY = join(COOKBOOKS_DIR, 'src', 'rox_cookbooks', 'host.py')

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

/** Does the vendored host expose the wave-10 `/cells/add` route yet? */
function sidecarSupportsCells(): boolean {
  try {
    return /["']\/cells\/add["']/.test(readFileSync(HOST_PY, 'utf8'))
  } catch {
    return false
  }
}

const pythonPath = await detectPython()
const hasCellsRoutes = sidecarSupportsCells()
const cellsIt = pythonPath && hasCellsRoutes ? it : it.skip

const tempDirs: string[] = []
afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/**
 * Real wall-clock delay. This scenario drives an actual Python subprocess: the
 * kernel needs genuine time to start, so deterministic fake timers cannot stand
 * in for the platform process scheduler here.
 */
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

const skipReason = !pythonPath
  ? 'python-not-found'
  : !hasCellsRoutes
    ? 'sidecar /cells routes not vendored yet (waits on slice P1)'
    : undefined

cellsIt(
  skipReason ?? 'mutates a real document end-to-end (add → duplicate → move → delete)',
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'rox-cookbooks-cells-it-'))
    tempDirs.push(workspace)
    if (!existsSync(COOKBOOKS_DIR)) throw new Error(`vendored snapshot missing: ${COOKBOOKS_DIR}`)

    const spawn: CookbooksSpawnFn = (command, args, options) =>
      nodeSpawn(command, args, options) as unknown as CookbooksChild

    const runtime = new CookbooksRuntime({
      spawn,
      resolvePython: async () => pythonPath,
      getCookbooksDir: () => COOKBOOKS_DIR,
      getWorkspaceDir: () => workspace,
      resolveStore: async () => ({}),
    })

    try {
      expect((await runtime.ensure()).state).toBe('running')

      const cards = await runtime.apiCatalog()
      const notebook = cards.find((card) => card.kind === 'ipynb' && !card.disabled)
      expect(notebook).toBeDefined()
      const itemId = notebook!.id
      // Resume/create the personal copy before mutating it.
      const opened = await runtime.apiOpen(itemId)
      const before = opened.document.cells.length
      expect(before).toBeGreaterThan(0)

      // add — inserted at the front, focus index 0, one more cell.
      const added = await runtime.apiMutate({ itemId, op: 'add', cellType: 'code', index: 0, source: 'print("a")' })
      expect(added.index).toBe(0)
      expect(added.document.cells).toHaveLength(before + 1)
      expect(added.document.cells[0].source).toContain('print("a")')

      // duplicate — the copy lands right after its source, focus index 1.
      const duplicated = await runtime.apiMutate({ itemId, op: 'duplicate', index: 0 })
      expect(duplicated.index).toBe(1)
      expect(duplicated.document.cells).toHaveLength(before + 2)

      // move — 1 → 0, focus index 0.
      const moved = await runtime.apiMutate({ itemId, op: 'move', from: 1, to: 0 })
      expect(moved.index).toBe(0)
      expect(moved.document.cells).toHaveLength(before + 2)

      // delete — back to `before + 1`, focus stays on index 0.
      const deleted = await runtime.apiMutate({ itemId, op: 'delete', index: 0 })
      expect(deleted.index).toBe(0)
      expect(deleted.document.cells).toHaveLength(before + 1)

      // Run-guard: while a run of this item is active every mutation is a 409.
      const codeIndex = deleted.document.cells.findIndex((cell) => cell.cellType === 'code')
      expect(codeIndex).toBeGreaterThanOrEqual(0)
      const inFlight = runtime.apiRun(itemId, 'import time; print("started", flush=True); time.sleep(30)', codeIndex)
      // Let the kernel actually start before mutating.
      await delay(1_500)

      const conflict = await runtime
        .apiMutate({ itemId, op: 'add', cellType: 'code', index: 0 })
        .catch((err: unknown) => err)
      expect(conflict).toBeInstanceOf(CookbooksApiError)
      expect((conflict as CookbooksApiError).status).toBe(409)
      expect((conflict as CookbooksApiError).message).toBe('notebook is running')

      // Interrupt the run; the in-flight call resolves as cancelled.
      const cancelled = await runtime.apiCancel(itemId)
      expect(cancelled.ok).toBe(true)
      const run = await inFlight
      expect(run.cancelled).toBe(true)

      // /run releases its handle in finally after the response flush; polling
      // closes that ordering window (step ~75 ms, up to ~2 s).
      let probe = await runtime.apiCancel(itemId)
      for (let attempt = 0; attempt < 27 && probe.cancelled !== 0; attempt++) {
        await delay(75)
        probe = await runtime.apiCancel(itemId)
      }
      expect(probe.cancelled).toBe(0)

      // With no active run, the mutation goes through again.
      const after = await runtime.apiMutate({ itemId, op: 'add', cellType: 'markdown', index: 0, source: '# Title' })
      expect(after.index).toBe(0)
      expect(after.document.cells).toHaveLength(before + 2)
    } finally {
      await runtime.stop()
    }
  },
  60_000,
)
