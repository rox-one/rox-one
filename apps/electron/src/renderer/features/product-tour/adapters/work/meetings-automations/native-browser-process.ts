function capturePipe(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ''
  const done = (async () => {
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        output = (output + decoder.decode(chunk.value, { stream: true })).slice(-65_536)
      }
      output += decoder.decode()
    } catch (error) { output += `\nOutput stream closed: ${String(error)}` }
  })()
  return { done, text: () => output, stop: () => { void reader.cancel().catch(() => {}) } }
}

// Test-only process boundary; Chromium and esbuild never share another test's Bun cache.
export function noteNativeBrowserStage(stage: string): void {
  console.error(`[native-browser] ${stage}`)
}

export async function runNativeBrowserProcess(command: string[], options: {
  label: string
  env?: Record<string, string | undefined>
  deadlineMs?: number
}): Promise<number> {
  const child = Bun.spawn(command, { env: options.env, stdout: 'pipe', stderr: 'pipe' })
  const stdout = capturePipe(child.stdout)
  const stderr = capturePipe(child.stderr)
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>(resolve => {
    timeout = setTimeout(() => {
      // Playwright handles SIGTERM and may stall during graceful browser shutdown.
      // The deadline must settle independently of that child process's exit.
      child.kill()
      resolve(null)
    }, options.deadlineMs ?? 40_000)
  })
  let drainTimeout: ReturnType<typeof setTimeout> | undefined
  try {
    const exitCode = await Promise.race([child.exited, deadline])
    // Give graceful shutdown a bounded chance to deliver its final diagnostics.
    // Descendants can inherit the pipes, so EOF never controls the test deadline.
    await Promise.race([
      Promise.all([stdout.done, stderr.done]),
      new Promise<void>(resolve => { drainTimeout = setTimeout(resolve, 1_000) }),
    ])
    if (exitCode !== 0) throw new Error(`Native browser case ${options.label} ${exitCode === null ? 'timed out' : `exited ${exitCode}`}:\n${stdout.text()}${stderr.text()}`)
    return exitCode
  } finally {
    clearTimeout(timeout)
    clearTimeout(drainTimeout)
    child.kill('SIGKILL')
    stdout.stop()
    stderr.stop()
  }
}
