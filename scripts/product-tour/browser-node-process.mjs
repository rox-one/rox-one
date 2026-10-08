import { execFile, spawn } from 'node:child_process'

// The same ownership walk used by native-process.ts, with cleanup bounded by
// the browser parent's existing one-second diagnostic drain. Playwright may
// detach Chromium, so ancestry must be captured before its Node parent exits.
export async function terminateOwnedBrowserTree(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      const fallback = setTimeout(() => { killer.kill(); child.kill('SIGKILL'); resolve() }, 500)
      killer.once('error', () => { clearTimeout(fallback); child.kill('SIGKILL'); resolve() })
      killer.once('close', () => { clearTimeout(fallback); resolve() })
    })
    return
  }
  const descendants = await new Promise(resolve => {
    execFile('ps', ['-eo', 'pid=,ppid='], { timeout: 500, maxBuffer: 1_048_576 }, (error, stdout) => {
      if (error) { resolve([]); return }
      const processes = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number))
      const owned = new Set([child.pid])
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

export function bindOwnedBrowserTermination(child) {
  let termination
  const terminate = () => termination ??= terminateOwnedBrowserTree(child)
  const onSignal = () => { void terminate() }
  process.once('SIGTERM', onSignal)
  process.once('SIGINT', onSignal)
  return {
    terminate,
    dispose() { process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal) },
  }
}
