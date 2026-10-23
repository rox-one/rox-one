/**
 * Cookbooks sidecar — structural cell mutations integration test (SPEC wave 10).
 *
 * End-to-end proof that the `/cells/*` routes mutate the REAL vendored document
 * through the runtime: add → duplicate → move → delete each answer
 * `{ok, index}` and the re-read document reflects the change; while a run of
 * the same item is active every mutation is refused with a sidecar 409.
 *
 * Wave 13 adds the `convert` scenario: a ran code cell switched to markdown
 * loses its outputs/execution_count, a markdown cell switched to code keeps its
 * source and gains empty run state, and a same-type conversion is a no-op.
 *
 * The scenarios are GATED on the vendored sidecar actually exposing the route
 * (`/cells/add` for wave 10, `/cells/convert` for wave 13): until that snapshot
 * is re-vendored the scenario skips with a named reason rather than failing.
 * Same for a missing interpreter.
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

const pythonPath = await detectPython()
// Is the vendored snapshot carrying the wave-10 / wave-13 cell routes yet? A
// snapshot that predates one of them skips its scenario with a named reason
// instead of failing, until `PROVENANCE.md` §Sync command re-vendors the lab.
const hostSource = existsSync(HOST_PY) ? readFileSync(HOST_PY, 'utf8') : ''
const hasCellsRoutes = hostSource.includes('/cells/add')
const hasConvertRoute = hostSource.includes('/cells/convert')
const cellsIt = pythonPath && hasCellsRoutes ? it : it.skip
const convertIt = pythonPath && hasConvertRoute ? it : it.skip

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

const convertSkipReason = !pythonPath
  ? 'python-not-found'
  : !hasConvertRoute
    ? 'sidecar /cells/convert not vendored yet (waits on the wave-13 re-vendor)'
    : undefined

/**
 * Wave 13: type conversion against the REAL sidecar. A code cell that has run is
 * switched to markdown (its outputs/execution_count are gone from the re-read
 * document) and a markdown cell is switched to code (its source survives, its
 * run state is initialised); converting to the type a cell already has is a
 * no-op that still answers the same focus index.
 */
convertIt(
  convertSkipReason ?? 'converts a real cell between code and markdown end-to-end',
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'rox-cookbooks-convert-it-'))
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
      const opened = await runtime.apiOpen(itemId)

      // Find a code cell and give it real run state first: convert must be
      // dropping outputs that actually exist, not an empty list.
      const codeIndex = opened.document.cells.findIndex((cell) => cell.cellType === 'code')
      expect(codeIndex).toBeGreaterThanOrEqual(0)
      const ran = await runtime.apiRun(itemId, 'print("converted")', codeIndex)
      expect(ran.ok).toBe(true)
      const dirty = await runtime.apiDocument(itemId)
      expect(dirty.cells[codeIndex].outputs.length).toBeGreaterThan(0)
      expect(dirty.cells[codeIndex].executionCount).toBeGreaterThan(0)

      // code → markdown: the cell keeps its text, loses its run state.
      const toMarkdown = await runtime.apiMutate({
        itemId,
        op: 'convert',
        index: codeIndex,
        cellType: 'markdown',
      })
      expect(toMarkdown.index).toBe(codeIndex)
      const markdownCell = toMarkdown.document.cells[codeIndex]
      expect(markdownCell.cellType).toBe('markdown')
      expect(markdownCell.source).toContain('print("converted")')
      expect(markdownCell.outputs).toEqual([])
      expect(markdownCell.executionCount).toBeNull()

      // Converting to the type it already has is a successful no-op.
      const again = await runtime.apiMutate({
        itemId,
        op: 'convert',
        index: codeIndex,
        cellType: 'markdown',
      })
      expect(again.index).toBe(codeIndex)
      expect(again.document.cells[codeIndex].source).toBe(markdownCell.source)

      // markdown → code: the source survives, the run state is initialised.
      const toCode = await runtime.apiMutate({
        itemId,
        op: 'convert',
        index: codeIndex,
        cellType: 'code',
      })
      expect(toCode.index).toBe(codeIndex)
      const codeCell = toCode.document.cells[codeIndex]
      expect(codeCell.cellType).toBe('code')
      expect(codeCell.source).toContain('print("converted")')
      expect(codeCell.outputs).toEqual([])
      expect(codeCell.executionCount).toBeNull()
      // The conversion is persisted, not just echoed: a fresh read agrees.
      const reread = await runtime.apiDocument(itemId)
      expect(reread.cells[codeIndex].cellType).toBe('code')
      expect(reread.cells[codeIndex].source).toBe(codeCell.source)
      expect(reread.cells[codeIndex].outputs).toEqual([])
      expect(reread.cells[codeIndex].executionCount).toBeNull()
    } finally {
      await runtime.stop()
    }
  },
  60_000,
)
