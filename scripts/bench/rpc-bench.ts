#!/usr/bin/env bun
/**
 * Baseline: WsRpc request round-trip p50/p95.
 */
import { WsRpcServer } from '../../packages/server-core/src/transport/server.ts'
import { WsRpcClient } from '../../packages/server-core/src/transport/client.ts'

const TOKEN = 'bench-token-with-enough-entropy-xx'
const N = 200

const server = new WsRpcServer({
  host: '127.0.0.1',
  port: 0,
  requireAuth: true,
  validateToken: async (t) => t === TOKEN,
  serverId: 'bench',
})
server.handle('bench:echo', async (_ctx, value: string) => value)
await server.listen()

const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token: TOKEN, autoReconnect: false })
client.connect()

const samples: number[] = []
for (let i = 0; i < N; i++) {
  const t0 = Number(process.hrtime.bigint()) / 1e6
  await client.invoke('bench:echo', `n${i}`)
  samples.push(Number(process.hrtime.bigint()) / 1e6 - t0)
}
samples.sort((a, b) => a - b)
const pct = (p: number) => samples[Math.min(samples.length - 1, Math.floor((p / 100) * samples.length))]!
console.log(JSON.stringify({ n: N, p50: pct(50), p95: pct(95), max: samples[samples.length - 1] }))

client.destroy()
server.close()
