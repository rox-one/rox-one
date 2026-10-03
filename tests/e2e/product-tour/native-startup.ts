import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const MAX_DIAGNOSTIC_CHARACTERS = 32 * 1024

/** A failed native launch retains its real child output and releases its profile. */
export async function observeFirstNativeWindow(
  app: ElectronApplication,
  profile: string,
  diagnosticPath: string,
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
  try {
    return await app.firstWindow()
  } catch (error) {
    // Only this fixture's private child/profile is observed or closed. Capture
    // before close so startup failure output cannot disappear with the process.
    const errors = [error]
    try {
      await mkdir(dirname(diagnosticPath), { recursive: true })
      await writeFile(diagnosticPath, JSON.stringify({
        status: 'failed-before-first-window',
        platform: process.platform,
        childPid: child.pid ?? null,
        diagnosticTailLimitCharacters: MAX_DIAGNOSTIC_CHARACTERS,
        ...output,
      }, null, 2) + '\n')
    } catch (diagnosticError) { errors.push(diagnosticError) }
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
