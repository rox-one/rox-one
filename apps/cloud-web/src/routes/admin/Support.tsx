import { A } from '@solidjs/router'
import { For, Show, createEffect, createMemo, createSignal, on } from 'solid-js'
import type { JSX } from 'solid-js'

import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Table,
  Tabs,
  Textarea,
  useToast,
} from '@/components'
import type { TableColumn } from '@/components'
import { api } from '@/lib/api'
import type { AbuseFlag, Incident, IncidentStatus, Ticket } from '@/lib/api'
import { formatDate, shortId } from '@/lib/format'

import { AdminError } from './components/AdminError'
import {
  adminRefreshTick,
  adminStaffName,
  handleAdminError,
} from './components/adminSession'
import {
  abuseDecisionInfo,
  abuseStateInfo,
  incidentSeverityInfo,
  incidentStatusInfo,
  ticketPriorityInfo,
  ticketStatusInfo,
} from './components/ops/labels'
import { ReasonDialog } from './components/ops/ReasonDialog'

import './support.css'

type TabId = 'tickets' | 'incidents' | 'abuse'

const INCIDENT_ORDER: Record<IncidentStatus, number> = {
  investigating: 1,
  identified: 2,
  monitoring: 3,
  resolved: 4,
}

const INCIDENT_STATUSES: IncidentStatus[] = ['investigating', 'identified', 'monitoring', 'resolved']

/** Staff writes carry this name into the audit trail; the panel sets it. */
function staffId(): string {
  return adminStaffName() || 'staff'
}

function incidentJson(timeline: Incident['timeline']): string {
  return JSON.stringify(timeline, null, 2)
}

export default function AdminSupport(): JSX.Element {
  const toast = useToast()
  const [tab, setTab] = createSignal<TabId>('tickets')

  // ---------- tickets ----------
  const [tickets, setTickets] = createSignal<Ticket[]>([])
  const [ticketsLoading, setTicketsLoading] = createSignal(true)
  const [ticketsLoaded, setTicketsLoaded] = createSignal(false)
  const [ticketsError, setTicketsError] = createSignal<string | null>(null)
  const [ticketStatus, setTicketStatus] = createSignal('')
  const [ticketStatusDraft, setTicketStatusDraft] = createSignal('')
  const [selectedTicketId, setSelectedTicketId] = createSignal<string | null>(null)
  const [replyText, setReplyText] = createSignal('')
  const [replyBusy, setReplyBusy] = createSignal(false)
  const [replyError, setReplyError] = createSignal<string | null>(null)
  const [resolveArmed, setResolveArmed] = createSignal(false)
  const [resolveBusy, setResolveBusy] = createSignal(false)
  const [resolveError, setResolveError] = createSignal<string | null>(null)

  const selectedTicket = createMemo(
    () => tickets().find((ticket) => ticket.id === selectedTicketId()) ?? null,
  )

  const loadTickets = async (): Promise<void> => {
    setTicketsLoading(true)
    setTicketsError(null)
    try {
      const response = await api.admin.tickets({ status: ticketStatus() })
      setTickets(Array.isArray(response.data) ? response.data : [])
    } catch (err) {
      setTicketsError(handleAdminError(err))
      setTickets([])
    } finally {
      setTicketsLoading(false)
      setTicketsLoaded(true)
    }
  }

  const mergeTicket = (updated: Ticket): void => {
    setTickets((list) => list.map((ticket) => (ticket.id === updated.id ? updated : ticket)))
  }

  const openTicket = (ticket: Ticket): void => {
    setReplyText('')
    setReplyError(null)
    setResolveArmed(false)
    setResolveError(null)
    setSelectedTicketId(ticket.id)
  }

  const closeTicket = (): void => {
    if (replyBusy() || resolveBusy()) return
    setSelectedTicketId(null)
    setResolveArmed(false)
  }

  const sendReply = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault()
    const ticket = selectedTicket()
    if (ticket === null || replyBusy()) return
    const body = replyText().trim()
    if (body.length === 0) {
      setReplyError('Напишите ответ: пустое сообщение клиент не получит.')
      return
    }
    setReplyBusy(true)
    setReplyError(null)
    try {
      const updated = await api.admin.replyTicket(ticket.id, staffId(), body)
      mergeTicket(updated)
      setReplyText('')
      toast.success('Ответ отправлен клиенту')
      void loadTickets()
    } catch (err) {
      setReplyError(handleAdminError(err))
    } finally {
      setReplyBusy(false)
    }
  }

  const resolveTicket = async (): Promise<void> => {
    const ticket = selectedTicket()
    if (ticket === null || resolveBusy()) return
    setResolveBusy(true)
    setResolveError(null)
    try {
      const updated = await api.admin.resolveTicket(ticket.id, staffId())
      mergeTicket(updated)
      toast.success('Обращение закрыто')
      setResolveArmed(false)
      setSelectedTicketId(null)
      void loadTickets()
    } catch (err) {
      setResolveError(handleAdminError(err))
    } finally {
      setResolveBusy(false)
    }
  }

  const applyTicketStatus = (event: SubmitEvent): void => {
    event.preventDefault()
    setTicketStatus(ticketStatusDraft())
    void loadTickets()
  }

  // ---------- incidents ----------
  const [incidents, setIncidents] = createSignal<Incident[]>([])
  const [incidentsLoading, setIncidentsLoading] = createSignal(false)
  const [incidentsLoaded, setIncidentsLoaded] = createSignal(false)
  const [incidentsError, setIncidentsError] = createSignal<string | null>(null)
  const [selectedIncidentId, setSelectedIncidentId] = createSignal<string | null>(null)
  const [incidentStatusDraft, setIncidentStatusDraft] = createSignal<IncidentStatus>('investigating')
  const [incidentNote, setIncidentNote] = createSignal('')
  const [incidentBusy, setIncidentBusy] = createSignal(false)
  const [incidentError, setIncidentError] = createSignal<string | null>(null)

  const selectedIncident = createMemo(
    () => incidents().find((incident) => incident.id === selectedIncidentId()) ?? null,
  )

  const loadIncidents = async (): Promise<void> => {
    setIncidentsLoading(true)
    setIncidentsError(null)
    try {
      const response = await api.admin.incidents()
      setIncidents(Array.isArray(response.data) ? response.data : [])
    } catch (err) {
      setIncidentsError(handleAdminError(err))
      setIncidents([])
    } finally {
      setIncidentsLoading(false)
      setIncidentsLoaded(true)
    }
  }

  const openIncident = (incident: Incident): void => {
    setIncidentStatusDraft(incident.status)
    setIncidentNote('')
    setIncidentError(null)
    setSelectedIncidentId(incident.id)
  }

  const closeIncident = (): void => {
    if (incidentBusy()) return
    setSelectedIncidentId(null)
  }

  const submitIncident = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault()
    const incident = selectedIncident()
    if (incident === null || incidentBusy()) return
    const note = incidentNote().trim()
    if (note.length === 0) {
      setIncidentError('Напишите, что изменилось: заметка попадёт в историю происшествия.')
      return
    }
    setIncidentBusy(true)
    setIncidentError(null)
    try {
      const updated = await api.admin.updateIncident(incident.id, incidentStatusDraft(), note)
      setIncidents((list) => list.map((entry) => (entry.id === updated.id ? updated : entry)))
      toast.success(`Состояние изменено: ${incidentStatusInfo(updated.status).label}`)
      setSelectedIncidentId(null)
      void loadIncidents()
    } catch (err) {
      setIncidentError(handleAdminError(err))
    } finally {
      setIncidentBusy(false)
    }
  }

  // ---------- abuse ----------
  const [abuse, setAbuse] = createSignal<AbuseFlag[]>([])
  const [abuseLoading, setAbuseLoading] = createSignal(false)
  const [abuseLoaded, setAbuseLoaded] = createSignal(false)
  const [abuseError, setAbuseError] = createSignal<string | null>(null)
  const [abuseDecision, setAbuseDecision] = createSignal('')
  const [abuseDecisionDraft, setAbuseDecisionDraft] = createSignal('')
  const [abuseBusyId, setAbuseBusyId] = createSignal<string | null>(null)
  const [dismissTarget, setDismissTarget] = createSignal<AbuseFlag | null>(null)
  const [dismissBusy, setDismissBusy] = createSignal(false)
  const [dismissError, setDismissError] = createSignal<string | null>(null)

  const loadAbuse = async (): Promise<void> => {
    setAbuseLoading(true)
    setAbuseError(null)
    try {
      const response = await api.admin.abuse({ decision: abuseDecision() })
      setAbuse(Array.isArray(response.data) ? response.data : [])
    } catch (err) {
      setAbuseError(handleAdminError(err))
      setAbuse([])
    } finally {
      setAbuseLoading(false)
      setAbuseLoaded(true)
    }
  }

  const applyAbuseDecision = (event: SubmitEvent): void => {
    event.preventDefault()
    setAbuseDecision(abuseDecisionDraft())
    void loadAbuse()
  }

  const confirmAbuse = async (flag: AbuseFlag): Promise<void> => {
    if (abuseBusyId() !== null) return
    setAbuseBusyId(flag.id)
    setAbuseError(null)
    try {
      const updated = await api.admin.confirmAbuse(flag.id, staffId())
      setAbuse((list) => list.map((entry) => (entry.id === updated.id ? updated : entry)))
      toast.success('Нарушение подтверждено и записано в журнал')
      void loadAbuse()
    } catch (err) {
      setAbuseError(handleAdminError(err))
    } finally {
      setAbuseBusyId(null)
    }
  }

  const submitDismiss = async (reason: string): Promise<void> => {
    const flag = dismissTarget()
    if (flag === null) return
    setDismissBusy(true)
    setDismissError(null)
    try {
      const updated = await api.admin.dismissAbuse(flag.id, reason)
      setAbuse((list) => list.map((entry) => (entry.id === updated.id ? updated : entry)))
      toast.success('Запись отклонена')
      setDismissTarget(null)
      void loadAbuse()
    } catch (err) {
      setDismissError(handleAdminError(err))
    } finally {
      setDismissBusy(false)
    }
  }

  // ---------- lifecycle ----------
  createEffect(
    on(adminRefreshTick, () => {
      void loadTickets()
      if (incidentsLoaded()) void loadIncidents()
      if (abuseLoaded()) void loadAbuse()
    }),
  )

  const switchTab = (next: TabId): void => {
    setTab(next)
    if (next === 'incidents' && !incidentsLoaded()) void loadIncidents()
    if (next === 'abuse' && !abuseLoaded()) void loadAbuse()
  }

  const refresh = (): void => {
    if (tab() === 'tickets') void loadTickets()
    else if (tab() === 'incidents') void loadIncidents()
    else void loadAbuse()
  }

  // ---------- tables ----------
  const ticketColumns: TableColumn<Ticket>[] = [
    {
      key: 'subject',
      label: 'Тема',
      render: (ticket) => (
        <span class="support-subject">
          <span>{ticket.subject}</span>
          <span class="support-code">{shortId(ticket.id, 14)}</span>
        </span>
      ),
    },
    {
      key: 'tenant_id',
      label: 'Клиент',
      render: (ticket) =>
        ticket.tenant_id === undefined ? (
          <span class="muted">—</span>
        ) : (
          <A class="mono support-small" href={`/admin/clients/${encodeURIComponent(ticket.tenant_id)}`} title={ticket.tenant_id}>
            {shortId(ticket.tenant_id, 12)}
          </A>
        ),
    },
    {
      key: 'status',
      label: 'Состояние',
      render: (ticket) => <Badge tone={ticketStatusInfo(ticket.status).tone}>{ticketStatusInfo(ticket.status).label}</Badge>,
    },
    {
      key: 'priority',
      label: 'Приоритет',
      render: (ticket) => <Badge tone={ticketPriorityInfo(ticket.priority).tone}>{ticketPriorityInfo(ticket.priority).label}</Badge>,
    },
    {
      key: 'updated_at',
      label: 'Обновлено',
      render: (ticket) => <span class="support-small support-when">{formatDate(ticket.updated_at)}</span>,
    },
    {
      key: 'messages',
      label: 'Сообщений',
      align: 'right',
      render: (ticket) => <span class="support-small">{ticket.messages.length}</span>,
    },
    {
      key: 'actions',
      label: 'Действие',
      render: (ticket) => (
        <Button size="sm" variant="secondary" onClick={() => openTicket(ticket)}>
          Открыть
        </Button>
      ),
    },
  ]

  const incidentColumns: TableColumn<Incident>[] = [
    {
      key: 'title',
      label: 'Происшествие',
      render: (incident) => (
        <span class="support-subject">
          <span>{incident.title}</span>
          <span class="support-code">{shortId(incident.id, 14)}</span>
        </span>
      ),
    },
    {
      key: 'severity',
      label: 'Важность',
      render: (incident) => (
        <Badge tone={incidentSeverityInfo(incident.severity).tone}>{incidentSeverityInfo(incident.severity).label}</Badge>
      ),
    },
    {
      key: 'status',
      label: 'Состояние',
      render: (incident) => (
        <Badge tone={incidentStatusInfo(incident.status).tone} dot>
          {incidentStatusInfo(incident.status).label}
        </Badge>
      ),
    },
    {
      key: 'updated_at',
      label: 'Обновлено',
      render: (incident) => <span class="support-small support-when">{formatDate(incident.updated_at)}</span>,
    },
    {
      key: 'public_summary',
      label: 'Публичное описание',
      render: (incident) => <span class="support-summary">{incident.public_summary}</span>,
    },
    {
      key: 'actions',
      label: 'Действие',
      render: (incident) => (
        <Show
          when={incident.status !== 'resolved'}
          fallback={<span class="muted support-small">закрыто</span>}
        >
          <Button size="sm" variant="secondary" onClick={() => openIncident(incident)}>
            Состояние
          </Button>
        </Show>
      ),
    },
  ]

  const abuseColumns: TableColumn<AbuseFlag>[] = [
    {
      key: 'tenant_id',
      label: 'Клиент',
      render: (flag) => (
        <A class="mono support-small" href={`/admin/clients/${encodeURIComponent(flag.tenant_id)}`} title={flag.tenant_id}>
          {shortId(flag.tenant_id, 12)}
        </A>
      ),
    },
    {
      key: 'sandbox_id',
      label: 'Машина',
      render: (flag) => (
        <span class="mono support-small" title={flag.sandbox_id}>
          {shortId(flag.sandbox_id, 12)}
        </span>
      ),
    },
    {
      key: 'decision',
      label: 'Решение',
      render: (flag) => <Badge tone={abuseDecisionInfo(flag.decision).tone}>{abuseDecisionInfo(flag.decision).label}</Badge>,
    },
    {
      key: 'state',
      label: 'Состояние',
      render: (flag) => (
        <span class="support-state">
          <Badge tone={abuseStateInfo(flag.state).tone}>{abuseStateInfo(flag.state).label}</Badge>
          <Show when={flag.confirmed_by !== null && flag.confirmed_by !== undefined}>
            <span class="support-small">кто: {flag.confirmed_by}</span>
          </Show>
          <Show when={flag.dismissed_reason !== null && flag.dismissed_reason !== undefined}>
            <span class="support-small">почему: {flag.dismissed_reason}</span>
          </Show>
        </span>
      ),
    },
    {
      key: 'reason',
      label: 'Причина',
      render: (flag) => <span class="support-reason">{flag.reason}</span>,
    },
    {
      key: 'evidence',
      label: 'Замер',
      render: (flag) => (
        <details class="support-json">
          <summary>числа</summary>
          <pre>{JSON.stringify(flag.evidence, null, 2)}</pre>
        </details>
      ),
    },
    {
      key: 'at',
      label: 'Когда',
      render: (flag) => <span class="support-small support-when">{formatDate(flag.at)}</span>,
    },
    {
      key: 'actions',
      label: 'Действие',
      render: (flag) => (
        <Show
          when={flag.state === 'open'}
          fallback={<span class="muted support-small">разобрано</span>}
        >
          <span class="support-actions">
            <Button
              size="sm"
              variant="secondary"
              loading={abuseBusyId() === flag.id}
              disabled={flag.decision === 'none' || (abuseBusyId() !== null && abuseBusyId() !== flag.id)}
              title={flag.decision === 'none' ? 'В замере нет нарушения: подтверждать нечего' : undefined}
              onClick={() => void confirmAbuse(flag)}
            >
              Подтвердить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissTarget(flag)}>
              Отклонить
            </Button>
          </span>
        </Show>
      ),
    },
  ]

  const incidentChoices = (incident: Incident): { value: string; label: string }[] => {
    const current = INCIDENT_ORDER[incident.status]
    return INCIDENT_STATUSES.filter((status) => INCIDENT_ORDER[status] >= current).map((status) => ({
      value: status,
      label: incidentStatusInfo(status).label,
    }))
  }

  return (
    <section class="page support-page">
      <PageHeader
        eyebrow="Поддержка"
        title="Поддержка"
        description="Обращения клиентов, происшествия и очередь злоупотреблений. Ответы и подтверждения подписываются именем дежурного и попадают в журнал действий."
        actions={
          <Button
            variant="secondary"
            loading={
              tab() === 'tickets' ? ticketsLoading() : tab() === 'incidents' ? incidentsLoading() : abuseLoading()
            }
            onClick={refresh}
          >
            Обновить
          </Button>
        }
      />

      <Tabs
        label="Разделы поддержки"
        active={tab()}
        onChange={(id) => switchTab(id as TabId)}
        items={[
          { id: 'tickets', label: 'Обращения', count: ticketsLoaded() ? tickets().length : undefined },
          { id: 'incidents', label: 'Происшествия', count: incidentsLoaded() ? incidents().length : undefined },
          { id: 'abuse', label: 'Злоупотребления', count: abuseLoaded() ? abuse().length : undefined },
        ]}
      />

      <Show when={tab() === 'tickets'}>
        <Card class="support-filters-card" bodyClass="support-filters-body">
          <form class="support-filters" aria-label="Фильтр обращений" onSubmit={applyTicketStatus}>
            <Field label="Состояние" for="support-ticket-status" hint="фильтр уходит на сервер">
              <Select
                id="support-ticket-status"
                class="select"
                placeholder="любое"
                options={[
                  { value: 'open', label: 'ждёт дежурного' },
                  { value: 'pending', label: 'ждёт клиента' },
                  { value: 'resolved', label: 'закрыто' },
                ]}
                value={ticketStatusDraft()}
                onChange={(event) => setTicketStatusDraft(event.currentTarget.value)}
              />
            </Field>
            <div class="support-filter-actions">
              <Button type="submit" variant="primary" loading={ticketsLoading()}>
                Показать
              </Button>
            </div>
          </form>
        </Card>

        <AdminError text={ticketsError()} onRetry={() => void loadTickets()} />

        <Show
          when={tickets().length > 0 || ticketsLoading()}
          fallback={
            <Card class="support-empty-card">
              <EmptyState
                icon="shield"
                title={ticketStatus() === '' ? 'Обращений пока нет' : 'С этим состоянием обращений нет'}
                description="Клиент открывает обращение из кабинета. Здесь появятся тема, состояние, приоритет и переписка."
              />
            </Card>
          }
        >
          <Table label="Обращения клиентов" columns={ticketColumns} rows={tickets()} loading={ticketsLoading()} />
        </Show>
      </Show>

      <Show when={tab() === 'incidents'}>
        <AdminError text={incidentsError()} onRetry={() => void loadIncidents()} />

        <p class="support-note">
          Публичная страница «Состояние» показывает только заголовок, описание, важность и состояние. Статус может меняться
          только вперёд: разбираемся, затем причина найдена, наблюдаем, закрыто.
        </p>

        <Show
          when={incidents().length > 0 || incidentsLoading()}
          fallback={
            <Card class="support-empty-card">
              <EmptyState
                icon="shield"
                title="Происшествий нет"
                description="Когда происшествие открыто, здесь видно его важность, состояние и историю. Дежурный меняет состояние только вперёд."
              />
            </Card>
          }
        >
          <Table label="Происшествия" columns={incidentColumns} rows={incidents()} loading={incidentsLoading()} />
        </Show>
      </Show>

      <Show when={tab() === 'abuse'}>
        <Card class="support-filters-card" bodyClass="support-filters-body">
          <form class="support-filters" aria-label="Фильтр злоупотреблений" onSubmit={applyAbuseDecision}>
            <Field label="Решение" for="support-abuse-decision" hint="фильтр уходит на сервер">
              <Select
                id="support-abuse-decision"
                class="select"
                placeholder="любое"
                options={[
                  { value: 'none', label: 'без мер' },
                  { value: 'warn', label: 'предупреждение' },
                  { value: 'throttle', label: 'ограничение' },
                  { value: 'stop', label: 'остановка' },
                ]}
                value={abuseDecisionDraft()}
                onChange={(event) => setAbuseDecisionDraft(event.currentTarget.value)}
              />
            </Field>
            <div class="support-filter-actions">
              <Button type="submit" variant="primary" loading={abuseLoading()}>
                Показать
              </Button>
            </div>
          </form>
        </Card>

        <p class="support-note">
          Запись хранит только числа замера: загрузку процессора, исходящий трафик и число соединений. Ни текста клиента, ни
          содержимого его запросов здесь нет.
        </p>

        <AdminError text={abuseError()} onRetry={() => void loadAbuse()} />

        <Show
          when={abuse().length > 0 || abuseLoading()}
          fallback={
            <Card class="support-empty-card">
              <EmptyState
                icon="shield"
                title={abuseDecision() === '' ? 'Очередь пуста' : 'С таким решением записей нет'}
                description="Проверка добавляет сюда замеры, которые вышли за пороги. Разобранные записи остаются в списке со своим состоянием."
              />
            </Card>
          }
        >
          <Table label="Очередь злоупотреблений" columns={abuseColumns} rows={abuse()} loading={abuseLoading()} />
        </Show>
      </Show>

      {/* One ticket: the whole thread, a reply and closing. */}
      <Dialog
        open={selectedTicket() !== null}
        onClose={closeTicket}
        wide
        title={`Обращение ${selectedTicket() === null ? '' : shortId(selectedTicket()?.id, 14)}`}
        subtitle={selectedTicket()?.subject}
        footer={
          <>
            <Button variant="ghost" onClick={closeTicket} disabled={replyBusy() || resolveBusy()}>
              Свернуть
            </Button>
            <Show when={selectedTicket() !== null && selectedTicket()?.status !== 'resolved'}>
              <Button
                variant="secondary"
                onClick={() => setResolveArmed(true)}
                disabled={replyBusy() || resolveBusy()}
              >
                Закрыть обращение
              </Button>
              <Button
                type="submit"
                form="support-reply-form"
                variant="primary"
                loading={replyBusy()}
                disabled={resolveBusy()}
              >
                Ответить
              </Button>
            </Show>
          </>
        }
      >
        <Show when={selectedTicket()}>
          {(ticket) => (
            <>
              <div class="support-meta">
                <Badge tone={ticketStatusInfo(ticket().status).tone}>{ticketStatusInfo(ticket().status).label}</Badge>
                <Badge tone={ticketPriorityInfo(ticket().priority).tone}>
                  приоритет: {ticketPriorityInfo(ticket().priority).label}
                </Badge>
                <Show when={ticket().tenant_id !== undefined}>
                  <A
                    class="mono support-small"
                    href={`/admin/clients/${encodeURIComponent(ticket().tenant_id ?? '')}`}
                  >
                    клиент {shortId(ticket().tenant_id, 12)}
                  </A>
                </Show>
                <span class="support-small">открыто {formatDate(ticket().created_at)}</span>
                <span class="support-small">обновлено {formatDate(ticket().updated_at)}</span>
              </div>

              <div class="support-thread" aria-label="Переписка по обращению">
                <For each={ticket().messages}>
                  {(message) => (
                    <article class={`support-message support-message-${message.author_role}`}>
                      <header class="support-message-head">
                        <span class="support-message-who">
                          {message.author_role === 'staff' ? 'дежурный' : 'клиент'}
                        </span>
                        <span class="support-small">{formatDate(message.created_at)}</span>
                      </header>
                      <p class="support-message-body">{message.body}</p>
                    </article>
                  )}
                </For>
              </div>

              <Show
                when={ticket().status !== 'resolved'}
                fallback={<p class="support-note">Обращение закрыто: переписка только для чтения.</p>}
              >
                <form id="support-reply-form" class="support-reply" onSubmit={(event) => void sendReply(event)}>
                  <Field
                    label="Ответ клиенту"
                    for="support-reply-text"
                    required
                    hint={`Подпись в журнале: ${staffId()}`}
                    error={replyError()}
                  >
                    <Textarea
                      id="support-reply-text"
                      rows={3}
                      value={replyText()}
                      placeholder="Что ответить клиенту"
                      aria-required="true"
                      onInput={(event) => setReplyText(event.currentTarget.value)}
                    />
                  </Field>
                </form>

                <Show when={resolveArmed()}>
                  <div class="support-confirm">
                    <p class="support-confirm-text">
                      Закрыть обращение? Клиент увидит, что вопрос решён, а переписка станет только для чтения. Вернуть
                      обращение в работу из панели нельзя.
                    </p>
                    <Show when={resolveError()}>
                      <p class="support-error-text" role="alert">
                        {resolveError()}
                      </p>
                    </Show>
                    <div class="support-confirm-actions">
                      <Button variant="danger" loading={resolveBusy()} onClick={() => void resolveTicket()}>
                        Да, закрыть
                      </Button>
                      <Button variant="ghost" onClick={() => setResolveArmed(false)} disabled={resolveBusy()}>
                        Отмена
                      </Button>
                    </div>
                  </div>
                </Show>
              </Show>
            </>
          )}
        </Show>
      </Dialog>

      {/* One incident: its history and the next state. */}
      <Dialog
        open={selectedIncident() !== null}
        onClose={closeIncident}
        wide
        title={selectedIncident() === null ? 'Происшествие' : selectedIncident()?.title ?? 'Происшествие'}
        subtitle={
          selectedIncident() === null
            ? undefined
            : `${incidentSeverityInfo(selectedIncident()?.severity ?? '').label} · ${incidentStatusInfo(selectedIncident()?.status ?? '').label}`
        }
        footer={
          <>
            <Button variant="ghost" onClick={closeIncident} disabled={incidentBusy()}>
              Отмена
            </Button>
            <Button
              type="submit"
              form="support-incident-form"
              variant="primary"
              loading={incidentBusy()}
            >
              Обновить состояние
            </Button>
          </>
        }
      >
        <Show when={selectedIncident()}>
          {(incident) => (
            <>
              <p class="support-summary">{incident().public_summary}</p>
              <details class="support-json">
                <summary>История происшествия</summary>
                <pre>{incidentJson(incident().timeline)}</pre>
              </details>
              <form id="support-incident-form" class="support-incident-form" onSubmit={(event) => void submitIncident(event)}>
                <Field label="Новое состояние" for="support-incident-status" hint="только вперёд по ходу происшествия">
                  <Select
                    id="support-incident-status"
                    class="select"
                    options={incidentChoices(incident())}
                    value={incidentStatusDraft()}
                    onChange={(event) => setIncidentStatusDraft(event.currentTarget.value as IncidentStatus)}
                  />
                </Field>
                <Field
                  label="Что изменилось"
                  for="support-incident-note"
                  required
                  hint="Заметка попадёт в историю и в журнал действий."
                  error={incidentError()}
                >
                  <Textarea
                    id="support-incident-note"
                    rows={3}
                    value={incidentNote()}
                    placeholder="например: перезапустили пул, ошибки прекратились"
                    aria-required="true"
                    onInput={(event) => setIncidentNote(event.currentTarget.value)}
                  />
                </Field>
              </form>
            </>
          )}
        </Show>
      </Dialog>

      <ReasonDialog
        open={dismissTarget() !== null}
        title="Отклонить запись"
        subtitle="Запись останется в списке с состоянием «отклонено» и вашей причиной."
        label="Почему это не нарушение"
        placeholder="например: клиент собирал образ, это разовая нагрузка"
        hint="Причина сохранится в журнале действий."
        confirmLabel="Отклонить"
        busy={dismissBusy()}
        error={dismissError()}
        onSubmit={(reason) => void submitDismiss(reason)}
        onClose={() => {
          if (dismissBusy()) return
          setDismissTarget(null)
          setDismissError(null)
        }}
      />
    </section>
  )
}
