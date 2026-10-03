import { expect, test } from 'bun:test'
import { join } from 'node:path'

test('native Inbox queued turn keeps active ownership and carries authorized queued provenance', async () => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/native-inbox-queued-turn.ts')], {
    cwd: join(import.meta.dir, '../../../../../..'), stdout: 'pipe', stderr: 'pipe',
  })
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  // The synthetic stop exercises the real replay failure cleanup before any model starts.
  expect({ exit, marker: stdout.includes('native Inbox queued turn passed'), stoppedBeforeModel: stderr.includes('REVIEW_STOP_BEFORE_MODEL') })
    .toEqual({ exit: 0, marker: true, stoppedBeforeModel: true })
}, 20000)
