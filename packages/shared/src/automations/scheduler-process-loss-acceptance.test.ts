import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUTOMATIONS_HISTORY_FILE, AUTOMATIONS_RETRY_QUEUE_FILE } from './constants.ts'
import { matchesCron } from './cron-matcher.ts'
import { claimAutomationOccurrence } from './occurrence-ledger.ts'
import type { RetryQueueEntry } from './retry-scheduler.ts'

function retain(name: string, evidence: unknown) {
  const directory = process.env.SCHEDULER_ACCEPTANCE_EVIDENCE_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, name + '.json'), JSON.stringify(evidence, null, 2) + '\n')
}

const retryModule = join(import.meta.dir, 'retry-scheduler.ts')
async function recover(root: string) {
  const child = Bun.spawn([process.execPath, '-e', `
const {RetryScheduler}=await import(${JSON.stringify(retryModule)});
const scheduler=new RetryScheduler({workspaceRootPath:process.env.SCHEDULER_FIXTURE_ROOT});
await scheduler.tick();scheduler.dispose();
`], { env: { ...process.env, SCHEDULER_FIXTURE_ROOT: root }, stdout: 'pipe', stderr: 'pipe' })
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
  return { pid: child.pid, exit, stdout }
}

test('SIGKILL after loopback effect before ACK recovers once without repeating HTTP', async () => {
  const root = mkdtempSync(join(tmpdir(), 'scheduler-process-loss-'))
  let effects = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async request => {
    expect(new URL(request.url).pathname).toBe('/owned-effect')
    expect(request.method).toBe('POST')
    effects++
    return new Response('accepted')
  } })
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined
  try {
    const url = `http://127.0.0.1:${server.port}/owned-effect`
    const row: RetryQueueEntry = { id: 'retry-1', matcherId: 'fixture-matcher', action: { type: 'webhook', url, method: 'POST' }, expandedUrl: url, deferredAttempt: 0, nextRetryAt: 0, createdAt: 1, scheduledAt: '2026-11-01T05:30:00.000Z', scheduledTimezone: 'America/New_York', occurrenceKey: 'fixture-overlap-first', matcherRevision: 'fixture-revision', actionIndex: 0, runId: 'fixture-run' }
    writeFileSync(join(root, AUTOMATIONS_RETRY_QUEUE_FILE), JSON.stringify(row) + '\n')
    child = Bun.spawn([process.execPath, '-e', `
const {RetryScheduler}=await import(${JSON.stringify(retryModule)});
const {writeFileSync}=await import('node:fs');const {join}=await import('node:path');
const root=process.env.SCHEDULER_FIXTURE_ROOT;
const scheduler=new RetryScheduler({workspaceRootPath:root,executeRequest:async(action)=>{const response=await fetch(action.url,{method:action.method});return {type:'webhook',url:action.url,statusCode:response.status,success:response.ok,durationMs:1};},beforeAck:async()=>{writeFileSync(join(root,'ready'),'effect-before-ack');await new Promise(()=>{});}});
await scheduler.tick();
`], { env: { ...process.env, SCHEDULER_FIXTURE_ROOT: root }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const deadline = Date.now() + 5000
    while (!existsSync(join(root, 'ready')) && Date.now() < deadline) await Bun.sleep(10)
    expect(existsSync(join(root, 'ready'))).toBe(true)
    expect(effects).toBe(1)
    const inFlight = JSON.parse(readFileSync(join(root, AUTOMATIONS_RETRY_QUEUE_FILE), 'utf8'))
    expect(inFlight).toEqual({ ...row, state: 'in_flight' })
    expect(existsSync(join(root, AUTOMATIONS_HISTORY_FILE))).toBe(false)
    child.kill('SIGKILL')
    await child.exited
    expect(child.signalCode).toBe('SIGKILL')
    const first = await recover(root)
    expect(effects).toBe(1)
    expect(readFileSync(join(root, AUTOMATIONS_RETRY_QUEUE_FILE), 'utf8')).toBe('')
    const historyBytes = readFileSync(join(root, AUTOMATIONS_HISTORY_FILE), 'utf8')
    const history = JSON.parse(historyBytes)
    expect(history.outcome).toBe('unknown_external_outcome')
    expect(history.scheduledAt).toBe(row.scheduledAt)
    expect(history.timezone).toBe(row.scheduledTimezone)
    expect(history.occurrenceKey).toBe(row.occurrenceKey)
    expect(history.runId).toBe(row.runId)
    expect(history.matcherRevision).toBe(row.matcherRevision)
    expect(history.actionIndex).toBe(row.actionIndex)
    const second = await recover(root)
    expect(second.pid).not.toBe(first.pid)
    expect(effects).toBe(1)
    expect(readFileSync(join(root, AUTOMATIONS_HISTORY_FILE), 'utf8')).toBe(historyBytes)
    retain('sigkill-recovery', { childPid: child.pid, signal: child.signalCode, effects, inFlight, history, first, second })
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGKILL'); await child.exited }
    server.stop(true)
    rmSync(root, { recursive: true, force: true })
  }
}, 15000)

test('selected New York zone skips spring gap and persists distinct repeated autumn instants', () => {
  const root = mkdtempSync(join(tmpdir(), 'scheduler-dst-'))
  try {
    for (const instant of ['2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z']) expect(matchesCron('30 2 * * *', 'America/New_York', instant)).toBe(false)
    const instants = ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']
    const claims = instants.map(scheduledAt => {
      expect(matchesCron('30 1 * * *', 'America/New_York', scheduledAt)).toBe(true)
      expect(matchesCron('30 1 * * *', 'UTC', scheduledAt)).toBe(false)
      const context = { workspaceId: 'fixture-workspace', matcherId: 'fixture-matcher', matcherRevision: 'fixture-revision', scheduledAt, scheduledTimezone: 'America/New_York', actionIndex: 0 }
      const key = `fixture:${scheduledAt}`
      const claim = claimAutomationOccurrence(root, key, context)
      expect(claim.claimed).toBe(true)
      expect(claimAutomationOccurrence(root, key, context)).toEqual({ ...claim, claimed: false })
      return claim
    })
    expect(claims[0]!.runId).not.toBe(claims[1]!.runId)
    retain('selected-zone-dst', { timezone: 'America/New_York', instants, claims, policy: 'both overlap occurrences, skip gap' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

for (const boundary of ['afterTerminalPersist', 'afterHistoryPersist'] as const) test(`SIGKILL ${boundary} replays exact terminal history without HTTP`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'scheduler-terminal-'))
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined
  try {
    const row = { id: 'terminal-fixture', matcherId: 'fixture', action: { type: 'webhook', url: 'https://example.invalid', method: 'POST' }, expandedUrl: 'https://example.invalid', deferredAttempt: 0, nextRetryAt: 0, createdAt: 1, state: 'in_flight', runId: 'fixture-run', matcherRevision: 'fixture-revision', actionIndex: 0 }
    writeFileSync(join(root, AUTOMATIONS_RETRY_QUEUE_FILE), JSON.stringify(row) + '\n')
    child = Bun.spawn([process.execPath, '-e', `
const {RetryScheduler}=await import(${JSON.stringify(retryModule)});
const {writeFileSync}=await import('node:fs');const {join}=await import('node:path');const root=process.env.SCHEDULER_FIXTURE_ROOT;
const scheduler=new RetryScheduler({workspaceRootPath:root,executeRequest:async()=>{throw Error('HTTP must never run');},${boundary}:async()=>{writeFileSync(join(root,'ready'),'terminal-boundary');await new Promise(()=>{});}});await scheduler.tick();
`], { env: { ...process.env, SCHEDULER_FIXTURE_ROOT: root }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const deadline = Date.now() + 5000
    while (!existsSync(join(root, 'ready')) && Date.now() < deadline) await Bun.sleep(10)
    expect(existsSync(join(root, 'ready'))).toBe(true)
    const staged = JSON.parse(readFileSync(join(root, AUTOMATIONS_RETRY_QUEUE_FILE), 'utf8'))
    expect(staged.state).toBe('terminal_pending')
    expect(staged.terminalHistory.runId).toBe(row.runId)
    expect(existsSync(join(root, AUTOMATIONS_HISTORY_FILE))).toBe(boundary === 'afterHistoryPersist')
    child.kill('SIGKILL'); await child.exited
    expect(child.signalCode).toBe('SIGKILL')
    await recover(root)
    const history = readFileSync(join(root, AUTOMATIONS_HISTORY_FILE), 'utf8')
    expect(JSON.parse(history)).toEqual(staged.terminalHistory)
    expect(readFileSync(join(root, AUTOMATIONS_RETRY_QUEUE_FILE), 'utf8')).toBe('')
    await recover(root)
    expect(readFileSync(join(root, AUTOMATIONS_HISTORY_FILE), 'utf8')).toBe(history)
    retain(boundary, { signal: child.signalCode, staged, history: JSON.parse(history) })
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGKILL'); await child.exited }
    rmSync(root, { recursive: true, force: true })
  }
}, 15000)

test('history directory obstruction retains terminal intent and recovers once after removal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'scheduler-history-obstruction-'))
  try {
    mkdirSync(join(root, AUTOMATIONS_HISTORY_FILE))
    writeFileSync(join(root, AUTOMATIONS_RETRY_QUEUE_FILE), JSON.stringify({ id: 'obstructed', matcherId: 'fixture', action: { type: 'webhook', url: 'https://example.invalid', method: 'POST' }, expandedUrl: 'https://example.invalid', deferredAttempt: 0, nextRetryAt: 0, createdAt: 1, state: 'in_flight' }) + '\n')
    await recover(root)
    const staged = JSON.parse(readFileSync(join(root, AUTOMATIONS_RETRY_QUEUE_FILE), 'utf8'))
    expect(staged.state).toBe('terminal_pending')
    rmSync(join(root, AUTOMATIONS_HISTORY_FILE), { recursive: true })
    await recover(root)
    const history = readFileSync(join(root, AUTOMATIONS_HISTORY_FILE), 'utf8')
    expect(JSON.parse(history)).toEqual(staged.terminalHistory)
    await recover(root)
    expect(readFileSync(join(root, AUTOMATIONS_HISTORY_FILE), 'utf8')).toBe(history)
    expect(readFileSync(join(root, AUTOMATIONS_RETRY_QUEUE_FILE), 'utf8')).toBe('')
    retain('history-obstruction', { staged, history: JSON.parse(history) })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
