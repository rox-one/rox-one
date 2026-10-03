import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('real native WS quests isolate actors, deliver caller events and persist one reward across restart/revocation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-gamification-'))
  try {
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/native-gamification.ts')], {
      cwd: join(import.meta.dir, '../../../../../..'), env: { ...process.env, CRAFT_CONFIG_DIR: dir, ROX_CONFIG_DIR: dir }, stdout: 'pipe', stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
    const checks: Array<{ name: string; passed: boolean }> = JSON.parse(stdout)
    expect(checks).toHaveLength(31)
    expect(checks.filter(check => !check.passed)).toEqual([])
    if (process.env.QUEST_PROOF_DIR) {
      mkdirSync(process.env.QUEST_PROOF_DIR, { recursive: true })
      writeFileSync(join(process.env.QUEST_PROOF_DIR, 'native-gamification-checks.json'), JSON.stringify(checks, null, 2))
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 20000)
