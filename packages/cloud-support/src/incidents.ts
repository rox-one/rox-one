/**
 * Incident status page for Rox Cloud.
 *
 * An incident is opened once, moves forward through `investigating`,
 * `identified`, `monitoring` and `resolved`, and stops there: reopening a
 * closed incident would rewrite history, so a new incident is opened instead.
 * Every change appends a timeline entry with the note staff published.
 *
 * `publicView()` is the only thing the status page may show — title, public
 * summary, severity, status and the last update. Scopes, timeline and ids stay
 * internal because a region or a product can point at a single customer.
 */

import { randomUUID } from 'node:crypto';
import { SupportError, assertNoSecrets, requireText } from './types.ts';
import type {
  Incident,
  IncidentScope,
  IncidentSeverity,
  IncidentStatus,
  IncidentTimelineEntry,
  PublicIncident,
} from './types.ts';

/** The only order an incident may move in; a lower number is never reachable again. */
export const INCIDENT_STATUS_ORDER: Record<IncidentStatus, number> = {
  investigating: 0,
  identified: 1,
  monitoring: 2,
  resolved: 3,
};

const SEVERITIES: readonly IncidentSeverity[] = ['minor', 'major', 'critical'];
const SCOPE_FIELDS: readonly (keyof IncidentScope)[] = ['provider', 'region', 'product'];

export interface CreateIncidentStoreOptions {
  /** Injectable clock so timestamps stay testable. */
  now?: () => Date;
}

/** What staff submit to open an incident. */
export interface OpenIncidentInput {
  title: string;
  publicSummary: string;
  severity: IncidentSeverity;
  /** Absent or empty means the whole platform. */
  scopes: IncidentScope[];
}

/** What staff submit to move an incident one step forward. */
export interface IncidentUpdateInput {
  status: IncidentStatus;
  /** Published with the new status on the timeline; an empty note is rejected. */
  note: string;
}

export interface IncidentStore {
  /** Stored incidents in creation order as copies, for diagnostics and tests. */
  readonly incidents: readonly Incident[];
  /** Open an incident in `investigating` with the first timeline entry. */
  open(input: OpenIncidentInput): Incident;
  /** Move forward, or add a note at the current status; a closed incident is frozen. */
  update(id: string, input: IncidentUpdateInput): Incident;
  /** Close an incident from any open status. */
  resolve(id: string, note: string): Incident;
  /** Everything the public status page may show, newest first. */
  publicView(): PublicIncident[];
  /** Every incident as staff see it, newest first. */
  list(): Incident[];
}

function normalizeScopes(scopes: readonly IncidentScope[]): IncidentScope[] {
  if (!Array.isArray(scopes)) {
    throw new SupportError('invalid_input', 'Область инцидента должна быть списком');
  }
  const out: IncidentScope[] = [];
  for (let index = 0; index < scopes.length; index += 1) {
    const raw: unknown = scopes[index];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new SupportError('invalid_input', `Область инцидента ${index} должна быть объектом`);
    }
    const scope = raw as IncidentScope;
    for (const key of Object.keys(scope)) {
      if (!SCOPE_FIELDS.includes(key as keyof IncidentScope)) {
        throw new SupportError('invalid_input', `Неизвестное поле области инцидента: ${key}`);
      }
    }
    const normalized: IncidentScope = {};
    let fields = 0;
    if (scope.provider !== undefined) {
      normalized.provider = requireText(scope.provider, `scopes[${index}].provider`);
      fields += 1;
    }
    if (scope.region !== undefined) {
      normalized.region = requireText(scope.region, `scopes[${index}].region`);
      fields += 1;
    }
    if (scope.product !== undefined) {
      normalized.product = requireText(scope.product, `scopes[${index}].product`);
      fields += 1;
    }
    if (fields === 0) {
      throw new SupportError('invalid_input', `Область инцидента ${index} не содержит ни одного поля`);
    }
    out.push(normalized);
  }
  return out;
}

function cloneIncident(incident: Incident): Incident {
  return {
    ...incident,
    scopes: incident.scopes.map((scope) => ({ ...scope })),
    timeline: incident.timeline.map((entry) => ({ ...entry })),
  };
}

export function createIncidentStore(options: CreateIncidentStoreOptions = {}): IncidentStore {
  const now = options.now ?? (() => new Date());
  const stored: Incident[] = [];

  function find(id: string): Incident {
    const incident = stored.find((item) => item.id === id);
    if (!incident) {
      throw new SupportError('not_found', 'Инцидент не найден');
    }
    return incident;
  }

  function pushEntry(incident: Incident, status: IncidentStatus, note: string, at: string): void {
    const entry: IncidentTimelineEntry = { id: `tl_${randomUUID()}`, status, note, at };
    incident.timeline.push(entry);
  }

  function open(input: OpenIncidentInput): Incident {
    const title = requireText(input.title, 'title');
    const publicSummary = requireText(input.publicSummary, 'publicSummary');
    if (!SEVERITIES.includes(input.severity)) {
      throw new SupportError('invalid_input', `Неизвестная важность инцидента: ${String(input.severity)}`);
    }
    assertNoSecrets(title, 'title', 'secret_in_record');
    assertNoSecrets(publicSummary, 'publicSummary', 'secret_in_record');
    const scopes = normalizeScopes(input.scopes);
    const at = now().toISOString();
    const incident: Incident = {
      id: `inc_${randomUUID()}`,
      title,
      publicSummary,
      severity: input.severity,
      status: 'investigating',
      scopes,
      createdAt: at,
      updatedAt: at,
      timeline: [],
    };
    pushEntry(incident, 'investigating', publicSummary, at);
    stored.push(incident);
    return cloneIncident(incident);
  }

  function update(id: string, input: IncidentUpdateInput): Incident {
    const incident = find(id);
    if (incident.status === 'resolved') {
      throw new SupportError('invalid_state', 'Инцидент уже закрыт: откройте новый');
    }
    const status = input.status;
    if (!Object.hasOwn(INCIDENT_STATUS_ORDER, status)) {
      throw new SupportError('invalid_input', `Неизвестный статус инцидента: ${String(status)}`);
    }
    if (INCIDENT_STATUS_ORDER[status] < INCIDENT_STATUS_ORDER[incident.status]) {
      throw new SupportError('invalid_state', 'Статус инцидента может меняться только вперёд');
    }
    const note = requireText(input.note, 'note');
    assertNoSecrets(note, 'note', 'secret_in_record');
    const at = now().toISOString();
    incident.status = status;
    incident.updatedAt = at;
    pushEntry(incident, status, note, at);
    return cloneIncident(incident);
  }

  function resolve(id: string, note: string): Incident {
    const incident = find(id);
    if (incident.status === 'resolved') {
      throw new SupportError('invalid_state', 'Инцидент уже закрыт');
    }
    const text = requireText(note, 'note');
    assertNoSecrets(text, 'note', 'secret_in_record');
    const at = now().toISOString();
    incident.status = 'resolved';
    incident.updatedAt = at;
    pushEntry(incident, 'resolved', text, at);
    return cloneIncident(incident);
  }

  function publicView(): PublicIncident[] {
    const view: PublicIncident[] = [];
    for (let index = stored.length - 1; index >= 0; index -= 1) {
      const incident = stored[index]!;
      view.push({
        title: incident.title,
        publicSummary: incident.publicSummary,
        severity: incident.severity,
        status: incident.status,
        updatedAt: incident.updatedAt,
      });
    }
    return view;
  }

  function list(): Incident[] {
    return stored.map(cloneIncident).reverse();
  }

  return {
    get incidents(): readonly Incident[] {
      return stored.map(cloneIncident);
    },
    open,
    update,
    resolve,
    publicView,
    list,
  };
}
