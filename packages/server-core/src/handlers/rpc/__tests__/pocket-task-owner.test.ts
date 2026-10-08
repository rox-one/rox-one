import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('task RPC and deferred runner dispatch retain the existing sealed Pocket owner', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rox-task-pocket-owner-'))
  const root = join(import.meta.dir, '../../../../../..')
  try {
    const config = join(directory, 'tsconfig.json')
    writeFileSync(config, JSON.stringify({ compilerOptions: { baseUrl: root, paths: {
      '@rox/shared/*': [join(root, 'packages/shared/src/*')], '@rox/server-core/*': [join(root, 'packages/server-core/src/*')], '@rox/core/*': [join(root, 'packages/core/src/*')],
    } } }))
    const child = Bun.spawn([process.execPath, '--tsconfig-override', config, join(import.meta.dir, 'fixtures/pocket-task-owner.ts')], {
      cwd: root, env: { ...process.env, NODE_ENV: 'test', ROX_CONFIG_DIR: directory, CRAFT_CONFIG_DIR: directory }, stdout: 'pipe', stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ exit, stdout, stderr }).toMatchObject({ exit: 0 })
    expect(stdout).toContain('pocket task owner fixtures passed')
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 60_000)
