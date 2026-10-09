import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const MAX_DIAGNOSTIC_CHARACTERS = 32 * 1024
/**
 * A real window that never appears must fail the smoke, never hang its runner.
 * Playwright's `firstWindow()` has no timeout of its own, so a stalled product
 * boot used to consume the whole parent deadline with no recorded evidence.
 */
export const NATIVE_FIRST_WINDOW_TIMEOUT_MS = 30_000
/** The bounded wait rejects with this prefix; the owner statement above throws anything else. */
export const NATIVE_FIRST_WINDOW_TIMEOUT_MARKER = 'did not open a first window within'

export interface NativeStartupDiagnostics {
  status: 'failed-before-first-window'
  platform: NodeJS.Platform
  childPid: number | null
  diagnosticTailLimitCharacters: number
  stdout: string
  stderr: string
  /** Set only when the bounded wait, not the product, ended the attempt. */
  waitTimedOut?: boolean
}

export interface NativeStartupOptions {
  /** Retains the same private diagnostic tail in the caller's CI report. */
  report?: (diagnostics: NativeStartupDiagnostics) => Promise<void> | void
  timeoutMs?: number
}

/** A failed native launch retains its real child output and releases its profile. */
export async function observeFirstNativeWindow(
  app: ElectronApplication,
  profile: string,
  diagnosticPath: string,
  options: NativeStartupOptions = {},
): Promise<Page> {
  const child = app.process()
  const output = { stdout: '', stderr: '' }
  const listeners = (['stdout', 'stderr'] as const).map((channel) => {
    const stream = child[channel]
    const listener = (chunk: Buffer | string) => {
      output[channel] = (output[channel] + chunk.toString()).slice(-MAX_DIAGNOSTIC_CHARACTERS)
    }
    stream?.on('data', listener)
    return { stream, listener }
  })
  // Electron 44 added ~18 s to an already-slow Windows CI boot, and the last
  // green Electron-39 Windows lane shows the same ~72.9 s stall: the main
  // process stays JS-silent (~68.4 s) until the first node:sqlite/NativeAuthority
  // open, which itself takes 68-215 s in Windows CI. The 30 s local bound is
  // therefore unreachable in CI, so follow the repo's "xN in CI" startup-budget
  // convention and widen it 6x to 180 s there while keeping the local default.
  const timeoutMs = options.timeoutMs
    ?? (process.env.CI ? NATIVE_FIRST_WINDOW_TIMEOUT_MS * 6 : NATIVE_FIRST_WINDOW_TIMEOUT_MS)
  try {
    if (!(timeoutMs > 0)) return await app.firstWindow()
    return await Promise.race([
      app.firstWindow(),
      new Promise<never>((_, reject) => {
        // The losing arm only fails an already-settled race, and it never holds
        // the runner open once the real window arrived.
        setTimeout(() => reject(new Error(`Native product ${NATIVE_FIRST_WINDOW_TIMEOUT_MARKER} ${timeoutMs} ms`)), timeoutMs).unref?.()
      }),
    ])
  } catch (error) {
    // Only this fixture's private child/profile is observed or closed. Capture
    // before close so startup failure output cannot disappear with the process.
    const errors = [error]
    const diagnostics: NativeStartupDiagnostics = {
      status: 'failed-before-first-window',
      platform: process.platform,
      childPid: child.pid ?? null,
      diagnosticTailLimitCharacters: MAX_DIAGNOSTIC_CHARACTERS,
      stdout: output.stdout,
      stderr: output.stderr,
      ...(String((error as Error)?.message ?? '').includes(NATIVE_FIRST_WINDOW_TIMEOUT_MARKER) ? { waitTimedOut: true } : {}),
    }
    try {
      await mkdir(dirname(diagnosticPath), { recursive: true })
      await writeFile(diagnosticPath, JSON.stringify(diagnostics, null, 2) + '\n')
    } catch (diagnosticError) { errors.push(diagnosticError) }
    try { await options.report?.(diagnostics) }
    catch (reportError) { errors.push(reportError) }
    try { await app.close() }
    catch (closeError) { errors.push(closeError) }
    try { await rm(profile, { recursive: true, force: true }) }
    catch (cleanupError) { errors.push(cleanupError) }
    if (errors.length > 1) throw new AggregateError(errors, 'Native startup failed and diagnostics or cleanup also failed')
    throw error
  } finally {
    for (const { stream, listener } of listeners) stream?.off('data', listener)
  }
}
