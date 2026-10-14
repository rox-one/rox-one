/**
 * Cookbooks sidecar — rich-output integration test (SPEC wave 11 §Тесты Electron).
 *
 * End-to-end proof that the wave-11 display protocol works through the REAL
 * vendored sidecar and the real runtime: a raw mime bundle comes back as a
 * record (`image/png` base64), the value of the cell's last top-level
 * expression becomes the `Out[]` display (`1+1` → `text/plain` `2`), a text
 * bundle travels verbatim — and the run's records are PERSISTED into the copy's
 * `.ipynb`, so re-reading the document answers `display_data` outputs with
 * their displays.
 *
 * The scenario is GATED on an interpreter only (the vendored kernel always
 * carries the results-file display transport since slice P1 landed): locally a
 * missing `python3` skips with a named reason, while CI fails loudly instead of
 * silently losing the rich-output proof. No mocks: the runtime drives a real
 * `serve_lab.py` child, and the kernel runs in the copy's own venv.
 */
import { afterAll, expect, it } from 'bun:test'
import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getToolchain } from '@rox/shared/toolchain-runtime'
import { CookbooksRuntime, type CookbooksChild, type CookbooksSpawnFn } from '../cookbooks-runtime'

const COOKBOOKS_DIR = join(import.meta.dir, '..', '..', '..', 'resources', 'cookbooks')

/** A 1×1 PNG, base64 — the payload the record below carries. */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const IMAGE_CODE = `display({"image/png": "${TINY_PNG}"}, raw=True)`
const HTML_CODE = 'display({"text/html": "<b>hi</b>"}, raw=True)'
/** No `display()` call at all: the `Out[]` value is the expression itself. */
const LAST_EXPRESSION_CODE = '1+1'

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
// Wave 11 (G3-6): a missing interpreter skips locally (the venv lane may not
// exist on a dev machine) but is a hard failure in CI, so the E2E can never
// disappear quietly from the gate.
if (!pythonPath && process.env.CI) {
  throw new Error('python3 required for the display E2E in CI')
}
const displayIt = pythonPath ? it : it.skip

const tempDirs: string[] = []
afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const skipReason = pythonPath ? undefined : 'python-not-found'

displayIt(
  skipReason ?? 'serves rich display_data records over /run and persists them in the copy',
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'rox-cookbooks-display-it-'))
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
      // Resume/create the personal copy — every run below persists into it.
      const opened = await runtime.apiOpen(itemId)
      const codeIndex = opened.document.cells.findIndex((cell) => cell.cellType === 'code')
      expect(codeIndex).toBeGreaterThanOrEqual(0)
      // The copy may already carry a counter from a previous run (nbformat int | null).
      const countBefore = opened.document.cells[codeIndex].executionCount ?? 0

      // 1) A raw mime bundle: exactly one `image/png` record comes back.
      const image = await runtime.apiRun(itemId, IMAGE_CODE, codeIndex)
      expect(image.ok).toBe(true)
      expect(image.error).toBeNull()
      expect(image.displays).toHaveLength(1)
      const imageRecord = image.displays[0]
      expect(imageRecord.mime).toBe('image/png')
      // wave 11: raw-бандл со str-base64 проходит без пере-кодирования.
      expect(imageRecord.data).toBe(TINY_PNG)

      // 2) `1+1` — the displayhook half: the last top-level expression is the
      //    one and only record, as its repr (Jupyter `Out[]`).
      const sum = await runtime.apiRun(itemId, LAST_EXPRESSION_CODE, codeIndex)
      expect(sum.ok).toBe(true)
      expect(sum.displays).toEqual([{ mime: 'text/plain', data: '2' }])

      // 3) A text bundle travels verbatim (only `image/*` is re-encoded).
      const html = await runtime.apiRun(itemId, HTML_CODE, codeIndex)
      expect(html.ok).toBe(true)
      expect(html.displays).toEqual([{ mime: 'text/html', data: '<b>hi</b>' }])

      // 4) Persistence: the copy's ipynb now answers the last run's output as a
      //    `display_data` record — read back through the document route.
      const reread = await runtime.apiDocument(itemId)
      const cell = reread.cells[codeIndex]
      expect(cell.outputs).toEqual([
        { text: '', traceback: null, displays: [{ mime: 'text/html', data: '<b>hi</b>' }] },
      ])
      // Every `/run` of this cell bumped its nbformat counter.
      expect(cell.executionCount).toBe(countBefore + 3)
    } finally {
      await runtime.stop()
    }
  },
  60_000,
)
