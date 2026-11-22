/**
 * Russian words and badge tones for the staff panel's states.
 *
 * The API speaks in codes (`running`, `resolved`, `throttle`); a staff member
 * reads words. An unknown code is printed as it came, so a new server state is
 * never hidden behind a wrong translation.
 */
import type { BadgeTone } from '@/components'
import type {
  AbuseDecision,
  AbuseFlagState,
  IncidentSeverity,
  IncidentStatus,
  TicketPriority,
  TicketStatus,
} from '@/lib/api'

export interface Labelled {
  label: string
  tone: BadgeTone
}

function lookup<T extends string>(map: Record<T, Labelled>, key: string): Labelled | undefined {
  return (map as Record<string, Labelled>)[key]
}

const ticketStatuses: Record<TicketStatus, Labelled> = {
  open: { label: 'ждёт дежурного', tone: 'warning' },
  pending: { label: 'ждёт клиента', tone: 'accent' },
  resolved: { label: 'закрыто', tone: 'success' },
}

const ticketPriorities: Record<TicketPriority, Labelled> = {
  low: { label: 'низкий', tone: 'neutral' },
  normal: { label: 'обычный', tone: 'neutral' },
  high: { label: 'высокий', tone: 'danger' },
}

const incidentSeverities: Record<IncidentSeverity, Labelled> = {
  minor: { label: 'небольшое', tone: 'neutral' },
  major: { label: 'серьёзное', tone: 'warning' },
  critical: { label: 'критическое', tone: 'danger' },
}

const incidentStatuses: Record<IncidentStatus, Labelled> = {
  investigating: { label: 'разбираемся', tone: 'danger' },
  identified: { label: 'причина найдена', tone: 'warning' },
  monitoring: { label: 'наблюдаем', tone: 'accent' },
  resolved: { label: 'закрыто', tone: 'success' },
}

const abuseDecisions: Record<AbuseDecision, Labelled> = {
  none: { label: 'без мер', tone: 'neutral' },
  warn: { label: 'предупреждение', tone: 'warning' },
  throttle: { label: 'ограничение', tone: 'warning' },
  stop: { label: 'остановка', tone: 'danger' },
}

const abuseStates: Record<AbuseFlagState, Labelled> = {
  open: { label: 'открыто', tone: 'warning' },
  dismissed: { label: 'отклонено', tone: 'neutral' },
  confirmed: { label: 'подтверждено', tone: 'danger' },
}

const killStates: Record<'pending' | 'active' | 'disabled', Labelled> = {
  pending: { label: 'ждёт подтверждения', tone: 'warning' },
  active: { label: 'действует', tone: 'danger' },
  disabled: { label: 'снят', tone: 'neutral' },
}

export function ticketStatusInfo(status: string): Labelled {
  return lookup(ticketStatuses, status) ?? { label: status, tone: 'neutral' }
}

export function ticketPriorityInfo(priority: string): Labelled {
  return lookup(ticketPriorities, priority) ?? { label: priority, tone: 'neutral' }
}

export function incidentSeverityInfo(severity: string): Labelled {
  return lookup(incidentSeverities, severity) ?? { label: severity, tone: 'neutral' }
}

export function incidentStatusInfo(status: string): Labelled {
  return lookup(incidentStatuses, status) ?? { label: status, tone: 'neutral' }
}

export function abuseDecisionInfo(decision: string): Labelled {
  return lookup(abuseDecisions, decision) ?? { label: decision, tone: 'neutral' }
}

export function abuseStateInfo(state: string): Labelled {
  return lookup(abuseStates, state) ?? { label: state, tone: 'neutral' }
}

export function killStateInfo(state: string): Labelled {
  return lookup(killStates, state) ?? { label: state, tone: 'neutral' }
}

/** HTTP status as a tone: success, neutral, warning, danger. */
export function statusTone(status: number): BadgeTone {
  if (status >= 200 && status < 300) return 'success'
  if (status >= 300 && status < 400) return 'neutral'
  if (status >= 400 && status < 500) return 'warning'
  return 'danger'
}
