/** Structured stdout logging. Never log tokens, phones or codes. */

export type Level = 'debug' | 'info' | 'warn' | 'error'

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function threshold(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').trim().toLowerCase()
  return RANK[(raw as Level) in RANK ? (raw as Level) : 'info']
}

export function log(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (RANK[level] < threshold()) return
  const line: Record<string, unknown> = { ts: new Date().toISOString(), level, msg: message, ...fields }
  process.stdout.write(`${JSON.stringify(line)}\n`)
}