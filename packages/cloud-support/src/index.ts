/**
 * Public surface of the Rox Cloud support cores.
 *
 * Nothing here reaches the network or a database: every store is in-memory,
 * dependency-free and takes an injectable clock, so the API layer can own the
 * storage and keep the rules.
 */

export { SupportError, findForbiddenField, findSecretMarker } from './types.ts';
export type {
  AbuseDecision,
  AbuseEvidence,
  AbuseFlag,
  AbuseFlagState,
  AbuseThresholds,
  Incident,
  IncidentScope,
  IncidentSeverity,
  IncidentStatus,
  IncidentTimelineEntry,
  MessageBody,
  PublicIncident,
  SupportErrorCode,
  Ticket,
  TicketAuthorRole,
  TicketMessage,
  TicketPriority,
  TicketStatus,
  UsageSample,
} from './types.ts';

export { SUBJECT_MAX_LENGTH, SUBJECT_MIN_LENGTH, createTicketStore } from './tickets.ts';
export type {
  CreateTicketStoreOptions,
  OpenTicketInput,
  ReplyInput,
  TicketFilter,
  TicketStore,
} from './tickets.ts';

export { INCIDENT_STATUS_ORDER, createIncidentStore } from './incidents.ts';
export type {
  CreateIncidentStoreOptions,
  IncidentStore,
  IncidentUpdateInput,
  OpenIncidentInput,
} from './incidents.ts';

export { createAbuseQueue, evaluateSample } from './abuse.ts';
export type { AbuseFlagFilter, AbuseQueue, CreateAbuseQueueOptions } from './abuse.ts';
