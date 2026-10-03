import { execFile, spawn, type ChildProcess } from 'node:child_process'

export type NativeProcessResult = {
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  error?: string
}

/** Only terminates this runner's CLI and its descendants, including its Electron process. */
async function terminateOwnedTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return
  child.unref()
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'inherit', windowsHide: true })
      const fallback = setTimeout(() => { killer.kill(); child.kill('SIGKILL'); resolve() }, 5_000)
      killer.once('error', () => { clearTimeout(fallback); child.kill('SIGKILL'); resolve() })
      killer.once('close', () => { clearTimeout(fallback); resolve() })
    })
  } else {
    // Playwright may put Electron in its own process group. Capture descendants
    // before their parent exits, so detached Electron children are still owned.
    const descendants = await new Promise<number[]>(resolve => {
      execFile('ps', ['-eo', 'pid=,ppid='], { timeout: 2_000, maxBuffer: 1_048_576 }, (error, stdout) => {
        if (error) { resolve([]); return }
        const processes = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number))
        const owned = new Set([child.pid!])
        let added = true
        while (added) {
          added = false
          for (const [pid, parent] of processes) if (owned.has(parent) && !owned.has(pid)) { owned.add(pid); added = true }
        }
        resolve([...owned].reverse())
      })
    })
    for (const pid of descendants) { try { process.kill(pid, 'SIGKILL') } catch { /* Already exited. */ } }
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
  }
}

/** Uses an asynchronous child and a parent deadline even if the test CLI never starts. */
export function runNativeProcess(command: string, args: string[], cwd: string, timeoutMs = 180_000): Promise<NativeProcessResult> {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', detached: process.platform !== 'win32', windowsHide: true })
    let timedOut = false
    let settled = false
    const finish = (result: NativeProcessResult) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      resolve(result)
    }
    const deadline = setTimeout(() => {
      timedOut = true
      console.error('Native process deadline elapsed; terminating this CLI and its owned descendants.')
      void terminateOwnedTree(child).then(() => finish({ exitCode: null, signal: 'SIGKILL', timedOut: true }))
    }, timeoutMs)
    child.once('error', error => finish({ exitCode: null, signal: null, timedOut, error: error.message }))
    child.once('close', (exitCode, signal) => finish({ exitCode, signal, timedOut }))
  })
}
