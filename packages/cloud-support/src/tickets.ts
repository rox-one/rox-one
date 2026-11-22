/**
 * Support tickets for Rox Cloud.
 *
 * A paying customer opens a ticket with a subject and a first message; the
 * thread then alternates between the customer and staff. Status follows the
 * thread: a customer reply means the ball is with staff (`open`), a staff reply
 * means it is back with the customer (`pending`), and `resolved` is terminal —
 * a new problem opens a new ticket.
 *
 * A message body is either plain text or a structured object. Plain text is
 * stored as written after a scan for key markers; an object is walked to any
 * depth, rejected on a field named `secret`, `token`, `password` or `key`, and
 * stored as JSON text so a stored ticket never holds live caller objects.
 */

import { randomUUID } from 'node:crypto';
import { SupportError, assertNoSecrets, requireText } from './types.ts';
import type {
  MessageBody,
  Ticket,
  TicketAuthorRole,
  TicketMessage,
  TicketPriority,
  TicketStatus,
} from './types.ts';

/** Shortest accepted subject, in characters after trimming. */
export const SUBJECT_MIN_LENGTH = 3;

/** Longest accepted subject, in characters after trimming. */
export const SUBJECT_MAX_LENGTH = 120;

const PRIORITIES: readonly TicketPriority[] = ['low', 'normal', 'high'];
const STATUSES: readonly TicketStatus[] = ['open', 'pending', 'resolved'];
const AUTHOR_ROLES: readonly TicketAuthorRole[] = ['customer', 'staff'];

export interface CreateTicketStoreOptions {
  /** Injectable clock so timestamps stay testable. */
  now?: () => Date;
}

/** What a customer submits to open a ticket. */
export interface OpenTicketInput {
  tenantId: string;
  subject: string;
  body: MessageBody;
  /** Defaults to `normal`. */
  priority?: TicketPriority;
}

/** What either side submits as a reply. */
export interface ReplyInput {
  authorRole: TicketAuthorRole;
  /** Tenant id for a customer, staff id for staff. */
  authorId: string;
  body: MessageBody;
}

/** Which tickets `list` returns. */
export interface TicketFilter {
  tenantId?: string;
  status?: TicketStatus;
  /** Keep only the newest N matches; omitted means all of them. */
  limit?: number;
}

export interface TicketStore {
  /** Stored tickets in creation order as copies, for diagnostics and tests. */
  readonly tickets: readonly Ticket[];
  /** Open a ticket; the first message is authored by the tenant. */
  open(input: OpenTicketInput): Ticket;
  /** Append a message and move the status to the side that now has the ball. */
  reply(id: string, input: ReplyInput): Ticket;
  /** Close a ticket; a resolved ticket refuses further replies and resolution. */
  resolve(id: string, authorId: string): Ticket;
  /** Matching tickets, newest first. */
  list(filter?: TicketFilter): Ticket[];
  /** One ticket, or null when the id is unknown. */
  get(id: string): Ticket | null;
}

function requireSubject(value: unknown): string {
  if (typeof value !== 'string') {
    throw new SupportError('invalid_input', 'У запроса должна быть тема');
  }
  const subject = value.trim();
  if (subject.length < SUBJECT_MIN_LENGTH) {
    throw new SupportError('invalid_input', `Тема короче ${SUBJECT_MIN_LENGTH} символов`);
  }
  if (subject.length > SUBJECT_MAX_LENGTH) {
    throw new SupportError('invalid_input', `Тема длиннее ${SUBJECT_MAX_LENGTH} символов`);
  }
  assertNoSecrets(subject, 'subject', 'secret_in_ticket');
  return subject;
}

/** Validate a body and return the text to store. */
function normalizeBody(body: unknown, path: string): string {
  if (typeof body === 'string') {
    const text = body.trim();
    if (!text) {
      throw new SupportError('invalid_input', 'Сообщение не может быть пустым');
    }
    assertNoSecrets(text, path, 'secret_in_ticket');
    return text;
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new SupportError('invalid_input', 'Сообщение должно быть текстом или объектом');
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length === 0) {
    throw new SupportError('invalid_input', 'Сообщение не может быть пустым');
  }
  assertNoSecrets(record, path, 'secret_in_ticket');
  return JSON.stringify(record);
}

function cloneTicket(ticket: Ticket): Ticket {
  return { ...ticket, messages: ticket.messages.map((message) => ({ ...message })) };
}

export function createTicketStore(options: CreateTicketStoreOptions = {}): TicketStore {
  const now = options.now ?? (() => new Date());
  const stored: Ticket[] = [];

  function find(id: string): Ticket {
    const ticket = stored.find((item) => item.id === id);
    if (!ticket) {
      throw new SupportError('not_found', 'Запрос не найден');
    }
    return ticket;
  }

  function open(input: OpenTicketInput): Ticket {
    const tenantId = requireText(input.tenantId, 'tenantId');
    const subject = requireSubject(input.subject);
    const priority = input.priority ?? 'normal';
    if (!PRIORITIES.includes(priority)) {
      throw new SupportError('invalid_input', `Неизвестный приоритет: ${String(priority)}`);
    }
    const body = normalizeBody(input.body, 'body');
    const at = now().toISOString();
    const message: TicketMessage = {
      id: `msg_${randomUUID()}`,
      authorRole: 'customer',
      authorId: tenantId,
      body,
      createdAt: at,
    };
    const ticket: Ticket = {
      id: `tkt_${randomUUID()}`,
      tenantId,
      subject,
      status: 'open',
      priority,
      createdAt: at,
      updatedAt: at,
      messages: [message],
    };
    stored.push(ticket);
    return cloneTicket(ticket);
  }

  function reply(id: string, input: ReplyInput): Ticket {
    const ticket = find(id);
    if (ticket.status === 'resolved') {
      throw new SupportError('invalid_state', 'Закрытый запрос нельзя дополнить: откройте новый');
    }
    if (!AUTHOR_ROLES.includes(input.authorRole)) {
      throw new SupportError('invalid_input', `Неизвестная роль автора: ${String(input.authorRole)}`);
    }
    const authorId = requireText(input.authorId, 'authorId');
    const body = normalizeBody(input.body, 'body');
    const at = now().toISOString();
    ticket.messages.push({
      id: `msg_${randomUUID()}`,
      authorRole: input.authorRole,
      authorId,
      body,
      createdAt: at,
    });
    // The customer writing leaves the ball with staff; staff writing hands it back.
    ticket.status = input.authorRole === 'customer' ? 'open' : 'pending';
    ticket.updatedAt = at;
    return cloneTicket(ticket);
  }

  function resolve(id: string, authorId: string): Ticket {
    const ticket = find(id);
    if (ticket.status === 'resolved') {
      throw new SupportError('invalid_state', 'Запрос уже закрыт');
    }
    requireText(authorId, 'authorId');
    const at = now().toISOString();
    ticket.status = 'resolved';
    ticket.updatedAt = at;
    return cloneTicket(ticket);
  }

  function list(filter: TicketFilter = {}): Ticket[] {
    if (filter.status !== undefined && !STATUSES.includes(filter.status)) {
      throw new SupportError('invalid_input', `Неизвестный статус запроса: ${String(filter.status)}`);
    }
    let limit = Number.POSITIVE_INFINITY;
    if (filter.limit !== undefined) {
      if (!Number.isFinite(filter.limit)) {
        throw new SupportError('invalid_input', 'Ограничение выборки должно быть числом');
      }
      limit = Math.floor(filter.limit);
      if (limit <= 0) return [];
    }
    const matched: Ticket[] = [];
    for (let index = stored.length - 1; index >= 0; index -= 1) {
      const ticket = stored[index]!;
      if (filter.tenantId !== undefined && ticket.tenantId !== filter.tenantId) continue;
      if (filter.status !== undefined && ticket.status !== filter.status) continue;
      matched.push(cloneTicket(ticket));
      if (matched.length >= limit) break;
    }
    return matched;
  }

  function get(id: string): Ticket | null {
    const ticket = stored.find((item) => item.id === id);
    return ticket ? cloneTicket(ticket) : null;
  }

  return {
    get tickets(): readonly Ticket[] {
      return stored.map(cloneTicket);
    },
    open,
    reply,
    resolve,
    list,
    get,
  };
}
