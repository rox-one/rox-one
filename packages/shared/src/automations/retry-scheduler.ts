/**
 * RetryScheduler - Persistent retry queue for failed webhooks
 *
 * When immediate retries (seconds-scale) are exhausted and a webhook still fails,
 * it's added to a persistent JSONL queue file. The scheduler checks the queue
 * every 60 seconds and retries at increasing intervals:
 *   - 1st deferred: 5 minutes
 *   - 2nd deferred: 30 minutes
 *   - 3rd deferred: 1 hour
 *
 * After all deferred attempts fail, the entry is removed and a final history
 * entry is written. Queue entries survive app restarts.
 *
 * Queue mutations are serialized. Tick claims due jobs under the lock, runs
 * HTTP outside the lock, then acks. Concurrent enqueue cannot be overwritten.
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../utils/debug.ts';
import { executeWebhookRequest, createWebhookHistoryEntry } from './webhook-utils.ts';
import { AUTOMATIONS_RETRY_QUEUE_FILE } from './constants.ts';
import { appendAutomationHistoryEntry } from './history-store.ts';
import type { WebhookAction, WebhookActionResult } from './types.ts';

const log = createLogger('retry-scheduler');

const DEFERRED_DELAYS_MS = [
  5 * 60_000,
  30 * 60_000,
  60 * 60_000,
];

const MAX_DEFERRED_ATTEMPTS = DEFERRED_DELAYS_MS.length;
const TICK_INTERVAL_MS = 60_000;
const BOOTSTRAP_DELAY_MS = 5_000;

export interface RetryQueueEntry {
  id: string;
  matcherId: string;
  action: WebhookAction;
  expandedUrl: string;
  deferredAttempt: number;
  nextRetryAt: number;
  createdAt: number;
  lastError?: string;
}

export type RetryExecute = (
  action: WebhookAction,
  options?: { timeoutMs?: number },
) => Promise<WebhookActionResult>;

export interface RetrySchedulerOptions {
  workspaceRootPath: string;
  now?: () => number;
  execute?: RetryExecute;
  bootstrapDelayMs?: number;
  tickIntervalMs?: number;
}

export class RetryScheduler {
  private readonly workspaceRootPath: string;
  private readonly now: () => number;
  private readonly execute: RetryExecute;
  private readonly bootstrapDelayMs: number;
  private readonly tickIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private stopped = false;
  private mutex: Promise<void> = Promise.resolve();

  constructor(options: RetrySchedulerOptions) {
    this.workspaceRootPath = options.workspaceRootPath;
    this.now = options.now ?? Date.now;
    this.execute = options.execute ?? executeWebhookRequest;
    this.bootstrapDelayMs = options.bootstrapDelayMs ?? BOOTSTRAP_DELAY_MS;
    this.tickIntervalMs = options.tickIntervalMs ?? TICK_INTERVAL_MS;
  }

  start(): void {
    if (this.timer || this.bootstrapTimer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
    log.debug('[RetryScheduler] Started');
    this.bootstrapTimer = setTimeout(() => {
      this.bootstrapTimer = null;
      if (!this.stopped) void this.tick();
    }, this.bootstrapDelayMs);
  }

  dispose(): void {
    this.stopped = true;
    if (this.bootstrapTimer) {
      clearTimeout(this.bootstrapTimer);
      this.bootstrapTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.debug('[RetryScheduler] Disposed');
  }

  async enqueue(
    matcherId: string,
    action: WebhookAction,
    expandedUrl: string,
    lastError?: string,
  ): Promise<void> {
    const entry: RetryQueueEntry = {
      id: `${matcherId}-${this.now()}-${Math.random().toString(36).slice(2, 6)}`,
      matcherId,
      action,
      expandedUrl,
      deferredAttempt: 0,
      nextRetryAt: this.now() + DEFERRED_DELAYS_MS[0]!,
      createdAt: this.now(),
      lastError,
    };

    await this.withLock(async () => {
      const entries = await this.readEntries();
      entries.push(entry);
      await this.writeEntries(entries);
    });
    log.debug(`[RetryScheduler] Enqueued ${entry.id} — next retry in ${DEFERRED_DELAYS_MS[0]! / 60_000}m`);
  }

  /** Exposed for tests. Production uses start()/interval. */
  async processQueue(): Promise<void> {
    await this.tick();
  }

  private queuePath(): string {
    return join(this.workspaceRootPath, AUTOMATIONS_RETRY_QUEUE_FILE);
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutex.then(fn, fn);
    this.mutex = run.then(() => undefined, () => undefined);
    return run;
  }

  private async readEntries(): Promise<RetryQueueEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.queuePath(), 'utf-8');
    } catch {
      return [];
    }
    const lines = raw.trim().split('\n').filter(Boolean);
    const entries: RetryQueueEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as RetryQueueEntry);
      } catch {
        // Skip malformed lines rather than wiping the queue.
      }
    }
    return entries;
  }

  private async writeEntries(entries: RetryQueueEntry[]): Promise<void> {
    if (entries.length === 0) {
      await writeFile(this.queuePath(), '', 'utf-8');
      return;
    }
    await writeFile(
      this.queuePath(),
      `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
      'utf-8',
    );
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.processing) return;
    this.processing = true;

    try {
      const due = await this.withLock(async () => {
        const entries = await this.readEntries();
        if (entries.length === 0) return [];
        const now = this.now();
        const claimed = entries.filter((entry) => entry.nextRetryAt <= now);
        const remaining = entries.filter((entry) => entry.nextRetryAt > now);
        if (claimed.length > 0) await this.writeEntries(remaining);
        return claimed;
      });

      for (const entry of due) {
        if (this.stopped) {
          await this.withLock(async () => {
            const entries = await this.readEntries();
            entries.push(entry);
            await this.writeEntries(entries);
          });
          continue;
        }

        log.debug(`[RetryScheduler] Retrying ${entry.id} (deferred attempt ${entry.deferredAttempt + 1}/${MAX_DEFERRED_ATTEMPTS})`);
        let result: WebhookActionResult;
        try {
          result = await this.execute(entry.action, { timeoutMs: 30_000 });
        } catch (err) {
          result = {
            type: 'webhook',
            url: entry.expandedUrl,
            statusCode: 0,
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          };
        }

        if (this.stopped) {
          await this.withLock(async () => {
            const entries = await this.readEntries();
            entries.push(entry);
            await this.writeEntries(entries);
          });
          continue;
        }

        await this.withLock(async () => {
          if (result.success) {
            log.debug(`[RetryScheduler] ${entry.id} succeeded on deferred attempt ${entry.deferredAttempt + 1}`);
            await this.writeHistory({
              matcherId: entry.matcherId,
              ok: true,
              method: entry.action.method,
              url: entry.expandedUrl,
              statusCode: result.statusCode,
              durationMs: result.durationMs ?? 0,
              attempts: entry.deferredAttempt + 1,
            });
            return;
          }

          if (entry.deferredAttempt + 1 >= MAX_DEFERRED_ATTEMPTS) {
            log.debug(`[RetryScheduler] ${entry.id} permanently failed after ${MAX_DEFERRED_ATTEMPTS} deferred attempts`);
            await this.writeHistory({
              matcherId: entry.matcherId,
              ok: false,
              method: entry.action.method,
              url: entry.expandedUrl,
              statusCode: result.statusCode,
              durationMs: result.durationMs ?? 0,
              attempts: entry.deferredAttempt + 1,
              error: result.error ?? 'Unknown error',
            });
            return;
          }

          const nextDelay = DEFERRED_DELAYS_MS[entry.deferredAttempt + 1]!;
          const entries = await this.readEntries();
          entries.push({
            ...entry,
            deferredAttempt: entry.deferredAttempt + 1,
            nextRetryAt: this.now() + nextDelay,
            lastError: result.error,
          });
          await this.writeEntries(entries);
          log.debug(`[RetryScheduler] ${entry.id} failed — next retry in ${nextDelay / 60_000}m`);
        });
      }
    } catch (err) {
      log.debug(`[RetryScheduler] Tick error: ${err}`);
    } finally {
      this.processing = false;
    }
  }

  private async writeHistory(opts: {
    matcherId: string;
    ok: boolean;
    method?: string;
    url: string;
    statusCode: number;
    durationMs: number;
    attempts?: number;
    error?: string;
  }): Promise<void> {
    const historyEntry = createWebhookHistoryEntry(opts);
    try {
      await appendAutomationHistoryEntry(this.workspaceRootPath, historyEntry);
    } catch (e) {
      log.debug(`[RetryScheduler] Failed to write history: ${e}`);
    }
  }
}
