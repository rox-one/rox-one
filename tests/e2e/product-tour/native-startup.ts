/** Test-only lifecycle diagnostics; these checks never establish OS/native acceptance. */
import type { ChildProcess } from 'node:child_process'
import { open, readdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

const tailLimit = 64 * 1024
export interface NativeStartupDiagnostics {
  stage: 'launch' | 'first-window'
  error: string
  pid: number | null
  exitCode: number | null
  signalCode: string | null
  stdout: string | null
  stderr: string | null
  profileLogs: Array<{ path: string; tail: string }>
  scope: 'Owned fresh-profile startup diagnostics; no native acceptance result'
}

async function ownedLogTails(profile: string): Promise<NativeStartupDiagnostics['profileLogs']> {
  const root = await realpath(profile)
  const logs: NativeStartupDiagnostics['profileLogs'] = []
  const pending = [join(root, 'userData'), join(root, 'appData'), join(root, 'home', 'Library', 'Logs')].map(path => ({ path, depth: 0 }))
  let visited = 0
  while (pending.length && visited++ < 256 && logs.length < 4) {
    const current = pending.shift()!
    const entries = await readdir(current.path, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = join(current.path, entry.name)
      if (entry.isDirectory() && current.depth < 4 && pending.length + visited < 256 && !/^(cache|code cache|gpucache|crashpad|service worker)$/i.test(entry.name)) {
        pending.push({ path, depth: current.depth + 1 })
      } else if (entry.isFile() && entry.name === 'main.log' && logs.length < 4) {
        const actual = await realpath(path).catch(() => '')
        const owned = relative(root, actual)
        if (!actual || isAbsolute(owned) || owned === '..' || owned.startsWith('..\\') || owned.startsWith('../')) continue
        const file = await open(actual, 'r').catch(() => null)
        if (!file) continue
        try {
          const size = (await file.stat()).size
          const bytes = Buffer.alloc(Math.min(size, tailLimit))
          const { bytesRead } = await file.read(bytes, 0, bytes.length, Math.max(0, size - bytes.length))
          logs.push({ path: owned, tail: bytes.subarray(0, bytesRead).toString('utf8') })
        } finally { await file.close() }
      }
    }
  }
  return logs
}

export interface NativeStartupApp<Page> {
  process(): ChildProcess
  firstWindow(): Promise<Page>
  close(): Promise<void>
}

/** The caller launches the unchanged real product entrypoint; no alternate app is supplied here. */
export async function openNativeStartup<Page, App extends NativeStartupApp<Page>>(input: {
  profile: string
  launch(): Promise<App>
  report(diagnostics: NativeStartupDiagnostics): Promise<void>
}): Promise<{ app: App; page: Page; dispose(): Promise<void> }> {
  let app: App | undefined
  // ElectronApplication's Playwright binding is gone after close(). Keep only
  // this owned process reference for diagnostics and listener cleanup.
  let child: ChildProcess | undefined
  let stage: NativeStartupDiagnostics['stage'] = 'launch'
  let stdout: string | null = null
  let stderr: string | null = null
  const captureOut = (chunk: Buffer | string) => { stdout = (stdout! + chunk.toString()).slice(-tailLimit) }
  const captureErr = (chunk: Buffer | string) => { stderr = (stderr! + chunk.toString()).slice(-tailLimit) }
  const detach = () => { child?.stdout?.off('data', captureOut); child?.stderr?.off('data', captureErr) }
  let disposing: Promise<void> | undefined
  const dispose = () => disposing ??= (async () => {
    try { await app?.close() }
    finally {
      try { detach() }
      finally { await rm(input.profile, { recursive: true, force: true }) }
    }
  })()
  try {
    app = await input.launch()
    child = app.process()
    if (child.stdout) { stdout = ''; child.stdout.on('data', captureOut) }
    if (child.stderr) { stderr = ''; child.stderr.on('data', captureErr) }
    stage = 'first-window'
    // Preserve Playwright's existing 30s firstWindow timeout.
    const page = await app.firstWindow()
    return { app, page, dispose }
  } catch (error) {
    const diagnostics: NativeStartupDiagnostics = {
      stage, error: String(error), pid: child?.pid ?? null,
      exitCode: child?.exitCode ?? null, signalCode: child?.signalCode ?? null,
      stdout, stderr, profileLogs: await ownedLogTails(input.profile).catch(() => []),
      scope: 'Owned fresh-profile startup diagnostics; no native acceptance result',
    }
    // Attach before app.close/profile removal, including when shutdown stalls.
    try { await input.report(diagnostics) }
    catch (reportError) { console.error('Native startup diagnostic attachment failed:', reportError) }
    try { await dispose() }
    catch (cleanupError) { console.error('Native startup cleanup failed:', cleanupError) }
    throw error
  }
}
