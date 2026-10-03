import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('actual WindowManager generations and meeting IPC protect private audio while finalizing the owner recording offline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rox-meetings-ipc-'))
  try {
    const env: Record<string, string | undefined> = { ...process.env, CRAFT_CONFIG_DIR: directory, ROX_CONFIG_DIR: directory,
      ROX_SERVICE_SECRETS_FILE: join(directory, 'absent-secrets.env') }
    for (const name of ['DEEPGRAM_API_KEY', 'EXA_API_KEY', 'FIRECRAWL_API_KEY', 'BRAVE_API_KEY', 'E2B_API_KEY', 'TAVILY_API_KEY']) delete env[name]
    const process_ = Bun.spawn([process.execPath, join(import.meta.dir, 'local-ipc-binding.fixture.ts')], {
      cwd: join(import.meta.dir, '../../../../../..'), env, stdout: 'pipe', stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([process_.exited, new Response(process_.stdout).text(), new Response(process_.stderr).text()])
    expect({ exit, stdout, stderr }).toEqual({ exit: 0,
      stdout: 'meeting IPC: actual window generations, offline finalization, private audio, legacy binding and stale dialog fences passed\n', stderr: '' })
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 15_000)
