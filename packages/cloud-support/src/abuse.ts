/**
 * Abuse queue for Rox Cloud.
 *
 * A metered sample of a tenant's sandbox is compared with the tenant's
 * thresholds. One sample above the processor ceiling warns; two samples in a
 * row above it stop the sandbox, because a single spike can be a normal build
 * while a sustained one cannot. Egress or outbound connections above the
 * ceiling stop immediately — that is the shape of data theft, not of a build.
 *
 * Every sample becomes one queue row. The evidence holds numbers and nothing
 * else: no payload, no request body, no customer text can be copied into a
 * record staff read later.
 */

import { randomUUID } from 'node:crypto';
import { SupportError, assertNoSecrets, requireText } from './types.ts';
import type {
  AbuseDecision,
  AbuseEvidence,
  AbuseFlag,
  AbuseThresholds,
  UsageSample,
} from './types.ts';

export interface CreateAbuseQueueOptions {
  /** Injectable clock so the dismiss and confirm times stay testable. */
  now?: () => Date;
}

/** Which rows `list` returns. */
export interface AbuseFlagFilter {
  tenantId?: string;
  decision?: AbuseDecision;
}

export interface AbuseQueue {
  /** Stored rows in recording order as copies, for diagnostics and tests. */
  readonly flags: readonly AbuseFlag[];
  /** Evaluate one sample against the thresholds and store the resulting row. */
  record(sample: UsageSample, thresholds: AbuseThresholds): AbuseFlag;
  /** Matching rows, newest first. */
  list(filter?: AbuseFlagFilter): AbuseFlag[];
  /** Clear a row as a false alarm; a staff reason is required. */
  dismiss(id: string, reason: string): AbuseFlag;
  /** Agree that the row is abuse; the caller then stops the sandbox. */
  confirm(id: string, staffId: string): AbuseFlag;
}

const DECISIONS: readonly AbuseDecision[] = ['none', 'warn', 'throttle', 'stop'];

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new SupportError('invalid_input', `Поле ${field} должно быть неотрицательным числом`);
  }
  return value;
}

function normalizeThresholds(input: unknown): AbuseThresholds {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new SupportError('invalid_input', 'Пороги должны быть объектом');
  }
  const thresholds = input as Partial<AbuseThresholds>;
  return {
    cpuPct: requireNumber(thresholds.cpuPct, 'thresholds.cpuPct'),
    egressBytesPerMin: requireNumber(thresholds.egressBytesPerMin, 'thresholds.egressBytesPerMin'),
    outboundConnections: requireNumber(thresholds.outboundConnections, 'thresholds.outboundConnections'),
  };
}

function normalizeSample(input: unknown): UsageSample {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new SupportError('invalid_input', 'Замер должен быть объектом');
  }
  const sample = input as Partial<UsageSample>;
  if (typeof sample.at !== 'string' || Number.isNaN(Date.parse(sample.at))) {
    throw new SupportError('invalid_input', 'Поле at должно быть датой ISO-8601');
  }
  return {
    tenantId: requireText(sample.tenantId, 'tenantId'),
    sandboxId: requireText(sample.sandboxId, 'sandboxId'),
    at: sample.at.trim(),
    cpuPct: requireNumber(sample.cpuPct, 'cpuPct'),
    egressBytesPerMin: requireNumber(sample.egressBytesPerMin, 'egressBytesPerMin'),
    outboundConnections: requireNumber(sample.outboundConnections, 'outboundConnections'),
  };
}

/**
 * The newest earlier sample of the same sandbox, or null.
 *
 * `history` is expected oldest first and without the sample being evaluated;
 * an entry stamped later than the current sample is skipped so clock skew
 * cannot make a future sample decide the present one.
 */
function findPreviousSample(current: UsageSample, history: readonly UsageSample[]): UsageSample | null {
  const currentAt = Date.parse(current.at);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const candidate = history[index]!;
    if (candidate === current) continue;
    if (candidate.tenantId !== current.tenantId || candidate.sandboxId !== current.sandboxId) continue;
    const candidateAt = Date.parse(candidate.at);
    if (Number.isNaN(candidateAt) || candidateAt > currentAt) continue;
    return candidate;
  }
  return null;
}

interface Assessment {
  decision: AbuseDecision;
  reason: string;
}

function assess(sample: UsageSample, limits: AbuseThresholds, previous: UsageSample | null): Assessment {
  const cpuHigh = sample.cpuPct > limits.cpuPct;
  const cpuRepeat = cpuHigh && previous !== null && previous.cpuPct > limits.cpuPct;
  const egressHigh = sample.egressBytesPerMin > limits.egressBytesPerMin;
  const connectionsHigh = sample.outboundConnections > limits.outboundConnections;

  const breaches: string[] = [];
  if (egressHigh) breaches.push('исходящий трафик выше порога');
  if (connectionsHigh) breaches.push('исходящие соединения выше порога');
  if (cpuHigh) {
    breaches.push(cpuRepeat ? 'процессор выше порога два замера подряд' : 'процессор выше порога');
  }

  const stop = egressHigh || connectionsHigh || cpuRepeat;
  const decision: AbuseDecision = stop ? 'stop' : cpuHigh ? 'warn' : 'none';
  const reason = breaches.length === 0 ? 'Нарушений нет' : `Нарушено: ${breaches.join(', ')}`;
  return { decision, reason };
}

function cloneFlag(flag: AbuseFlag): AbuseFlag {
  return { ...flag, evidence: { ...flag.evidence, thresholds: { ...flag.evidence.thresholds } } };
}

/**
 * Decide what one sample calls for, given the samples recorded before it.
 *
 * Order of severity: egress and outbound connections stop at once, a second
 * CPU sample in a row stops, a single CPU sample warns, everything else is
 * `none`. A value exactly at a threshold is inside the ceiling.
 */
export function evaluateSample(
  sample: UsageSample,
  thresholds: AbuseThresholds,
  history: readonly UsageSample[] = [],
): AbuseDecision {
  const current = normalizeSample(sample);
  const limits = normalizeThresholds(thresholds);
  return assess(current, limits, findPreviousSample(current, history)).decision;
}

export function createAbuseQueue(options: CreateAbuseQueueOptions = {}): AbuseQueue {
  const now = options.now ?? (() => new Date());
  const rows: AbuseFlag[] = [];
  const samples: UsageSample[] = [];

  function findFlag(id: string): AbuseFlag {
    const flag = rows.find((item) => item.id === id);
    if (!flag) {
      throw new SupportError('not_found', 'Запись очереди не найдена');
    }
    return flag;
  }

  function record(sample: UsageSample, thresholds: AbuseThresholds): AbuseFlag {
    const current = normalizeSample(sample);
    const limits = normalizeThresholds(thresholds);
    const previous = findPreviousSample(current, samples);
    const verdict = assess(current, limits, previous);
    const evidence: AbuseEvidence = {
      cpuPct: current.cpuPct,
      egressBytesPerMin: current.egressBytesPerMin,
      outboundConnections: current.outboundConnections,
      thresholds: { ...limits },
    };
    if (previous !== null) evidence.previousCpuPct = previous.cpuPct;
    const flag: AbuseFlag = {
      id: `flag_${randomUUID()}`,
      tenantId: current.tenantId,
      sandboxId: current.sandboxId,
      at: current.at,
      decision: verdict.decision,
      reason: verdict.reason,
      evidence,
      state: 'open',
    };
    rows.push(flag);
    samples.push(current);
    return cloneFlag(flag);
  }

  function list(filter: AbuseFlagFilter = {}): AbuseFlag[] {
    if (filter.decision !== undefined && !DECISIONS.includes(filter.decision)) {
      throw new SupportError('invalid_input', `Неизвестное решение: ${String(filter.decision)}`);
    }
    const matched: AbuseFlag[] = [];
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const flag = rows[index]!;
      if (filter.tenantId !== undefined && flag.tenantId !== filter.tenantId) continue;
      if (filter.decision !== undefined && flag.decision !== filter.decision) continue;
      matched.push(cloneFlag(flag));
    }
    return matched;
  }

  function dismiss(id: string, reason: string): AbuseFlag {
    const flag = findFlag(id);
    if (flag.state !== 'open') {
      throw new SupportError('invalid_state', 'Запись очереди уже разобрана');
    }
    const text = requireText(reason, 'reason');
    assertNoSecrets(text, 'reason', 'secret_in_record');
    flag.state = 'dismissed';
    flag.dismissedReason = text;
    flag.decidedAt = now().toISOString();
    return cloneFlag(flag);
  }

  function confirm(id: string, staffId: string): AbuseFlag {
    const flag = findFlag(id);
    if (flag.state !== 'open') {
      throw new SupportError('invalid_state', 'Запись очереди уже разобрана');
    }
    if (flag.decision === 'none') {
      throw new SupportError('invalid_state', 'В замере нет нарушения, подтверждать нечего');
    }
    const staff = requireText(staffId, 'staffId');
    flag.state = 'confirmed';
    flag.confirmedBy = staff;
    flag.decidedAt = now().toISOString();
    return cloneFlag(flag);
  }

  return {
    get flags(): readonly AbuseFlag[] {
      return rows.map(cloneFlag);
    },
    record,
    list,
    dismiss,
    confirm,
  };
}
