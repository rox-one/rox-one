import { A } from '@solidjs/router'
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import { api } from '@/lib/api'
import type { Sandbox } from '@/lib/api'
import { formatDate, formatDuration } from '@/lib/format'
import { flip, reveal } from '@/lib/motion'

import { machineDisplayName } from './components/console-ui'

import './running-strip.css'

/** A stopped or deleted machine leaves the strip within this window. */
const REFRESH_MS = 15_000
/** Address, egress and load are asked less often than the list: a provider
 *  round-trip per card is heavier than the list itself. */
const PROBE_EVERY_MS = 30_000
/** The remaining time on every card ticks once a second. */
const TICK_MS = 1000
/** A call that has not answered by then is treated as unreachable by the strip;
 *  the request itself keeps running and the next refresh asks again, so the
 *  page never waits on a slow network. */
const PROBE_MS = 8000

interface Probe {
  online: boolean
  privateIp: string | null
  cpuPercent: number | null
  note: string | null
}

/** `null` means the call failed or did not answer in time. */
function settle<T>(call: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms)
    call.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      () => {
        window.clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

/** The person's own name for the machine, or the name its make-up gives it. */
function stripName(machine: Sandbox): string {
  const custom = machine.display_name
  if (typeof custom === 'string' && custom.trim().length > 0) return custom.trim()
  return machineDisplayName(machine.spec)
}

function expiresIn(machine: Sandbox): number | null {
  const value = machine.expires_at
  if (typeof value !== 'string' || value.length === 0) return null
  const at = Date.parse(value)
  return Number.isNaN(at) ? null : at
}

/** `осталось 15 мин`, `срок истёк`, or nothing to count when the machine is open. */
function ttlText(machine: Sandbox, now: number): string {
  const at = expiresIn(machine)
  if (at === null) return 'без ограничения'
  const left = Math.max(0, Math.round((at - now) / 1000))
  return left > 0 ? `осталось ${formatDuration(left)}` : 'срок истёк'
}

function statusText(probe: Probe | undefined): string {
  if (probe === undefined) return 'Проверяем'
  return probe.online ? 'В сети' : 'Нет связи'
}

function statusState(probe: Probe | undefined): 'pending' | 'online' | 'offline' {
  if (probe === undefined) return 'pending'
  return probe.online ? 'online' : 'offline'
}

export default function RunningMachinesStrip(props: { currentId: string }): JSX.Element {
  const [machines, setMachines] = createSignal<Sandbox[]>([])
  const [probes, setProbes] = createSignal<Record<string, Probe>>({})
  const [loading, setLoading] = createSignal(true)
  const [failed, setFailed] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())

  let disposed = false
  let inFlight = false
  let stripEl: HTMLElement | undefined
  const probedAt = new Map<string, number>()
  /** Cards already on screen once: only a first appearance is revealed. */
  const seen = new Set<string>()

  /** Private address, egress probe and load at once; each missing answer only
   *  hides its own line, so one slow call never holds the strip. */
  const takeProbe = async (id: string): Promise<void> => {
    probedAt.set(id, Date.now())
    const [network, check, metrics] = await Promise.all([
      settle(api.network(id), PROBE_MS),
      settle(api.networkCheck(id), PROBE_MS),
      settle(api.metrics(id), PROBE_MS),
    ])
    if (disposed) return
    setProbes((prev) => ({
      ...prev,
      [id]: {
        // The probe's own verdict wins; without it any answered call is a sign of life.
        online: check !== null ? check.online : network !== null || metrics !== null,
        privateIp: network?.privateIp ?? null,
        cpuPercent:
          metrics !== null && Number.isFinite(metrics.cpuPercent)
            ? Math.round(metrics.cpuPercent)
            : null,
        note: check?.note ?? null,
      },
    }))
  }

  const load = async (): Promise<void> => {
    if (inFlight) return
    inFlight = true
    const listing = await settle(api.sandboxes(), PROBE_MS)
    inFlight = false
    if (disposed) return
    if (listing === null) {
      // The last known cards stay in place and are replaced by the next attempt.
      setFailed(true)
      setLoading(false)
      return
    }
    const running = listing.data
      .filter((machine) => machine.state === 'running')
      .sort((left, right) => (Date.parse(right.created_at) || 0) - (Date.parse(left.created_at) || 0))
    // The last known cards stay put while a refresh is in flight; a new order
    // arrives as a flip rather than as a jump, and a departed card is dropped.
    const strip = stripEl
    if (strip === undefined || machines().length === 0) setMachines(running)
    else flip(strip, () => setMachines(running))
    setFailed(false)
    setLoading(false)
    const ids = new Set(running.map((machine) => machine.id))
    setProbes((prev) => {
      const next: Record<string, Probe> = {}
      for (const [id, probe] of Object.entries(prev)) {
        if (ids.has(id)) next[id] = probe
      }
      return next
    })
    for (const id of [...probedAt.keys()]) {
      if (!ids.has(id)) probedAt.delete(id)
    }
    const at = Date.now()
    for (const machine of running) {
      // A new card is asked at once; a known one only every half minute.
      if (at - (probedAt.get(machine.id) ?? 0) >= PROBE_EVERY_MS) void takeProbe(machine.id)
    }
  }

  onMount(() => {
    void load()
    const refresh = window.setInterval(() => void load(), REFRESH_MS)
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS)
    onCleanup(() => {
      disposed = true
      window.clearInterval(refresh)
      window.clearInterval(tick)
    })
  })

  const probeOf = (id: string): Probe | undefined => probes()[id]

  return (
    <section
      class="running-strip"
      aria-label="Запущенные машины"
      aria-busy={loading() ? 'true' : 'false'}
      ref={(element) => {
        stripEl = element
      }}
    >
      <Show
        when={!loading()}
        fallback={
          <div class="running-card running-card-pending" aria-hidden="true">
            <span class="running-skeleton running-skeleton-name" />
            <span class="running-skeleton running-skeleton-line" />
            <span class="running-skeleton running-skeleton-line" />
          </div>
        }
      >
        <Show
          when={machines().length > 0}
          fallback={
            <p class="running-strip-empty">
              {failed() ? 'Список запущенных машин не получен' : 'Сейчас нет запущенных машин'}
            </p>
          }
        >
          <For each={machines()}>
            {(machine) => {
              const probe = (): Probe | undefined => probeOf(machine.id)
              const current = (): boolean => machine.id === props.currentId
              const at = expiresIn(machine)
              return (
                <A
                  href={`/console/machines/${machine.id}`}
                  class="running-card"
                  classList={{ 'is-current': current() }}
                  aria-current={current() ? 'page' : undefined}
                  title={`Открыть машину ${stripName(machine)}`}
                  data-flip-key={machine.id}
                  ref={(element) => {
                    if (seen.has(machine.id)) return
                    seen.add(machine.id)
                    reveal(element, { distance: 4 })
                  }}
                >
                  <span class="running-card-name">{stripName(machine)}</span>
                  <span
                    class="running-card-status"
                    data-state={statusState(probe())}
                    title={probe()?.note ?? undefined}
                  >
                    <span class="running-card-dot" aria-hidden="true" />
                    {statusText(probe())}
                  </span>
                  <span class="running-card-meta">
                    <span class="running-card-ip" title="Адрес внутри частной сети">
                      {probe()?.privateIp ??
                        (probe() === undefined ? 'адрес проверяется' : 'адрес не сообщён')}
                    </span>
                    <Show when={probe()?.cpuPercent !== null && probe() !== undefined}>
                      <span class="running-card-cpu" title="Загрузка процессора сейчас">
                        {probe()?.cpuPercent}% CPU
                      </span>
                    </Show>
                  </span>
                  <span
                    class="running-card-ttl"
                    title={at === null ? 'Срок не ограничен' : `До ${formatDate(at)}`}
                  >
                    {ttlText(machine, now())}
                  </span>
                </A>
              )
            }}
          </For>
        </Show>
      </Show>
    </section>
  )
}
