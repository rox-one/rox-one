import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CalendarStore,
  createProviderAdapter,
  mergeTodayUpcoming,
  type CalendarProvider,
  type TaskLike,
} from '@craft-agent/core/calendar'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'rox.calendar.v1'
const PROVIDERS: CalendarProvider[] = ['google', 'outlook', 'yandex', 'mailru', 'appleReminders']

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
  const proposals = store.proposals()

  const connect = (provider: CalendarProvider) => {
    void mutate(async (current) => {
      try {
        const account = current.connect(provider, provider, tz)
        const adapter = createProviderAdapter(provider)
        if (!adapter.available()) {
          return
        }
        current.markConnected(account.id)
        await current.sync(account.id, adapter, now)
      } catch {
        // Apple helper missing or provider unavailable — status strip stays on none/pending.
      }
    })
  }

  const revoke = (accountId: string) => {
    void mutate((current) => {
      current.revoke(accountId)
    })
  }

  return (
    <div className="flex flex-col gap-1 border-b border-border px-3 py-2 text-[11px]" data-testid="calendar-status-strip">
      <div className={cn('flex flex-wrap items-center gap-2', status === 'conflict' && 'text-amber-600', status === 'timezone' && 'text-amber-600')}>
        <span>{t(`calendar.status.${status}`)}</span>
        {PROVIDERS.map((provider) => (
          <button
            key={provider}
            type="button"
            className="rounded-full border border-foreground/10 px-2 py-0.5"
            onClick={() => connect(provider)}
          >
            {t(`calendar.provider.${provider}`)}
          </button>
        ))}
        {store.accounts().filter((account) => account.status === 'connected').map((account) => (
          <button key={account.id} type="button" className="underline" onClick={() => revoke(account.id)}>
            {t('calendar.revoke')} · {t(`calendar.provider.${account.provider}`)}
          </button>
        ))}
      </div>
      {events.length > 0 ? (
        <ul className="flex flex-wrap gap-2 text-muted-foreground">
          {events.map((item) => (
            <li key={item.id}>
              {t('calendar.kind.event')} · {item.title}
              <button
                type="button"
                className="ml-1 underline"
                onClick={() => void mutate((current) => { current.proposeReminder(item.id) })}
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
      {store.accounts()[0] ? (
        <p className="text-muted-foreground">{t('calendar.capability')}: {createProviderAdapter(store.accounts()[0]!.provider).capabilities.notes}</p>
      ) : null}
    </div>
  )
}
