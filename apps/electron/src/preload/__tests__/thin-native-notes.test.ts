import { expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('real thin preload authors canonical Notes through authenticated remote RPC and registered local custody', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'rox-thin-native-notes-')))
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'thin-native-notes.fixture.ts')], {
      cwd: join(import.meta.dir, '../../..'),
      env: {
        ...process.env,
        CRAFT_CONFIG_DIR: directory,
        ROX_CONFIG_DIR: directory,
        ROX_SERVICE_SECRETS_FILE: join(directory, 'absent-service-secrets.env'),
        CRAFT_SERVER_URL: '',
        CRAFT_SERVER_TOKEN: '',
        CRAFT_WORKSPACE_ID: '',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    const shutdownLogs = new Set([
      '[transport] disconnected — close 1000',
      '[transport] disconnected — unknown [CLIENT_DESTROYED]: Client destroyed',
    ])
    const unexpectedErrors = stderr.split('\n').filter(line => line && !shutdownLogs.has(line))
    expect({ exit, unexpectedErrors }).toEqual({ exit: 0, unexpectedErrors: [] })
    expect(stdout).toContain('thin native Notes: common IPC registration, authenticated remote creation, read/watch/cache/close and denied foreign identity passed\n')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 20_000)
