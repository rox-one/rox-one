import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUTOMATIONS_RETRY_QUEUE_FILE } from './constants.ts'
import { RetryScheduler } from './retry-scheduler.ts'
import type { WebhookAction, WebhookActionResult } from './types.ts'

const action: WebhookAction = { type: 'webhook', url: 'https://example.test/hook' }

function queuePath(dir: string): string {
  return join(dir, AUTOMATIONS_RETRY_QUEUE_FILE)
}

function readQueue(dir: string): Array<{ id: string; matcherId: string }> {
  const raw = readFileSync(queuePath(dir), 'utf8').trim()
  if (!raw) return []
  return raw.split('\n').map((line) => JSON.parse(line) as { id: string; matcherId: string })
}

describe('RetryScheduler', () => {
  it('cancels the bootstrap timer on dispose so no fetch runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-retry-'))
    writeFileSync(queuePath(dir), `${JSON.stringify({
      id: 'due-1',
      matcherId: 'm1',
      action,
      expandedUrl: action.url,
      deferredAttempt: 0,
      nextRetryAt: 0,
      createdAt: 0,
    })}\n`)
    let calls = 0
    const scheduler = new RetryScheduler({
      workspaceRootPath: dir,
      bootstrapDelayMs: 20,
      tickIntervalMs: 60_000,
      execute: async () => {
        calls += 1
        return { type: 'webhook', url: action.url, statusCode: 200, success: true }
      },
    })
    scheduler.start()
    scheduler.dispose()
    await Bun.sleep(60)
    expect(calls).toBe(0)
  })

  it('keeps an enqueue that arrives while a tick is waiting on HTTP', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-retry-'))
    writeFileSync(queuePath(dir), `${JSON.stringify({
      id: 'due-1',
      matcherId: 'm1',
      action,
      expandedUrl: action.url,
      deferredAttempt: 0,
      nextRetryAt: 0,
      createdAt: 0,
    })}\n`)

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduler = new RetryScheduler({
      workspaceRootPath: dir,
      now: () => 1,
      execute: async () => {
        await gate
        const result: WebhookActionResult = {
          type: 'webhook',
          url: action.url,
          statusCode: 200,
          success: true,
        }
        return result
      },
    })

    const tick = scheduler.processQueue()
    for (let i = 0; i < 40; i++) {
      const current = readQueue(dir)
      if (!current.some((entry) => entry.id === 'due-1')) break
      await Bun.sleep(5)
    }
    await scheduler.enqueue('m-new', action, action.url, 'later')
    release()
    await tick

    const remaining = readQueue(dir)
    expect(remaining.some((entry) => entry.matcherId === 'm-new')).toBe(true)
    expect(remaining.some((entry) => entry.id === 'due-1')).toBe(false)
  })

  it('does not duplicate timers across start/dispose/start', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-retry-'))
    let calls = 0
    const scheduler = new RetryScheduler({
      workspaceRootPath: dir,
      bootstrapDelayMs: 15,
      tickIntervalMs: 60_000,
      execute: async () => {
        calls += 1
        return { type: 'webhook', url: action.url, statusCode: 500, success: false }
      },
    })
    scheduler.start()
    scheduler.dispose()
    scheduler.start()
    scheduler.dispose()
    await Bun.sleep(50)
    expect(calls).toBe(0)
  })
})
