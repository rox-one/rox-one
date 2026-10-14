/**
 * Cookbooks sidecar — cancel integration test (SPEC wave 9 §1).
 *
 * End-to-end proof that `/cancel` interrupts an in-flight run, using the REAL
 * vendored sidecar through the runtime: a cell that sleeps far longer than the
 * test budget is started, a second call cancels it, and the in-flight `/run`
 * resolves quickly with `cancelled: true` — with no surviving kernel process
 * left behind (the sidecar kills the run's process tree).
 *
 * The scenario is GATED on the vendored sidecar actually exposing `/cancel`
 * (added by the `P` slice): until that snapshot is re-vendored this test skips
 * with a named reason rather than failing. Same for a missing interpreter.
 */
import { afterAll, expect, it } from 'bun:test'
import { execFileSync, spawn as nodeSpawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getToolchain } from '@rox/shared/toolchain-runtime'
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

/** Does the vendored host expose the wave-9 `/cancel` route yet? */
function sidecarSupportsCancel(): boolean {
  try {
    return /["']\/cancel["']/.test(readFileSync(HOST_PY, 'utf8'))
  } catch {
    return false
  }
}

const pythonPath = await detectPython()
const hasCancelRoute = sidecarSupportsCancel()
const cancelIt = pythonPath && hasCancelRoute ? it : it.skip

const tempDirs: string[] = []
afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/**
 * Real wall-clock delay. This scenario drives an actual Python subprocess:
 * the kernel needs genuine time to start and to be torn down, so deterministic
 * fake timers cannot stand in for the platform process scheduler here.
 */
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** PIDs that currently have `rootPid` anywhere in their ancestry. */
function descendantsOf(rootPid: number): number[] {
  let rows: string
  try {
    rows = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' })
  } catch {
    return []
  }
  const parent = new Map<number, number>()
  for (const row of rows.split('\n')) {
    const [pidText, ppidText] = row.trim().split(/\s+/)
    const pid = Number(pidText)
    const ppid = Number(ppidText)
    if (Number.isInteger(pid) && Number.isInteger(ppid)) parent.set(pid, ppid)
  }
  const result: number[] = []
  for (const pid of parent.keys()) {
    let cursor: number | undefined = pid
    for (let hops = 0; cursor !== undefined && hops < 32; hops++) {
      const next: number | undefined = parent.get(cursor)
      if (next === rootPid) {
        result.push(pid)
        break
      }
      cursor = next
    }
  }
  return result
}

const skipReason = !pythonPath
  ? 'python-not-found'
  : !hasCancelRoute
    ? 'sidecar /cancel route not vendored yet (waits on slice P)'
    : undefined

cancelIt(
  skipReason ?? 'cancels an in-flight run end-to-end with no orphan kernel',
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'rox-cookbooks-cancel-it-'))
    tempDirs.push(workspace)
    if (!existsSync(COOKBOOKS_DIR)) throw new Error(`vendored snapshot missing: ${COOKBOOKS_DIR}`)

    let sidecarPid = 0
    const spawn: CookbooksSpawnFn = (command, args, options) => {
      const child = nodeSpawn(command, args, options)
      sidecarPid = child.pid ?? 0
      return child as unknown as CookbooksChild
    }

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
      const document = await runtime.apiDocument(notebook!.id)
      const codeIndex = document.cells.findIndex((cell) => cell.cellType === 'code')
      expect(codeIndex).toBeGreaterThanOrEqual(0)

      // A cell that would outlive the whole test on its own (the client budget
      // for /run is 90 s, the test budget 60 s).
      const started = Date.now()
      const inFlight = runtime.apiRun(
        notebook!.id,
        'import time; print("started", flush=True); time.sleep(30)',
        codeIndex,
      )
      // Let the kernel actually start before interrupting it.
      await delay(1_500)

      const cancelled = await runtime.apiCancel(notebook!.id)
      expect(cancelled.ok).toBe(true)
      expect(cancelled.cancelled).toBeGreaterThanOrEqual(1)

      const result = await inFlight
      const elapsed = Date.now() - started
      expect(result.cancelled).toBe(true)
      // Resolved by the interrupt, not by the 30 s sleep finishing.
      expect(elapsed).toBeLessThan(20_000)

      // The run's process tree is gone — no orphaned kernel survives the cancel.
      let orphans = descendantsOf(sidecarPid)
      for (let attempt = 0; attempt < 20 && orphans.length > 0; attempt++) {
        await delay(250)
        orphans = descendantsOf(sidecarPid)
      }
      expect(orphans).toEqual([])

      // The sidecar survived the interrupt and still serves a fresh run.
      const after = await runtime.apiRun(notebook!.id, 'print("ok")', codeIndex)
      expect(after.ok).toBe(true)
      expect(after.stdout).toContain('ok')
    } finally {
      await runtime.stop()
    }
  },
  60_000,
)
