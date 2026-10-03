import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { calendarEventIdentity, CalendarStore, mergeTodayUpcoming, type TaskLike } from '@rox/core/calendar'
import { CalendarConnectorChips } from './CalendarConnectorChips'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'rox.calendar.v1'

function loadStore(): CalendarStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return CalendarStore.fromJson(raw)
  } catch {
    // Corrupt cache — start empty.
  }
  return new CalendarStore()
}

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function CalendarStatusStrip({ tasks, now }: { tasks: readonly TaskLike[]; now: number }) {
  const { t } = useTranslation()
  const [store, setStore] = useState(loadStore)
  const [reminderDraft, setReminderDraft] = useState('')
  const tz = localTimeZone()

  const persist = useCallback((next: CalendarStore) => {
    setStore(next)
    localStorage.setItem(STORAGE_KEY, next.exportJson())
  }, [])

  const mutate = useCallback(async (fn: (current: CalendarStore) => void | Promise<void>) => {
    const next = CalendarStore.fromJson(store.exportJson())
    await fn(next)
    persist(next)
  }, [persist, store])

  const status = store.uiStatus(tz)
  const merged = useMemo(
    () => mergeTodayUpcoming(tasks, store.events(), now),
    [tasks, store, now],
  )
  const events = merged.filter((item) => item.kind === 'event')
  const conflicts = store.conflicts()
  const proposals = store.proposals()

  const revoke = (accountId: string) => {
    void mutate((current) => {
      current.revoke(accountId)
    })
  }

  const addLocalReminder = (event: React.FormEvent) => {
    event.preventDefault()
    if (!reminderDraft.trim()) return
    void mutate((current) => {
      current.addLocalReminder(reminderDraft, now + 60 * 60 * 1000)
    })
    setReminderDraft('')
  }

  return (
    <div className="flex flex-col gap-1 px-3 py-2 text-[11px]" data-testid="calendar-status-strip">
      <div className={cn('flex flex-wrap items-center gap-2', (status === 'conflict' || status === 'localChanges' || status === 'timezone') && 'text-amber-600')}>
        <span>{t(`calendar.status.${status}`)}</span>
        <CalendarConnectorChips />
        {store.accounts().filter((account) => account.status === 'connected').map((account) => (
          <button key={account.id} type="button" className="underline" onClick={() => revoke(account.id)}>
            {t('calendar.revoke')} · {t(`calendar.provider.${account.provider}`)}
          </button>
        ))}
      </div>
      <p className="text-muted-foreground">{t('calendar.connectorOptional')}</p>
      <form onSubmit={addLocalReminder} className="flex items-center gap-1">
        <input
          value={reminderDraft}
          onChange={(event) => setReminderDraft(event.target.value)}
          placeholder={t('calendar.localReminderPlaceholder')}
          aria-label={t('calendar.localReminders')}
          className="h-7 min-w-0 flex-1 rounded-[var(--radius-card)] border border-foreground/10 bg-transparent px-2"
        />
        <button type="submit" className="underline">{t('calendar.addLocalReminder')}</button>
      </form>
      {conflicts.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {conflicts.map((conflict) => {
            const event = conflict.eventIdentity
              ? store.events().find((item) => calendarEventIdentity(item) === conflict.eventIdentity)
              : undefined
            if (!event) return null
            return (
              <li key={conflict.id} className="flex flex-wrap items-center gap-2">
                <span>{t('calendar.conflict.event', { title: event.title })}</span>
                <button type="button" className="underline" onClick={() => void mutate((current) => { current.resolveConflict(conflict.id, 'local') })}>
                  {t('calendar.conflict.keepLocal')}
                </button>
                <button type="button" className="underline" onClick={() => void mutate((current) => { current.resolveConflict(conflict.id, 'remote') })}>
                  {t('calendar.conflict.useRemote')}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
      {events.length > 0 ? (
        <ul className="flex flex-wrap gap-2 text-muted-foreground">
          {events.map((item) => (
            <li key={calendarEventIdentity(item.event)}>
              {t('calendar.kind.event')} · {item.title}
              <button
                type="button"
                className="ml-1 underline"
                onClick={() => void mutate((current) => { current.proposeReminder(item.event) })}
              >
                {t('calendar.proposals')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {proposals.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {proposals.map((proposal) => (
            <li key={proposal.id} className="flex items-center gap-2">
              <span>{proposal.title}</span>
              <button type="button" className="underline" onClick={() => void mutate((current) => { current.acceptProposal(proposal.id) })}>
                {t('calendar.acceptProposal')}
              </button>
              <button type="button" className="underline" onClick={() => void mutate((current) => { current.dismissProposal(proposal.id) })}>
                {t('calendar.dismissProposal')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
