import { existsSync, writeFileSync } from 'node:fs'
import { SqliteBroInviteStore } from '../durable-store.ts'
import { parseInviteUrl } from '../invite.ts'

const [databasePath, operation, url, accountId, timestamp, barrier, workerId] = process.argv.slice(2)
if (!databasePath || !operation || !url || !accountId || !timestamp) throw new Error('fixture arguments are required')
const store = new SqliteBroInviteStore(databasePath, () => Number(timestamp))
try {
  if (barrier) {
    writeFileSync(`${barrier}.${workerId}.ready`, 'ready')
    const deadline = Date.now() + 5_000
    while (!existsSync(barrier)) {
      if (Date.now() >= deadline) throw new Error('fixture barrier timed out')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
  const result = operation === 'revoke'
    ? { revoked: store.revoke(parseInviteUrl(url)!.joinKey, accountId) }
    : store.join(url, { accountId, username: accountId, displayName: accountId })
  process.stdout.write(JSON.stringify(result))
} finally {
  store.close()
}
