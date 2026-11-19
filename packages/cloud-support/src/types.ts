/**
 * Rox Cloud — customer support primitives.
 *
 * Three surfaces share these shapes: the ticket store (`tickets.ts`), the
 * incident status page (`incidents.ts`) and the abuse queue (`abuse.ts`).
 * Every writer of a stored record keeps one rule — a secret, a token or a
 * provider key never enters a ticket, an incident or an abuse record — so the
 * guards that enforce it live here next to the rejection type they throw.
 *
 * `SupportError` is the single rejection type; `code` is what callers branch on.
 */

/** Stable machine-readable reasons a support call is rejected. */
export type SupportErrorCode =
  | 'invalid_input'
  | 'secret_in_ticket'
  | 'secret_in_record'
  | 'not_found'
  | 'invalid_state';

/** Rejection from the support cores; `code` is what callers branch on. */
export class SupportError extends Error {
  readonly code: SupportErrorCode;

  constructor(code: SupportErrorCode, message: string) {
    super(message);
    this.name = 'SupportError';
    this.code = code;
  }
}

// ============================================================
// Tickets
// ============================================================

/** Where a ticket waits: on staff (`open`), on the customer (`pending`) or nowhere (`resolved`). */
export type TicketStatus = 'open' | 'pending' | 'resolved';

/** How fast staff should look at a ticket. */
export type TicketPriority = 'low' | 'normal' | 'high';

/** Who wrote one message of a thread. */
export type TicketAuthorRole = 'customer' | 'staff';

/**
 * What a caller may submit as a message.
 *
 * Plain text is stored as written; a structured body is walked to any depth,
 * rejected on a forbidden field name, and stored as JSON text so a stored
 * ticket never holds live caller objects.
 */
export type MessageBody = string | Record<string, unknown>;

/** One message in a ticket thread. `body` is always text once stored. */
export interface TicketMessage {
  id: string;
  authorRole: TicketAuthorRole;
  /** Tenant id for a customer message, staff id for a staff message. */
  authorId: string;
  body: string;
  /** ISO-8601 instant the message was written. */
  createdAt: string;
}

/** One support thread as staff and the customer see it. */
export interface Ticket {
  id: string;
  tenantId: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  /** ISO-8601 instant the ticket was opened. */
  createdAt: string;
  /** ISO-8601 instant of the last change, message or resolution. */
  updatedAt: string;
  messages: TicketMessage[];
}

// ============================================================
// Incidents
// ============================================================

/** How much of the platform an incident affects. */
export type IncidentSeverity = 'minor' | 'major' | 'critical';

/** Where an incident stands; only ever moves forward. */
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

/**
 * Which providers, regions or products an incident touches. Every field left
 * out is wildcard, and an empty scope list means the whole platform.
 */
export interface IncidentScope {
  provider?: string;
  region?: string;
  product?: string;
}

/** One status change with the note staff published for it. */
export interface IncidentTimelineEntry {
  id: string;
  status: IncidentStatus;
  /** Free-text note; never secret material. */
  note: string;
  /** ISO-8601 instant of the change. */
  at: string;
}

/** One incident as staff see it, timeline included. */
export interface Incident {
  id: string;
  title: string;
  /** The only long text the status page shows. */
  publicSummary: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  scopes: IncidentScope[];
  /** ISO-8601 instant the incident was opened. */
  createdAt: string;
  /** ISO-8601 instant of the last status change. */
  updatedAt: string;
  timeline: IncidentTimelineEntry[];
}

/**
 * What the public status page may show. Deliberately narrow: no id, no scopes,
 * no timeline and no tenant data — scopes name regions and products that can
 * point at one customer.
 */
export interface PublicIncident {
  title: string;
  publicSummary: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  updatedAt: string;
}

// ============================================================
// Abuse
// ============================================================

/** One metered observation of one sandbox. */
export interface UsageSample {
  tenantId: string;
  sandboxId: string;
  /** ISO-8601 instant the sample was taken. */
  at: string;
  /** Processor load in percent. */
  cpuPct: number;
  /** Outbound bytes per minute. */
  egressBytesPerMin: number;
  /** Simultaneously open outbound connections. */
  outboundConnections: number;
}

/** The per-sample ceilings a tenant's sandbox is held to. */
export interface AbuseThresholds {
  cpuPct: number;
  egressBytesPerMin: number;
  outboundConnections: number;
}

/**
 * What the queue decides about one sample.
 *
 * `throttle` is the tier a caller may apply between `warn` and `stop`;
 * `evaluateSample` never emits it because a sample either warns or stops.
 */
export type AbuseDecision = 'none' | 'warn' | 'throttle' | 'stop';

/** Numbers behind a flag and nothing else — no payloads, no ids, no text. */
export interface AbuseEvidence {
  cpuPct: number;
  egressBytesPerMin: number;
  outboundConnections: number;
  thresholds: AbuseThresholds;
  /** CPU percentage of the previous sample of the same sandbox, when one exists. */
  previousCpuPct?: number;
}

/** Whether staff have looked at a flag yet. */
export type AbuseFlagState = 'open' | 'dismissed' | 'confirmed';

/** One row of the abuse queue. */
export interface AbuseFlag {
  id: string;
  tenantId: string;
  sandboxId: string;
  /** ISO-8601 instant of the sample that raised the flag. */
  at: string;
  decision: AbuseDecision;
  reason: string;
  evidence: AbuseEvidence;
  state: AbuseFlagState;
  /** Why staff dismissed the flag; kept so the decision can be reviewed. */
  dismissedReason?: string;
  /** Staff member who confirmed the flag. */
  confirmedBy?: string;
  /** ISO-8601 instant of the dismiss or confirm. */
  decidedAt?: string;
}

// ============================================================
// Shared guards
// ============================================================

/** Field names that must never appear in a ticket, an incident or an abuse record. */
const FORBIDDEN_FIELD_NAMES: Record<string, true> = {
  secret: true,
  token: true,
  password: true,
  key: true,
};

/**
 * Shapes that identify a provider key or a private key inside free text.
 *
 * `sk-` only counts when it does not continue a word, so ordinary text such as
 * `task-list` or `risk-free` is not mistaken for a key. Everything else is
 * matched case-insensitively because auth schemes are case-insensitive.
 */
const SECRET_MARKERS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'sk-', pattern: /(?<![A-Za-z0-9])sk-/i },
  { label: 'rox_sk_', pattern: /rox_sk_/i },
  { label: 'Bearer ', pattern: /bearer /i },
  { label: 'BEGIN PRIVATE KEY', pattern: /begin private key/i },
];

/** Path of the first forbidden field name in `value`, or null when clean. */
export function findForbiddenField(value: unknown, path = 'body'): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const hit = findForbiddenField(value[index], `${path}[${index}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_FIELD_NAMES[key.trim().toLowerCase()] === true) {
        return `${path}.${key}`;
      }
      const hit = findForbiddenField(item, `${path}.${key}`);
      if (hit) return hit;
    }
  }
  return null;
}

/** Path and marker of the first key-like string in `value`, or null when clean. */
export function findSecretMarker(value: unknown, path = 'body'): string | null {
  if (typeof value === 'string') {
    for (const marker of SECRET_MARKERS) {
      if (marker.pattern.test(value)) return `${path} (${marker.label})`;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const hit = findSecretMarker(value[index], `${path}[${index}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const hit = findSecretMarker(item, `${path}.${key}`);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Reject a value that carries a forbidden field name or a key marker anywhere.
 *
 * `code` picks the caller's vocabulary: `secret_in_ticket` for customer input,
 * `secret_in_record` for everything staff writes.
 */
export function assertNoSecrets(
  value: unknown,
  path: string,
  code: 'secret_in_ticket' | 'secret_in_record',
): void {
  const field = findForbiddenField(value, path);
  if (field) {
    throw new SupportError(code, `Нельзя хранить секреты: поле ${field}`);
  }
  const marker = findSecretMarker(value, path);
  if (marker) {
    throw new SupportError(code, `В тексте найден признак ключа: ${marker}`);
  }
}

/** Trimmed text of a required field; an empty or non-string value is rejected. */
export function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SupportError('invalid_input', `Поле ${field} не может быть пустым`);
  }
  return value.trim();
}
