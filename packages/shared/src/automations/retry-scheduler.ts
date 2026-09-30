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
 * Terminal outcomes retain an exact history intent until its append is
 * confirmed, then remove the queue entry. Queue entries survive app restarts.
 *
 * Queue mutations are serialized so enqueue during an in-flight tick cannot
 * be overwritten. HTTP runs outside the lock; the rewrite re-reads the file
 * and merges. Dispose cancels the bootstrap timer and owned in-flight requests.
 *
 * Single-process invariant: one RetryScheduler owns AUTOMATIONS_RETRY_QUEUE_FILE
 * for a workspace. Multi-worker / multi-process leases and DLQ are unsupported.
 * Each due row is durably marked in-flight before its HTTP effect. Known results
 * first persist a terminal_pending intent for exact history recovery before
 * queue removal. On restart, in-flight rows become unknown terminal outcomes;
 * terminal_pending history is recovered without automatic resend. Only
 * acknowledged known failures become eligible for the next deferred attempt.
 */

import { readFile, writeFile, appendFile, rename } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../utils/debug.ts';
import { executeWebhookRequest, createWebhookHistoryEntry } from './webhook-utils.ts';
import { AUTOMATIONS_RETRY_QUEUE_FILE } from './constants.ts';
import { appendAutomationHistoryEntryExact } from './history-store.ts';
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

export type RetryExecuteRequest = (
  action: WebhookAction,
  options: { timeoutMs: number; signal?: AbortSignal },
) => Promise<WebhookActionResult>;

export interface RetryQueueEntry {
  id: string;
  matcherId: string;
  action: WebhookAction;
  expandedUrl: string;
  deferredAttempt: number;
  nextRetryAt: number;
  createdAt: number;
  lastError?: string;
  state?: 'ready' | 'in_flight' | 'terminal_pending';
  terminalHistory?: Record<string, unknown>;
  scheduledAt?: string;
  scheduledTimezone?: string;
  occurrenceKey?: string;
  matcherRevision?: string;
  actionIndex?: number;
  runId?: string;
}

export interface RetrySchedulerOptions {
  workspaceRootPath: string;
  executeRequest?: RetryExecuteRequest;
  bootstrapDelayMs?: number;
  tickIntervalMs?: number;
  /** Invoked after the HTTP effect, immediately before the JSONL ack. */
  beforeAck?: () => Promise<void>;
  afterTerminalPersist?: () => Promise<void>;
  afterHistoryPersist?: () => Promise<void>;
}

type HistoryInput = Parameters<typeof createWebhookHistoryEntry>[0];

type QueueOutcome =
  | { kind: 'drop'; history: HistoryInput }
  | { kind: 'keep'; entry: RetryQueueEntry };

export class RetryScheduler {
  private readonly workspaceRootPath: string;
  private readonly executeRequest: RetryExecuteRequest;
  private readonly bootstrapDelayMs: number;
  private readonly tickIntervalMs: number;
  private readonly beforeAck?: () => Promise<void>;
  private readonly afterTerminalPersist?: () => Promise<void>;
  private readonly afterHistoryPersist?: () => Promise<void>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private stopped = false;
  private generation = 0;
  private requestAbort: AbortController | null = null;
  private queueLock: Promise<void> = Promise.resolve();
  private pendingAcks = new Map<string, QueueOutcome>();

  constructor(options: RetrySchedulerOptions) {
    this.workspaceRootPath = options.workspaceRootPath;
    this.executeRequest = options.executeRequest ?? executeWebhookRequest;
    this.bootstrapDelayMs = options.bootstrapDelayMs ?? BOOTSTRAP_DELAY_MS;
    this.tickIntervalMs = options.tickIntervalMs ?? TICK_INTERVAL_MS;
    this.beforeAck = options.beforeAck;
    this.afterTerminalPersist = options.afterTerminalPersist;
    this.afterHistoryPersist = options.afterHistoryPersist;
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.generation += 1;
    this.requestAbort?.abort();
    this.requestAbort = new AbortController();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
    log.debug('[RetryScheduler] Started');
    this.bootstrapTimer = setTimeout(() => {
      this.bootstrapTimer = null;
      void this.tick();
    }, this.bootstrapDelayMs);
  }

  dispose(): void {
    this.stopped = true;
    this.generation += 1;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.bootstrapTimer) {
      clearTimeout(this.bootstrapTimer);
      this.bootstrapTimer = null;
    }
    this.requestAbort?.abort();
    this.requestAbort = null;
    this.pendingAcks.clear();
    log.debug('[RetryScheduler] Disposed');
  }

  async enqueue(
    matcherId: string,
    action: WebhookAction,
    expandedUrl: string,
    lastError?: string,
    schedule?: Pick<RetryQueueEntry, 'scheduledAt' | 'scheduledTimezone' | 'occurrenceKey' | 'matcherRevision' | 'actionIndex' | 'runId'>,
  ): Promise<void> {
    const entry: RetryQueueEntry = {
      id: `${matcherId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      matcherId,
      action,
      expandedUrl,
      deferredAttempt: 0,
      nextRetryAt: Date.now() + DEFERRED_DELAYS_MS[0]!,
      createdAt: Date.now(),
      lastError,
      ...schedule,
    };

    await this.withQueueLock(async () => {
      const queuePath = join(this.workspaceRootPath, AUTOMATIONS_RETRY_QUEUE_FILE);
      await appendFile(queuePath, JSON.stringify(entry) + '\n', 'utf-8');
    });
    log.debug(`[RetryScheduler] Enqueued ${entry.id} — next retry in ${DEFERRED_DELAYS_MS[0]! / 60_000}m`);
  }


  async tick(): Promise<void> {
    if (this.processing || this.stopped) return;
    this.processing = true;
    const generation = this.generation;

    try {
      const snapshot = await this.withQueueLock(() => this.readEntries());
      if (snapshot.length === 0 && this.pendingAcks.size === 0) return;
      if (this.isStale(generation)) return;

      const now = Date.now();

      for (const entry of snapshot) {
        if (entry.state === 'terminal_pending') continue;
        if (this.pendingAcks.has(entry.id)) continue;
        if (entry.state === 'in_flight') {
          this.pendingAcks.set(entry.id, {
            kind: 'drop',
            history: {
              matcherId: entry.matcherId,
              ok: false,
              method: entry.action.method,
              url: entry.expandedUrl,
              statusCode: 0,
              durationMs: 0,
              attempts: entry.deferredAttempt + 1,
              scheduledAt: entry.scheduledAt,
              scheduledTimezone: entry.scheduledTimezone,
              occurrenceKey: entry.occurrenceKey,
              matcherRevision: entry.matcherRevision,
              actionIndex: entry.actionIndex,
              runId: entry.runId,
              outcome: 'unknown_external_outcome',
              error: 'The previous request may have reached the endpoint; automatic replay was suppressed.',
            },
          });
          continue;
        }
        if (entry.nextRetryAt > now) continue;
        if (this.isStale(generation)) return;
        if (!(await this.markInFlight(entry.id))) continue;

        log.debug(`[RetryScheduler] Retrying ${entry.id} (deferred attempt ${entry.deferredAttempt + 1}/${MAX_DEFERRED_ATTEMPTS})`);
        let result: WebhookActionResult;
        try {
          result = await this.executeRequest(entry.action, {
            timeoutMs: 30_000,
            signal: this.requestAbort?.signal,
          });
        } catch (err) {
          result = {
            type: 'webhook',
            url: entry.expandedUrl,
            statusCode: 0,
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          };
        }

        if (this.isStale(generation)) return;

        const outcome = this.outcomeFor(entry, result);
        this.pendingAcks.set(entry.id, outcome);
      }

      if (this.isStale(generation)) return;
      if (this.pendingAcks.size === 0 && !snapshot.some(entry => entry.state === 'terminal_pending')) return;

      await this.withQueueLock(async () => {
        if (this.isStale(generation)) return;
        await this.beforeAck?.();
        if (this.isStale(generation)) return;
        const current = await this.readEntries();
        const staged: RetryQueueEntry[] = current.map(entry => {
          const outcome = this.pendingAcks.get(entry.id);
          if (!outcome) return entry;
          if (outcome.kind === 'keep') return outcome.entry;
          return { ...entry, state: 'terminal_pending', terminalHistory: {
            ...createWebhookHistoryEntry(outcome.history),
            retryHistoryKey: JSON.stringify([entry.id, entry.deferredAttempt]),
          } };
        });
        await this.writeEntriesAtomic(staged);
        this.pendingAcks.clear();
        await this.afterTerminalPersist?.();
        if (this.isStale(generation)) return;
        for (const entry of staged) {
          if (entry.state !== 'terminal_pending') continue;
          if (!entry.terminalHistory || entry.terminalHistory.retryHistoryKey !== JSON.stringify([entry.id, entry.deferredAttempt])) throw new Error('Invalid terminal retry history');
          await appendAutomationHistoryEntryExact(this.workspaceRootPath, entry.terminalHistory);
          await this.afterHistoryPersist?.();
          if (this.isStale(generation)) return;
        }
        await this.writeEntriesAtomic(staged.filter(entry => entry.state !== 'terminal_pending'));
      });
    } catch (err) {
      log.debug(`[RetryScheduler] Tick error: ${err}`);
    } finally {
      this.processing = false;
    }
  }

  private outcomeFor(entry: RetryQueueEntry, result: WebhookActionResult): QueueOutcome {
    const historyMetadata = {
      scheduledAt: entry.scheduledAt,
      scheduledTimezone: entry.scheduledTimezone,
      occurrenceKey: entry.occurrenceKey,
      matcherRevision: entry.matcherRevision,
      actionIndex: entry.actionIndex,
      runId: entry.runId,
    };
    if (entry.occurrenceKey && result.statusCode === 0) {
      return {
        kind: 'drop',
        history: {
          matcherId: entry.matcherId,
          ok: false,
          method: entry.action.method,
          url: entry.expandedUrl,
          statusCode: 0,
          durationMs: result.durationMs ?? 0,
          attempts: entry.deferredAttempt + 1,
          ...historyMetadata,
          outcome: 'unknown_external_outcome',
          error: result.error ?? 'The retry outcome is unknown; automatic replay was suppressed.',
        },
      };
    }
    if (result.success) {
      return {
        kind: 'drop',
        history: {
          matcherId: entry.matcherId,
          ok: true,
          method: entry.action.method,
          url: entry.expandedUrl,
          statusCode: result.statusCode,
          durationMs: result.durationMs ?? 0,
          attempts: entry.deferredAttempt + 1,
          ...historyMetadata,
        },
      };
    }
    if (entry.deferredAttempt + 1 >= MAX_DEFERRED_ATTEMPTS) {
      return {
        kind: 'drop',
        history: {
          matcherId: entry.matcherId,
          ok: false,
          method: entry.action.method,
          url: entry.expandedUrl,
          statusCode: result.statusCode,
          durationMs: result.durationMs ?? 0,
          attempts: entry.deferredAttempt + 1,
          ...historyMetadata,
          error: result.error ?? 'Unknown error',
        },
      };
    }
    const nextDelay = DEFERRED_DELAYS_MS[entry.deferredAttempt + 1]!;
    return {
      kind: 'keep',
      entry: {
        ...entry,
        state: 'ready',
        deferredAttempt: entry.deferredAttempt + 1,
        nextRetryAt: Date.now() + nextDelay,
        lastError: result.error,
      },
    };
  }

  private async markInFlight(id: string): Promise<boolean> {
    return this.withQueueLock(async () => {
      const entries = await this.readEntries();
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0 || entries[index]!.state === 'in_flight') return false;
      entries[index] = { ...entries[index]!, state: 'in_flight' };
      await this.writeEntriesAtomic(entries);
      return true;
    });
  }

  private isStale(generation: number): boolean {
    return this.stopped || generation !== this.generation;
  }

  private withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queueLock.then(fn, fn);
    this.queueLock = run.then(() => undefined, () => undefined);
    return run;
  }

  private queuePath(): string {
    return join(this.workspaceRootPath, AUTOMATIONS_RETRY_QUEUE_FILE);
  }

  private async readEntries(): Promise<RetryQueueEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.queuePath(), 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const lines = raw.trim().split('\n').filter(Boolean);
    const entries: RetryQueueEntry[] = [];
    for (const line of lines) {
      entries.push(JSON.parse(line) as RetryQueueEntry);
    }
    return entries;
  }

  private async writeEntriesAtomic(entries: RetryQueueEntry[]): Promise<void> {
    const queuePath = this.queuePath();
    const content = entries.length === 0
      ? ''
      : entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    const tmpPath = `${queuePath}.${process.pid}.${this.generation}.tmp`;
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, queuePath);
  }
}
