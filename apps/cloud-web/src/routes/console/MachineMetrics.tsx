import { Show, createEffect, createSignal, on, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import { Card, Skeleton } from '@/components'
import { api } from '@/lib/api'
import type { MetricsInfo } from '@/lib/api'
import { formatBytes, formatTime } from '@/lib/format'

import { errorText } from './components/console-ui'

import './machine-panels.css'

const POLL_MS = 5000

const URL_SECRET = /\b(?:https?|wss?):\/\/[^\s<>"']+/gi
const NAMED_SECRET = /\b(token|secret|password|passwd|api[_-]?key|key)=[^\s,&;]+/gi

/** The server's own words, with any address or named secret cut out. */
function safeError(err: unknown): string {
  return errorText(err).replace(URL_SECRET, '[адрес скрыт]').replace(NAMED_SECRET, '$1=скрыт')
}

/** A pair of kilobyte counters as one bar; a zero total stays unknown. */
function usedPercent(used: number, total: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null
  return Math.min(100, Math.max(0, (used / total) * 100))
}

/** `1,2 ГБ из 4,0 ГБ`; a missing or negative counter reads as a dash. */
function usageText(used: number, total: number): string {
  if (!Number.isFinite(used) || used < 0) return '—'
  const usedText = used === 0 ? '0 Б' : formatBytes(used * 1024)
  const totalText = Number.isFinite(total) && total > 0 ? formatBytes(total * 1024) : '—'
  return `${usedText} из ${totalText}`
}

interface MeterProps {
  label: string
  value: string
  percent: number | null
}

function Meter(props: MeterProps): JSX.Element {
  const tone = (): string => {
    const value = props.percent
    if (value === null) return 'unknown'
    if (value >= 90) return 'danger'
    if (value >= 75) return 'warn'
    return 'ok'
  }
  return (
    <div class="mp-meter">
      <div class="mp-meter-head">
        <span class="mp-meter-label">{props.label}</span>
        <span class="mp-meter-value">
          {props.percent === null ? '—' : `${Math.round(props.percent)}%`}
        </span>
      </div>
      <div
        class="mp-bar"
        role="progressbar"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={props.percent === null ? undefined : Math.round(props.percent)}
        data-tone={tone()}
      >
        <span class="mp-bar-fill" style={{ width: `${props.percent ?? 0}%` }} />
      </div>
      <div class="mp-meter-sub">{props.value}</div>
    </div>
  )
}

export interface MachineMetricsProps {
  sandboxId: string
  enabled: boolean
}

/**
 * Three compact bars for the machine's processor, memory and disk. The numbers
 * are sampled every five seconds while the machine runs; a failed sample only
 * dims one line and never replaces the bars with an error page.
 */
export default function MachineMetrics(props: MachineMetricsProps): JSX.Element {
  const [info, setInfo] = createSignal<MetricsInfo | null>(null)
  const [failure, setFailure] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)

  let timer: number | undefined
  let token = 0

  const stopTimer = (): void => {
    if (timer !== undefined) {
      window.clearInterval(timer)
      timer = undefined
    }
  }

  const load = async (): Promise<void> => {
    if (!props.enabled || props.sandboxId.length === 0) return
    const mine = ++token
    try {
      const next = await api.metrics(props.sandboxId)
      if (mine !== token) return
      setInfo(next)
      setFailure(null)
    } catch (err) {
      if (mine !== token) return
      setFailure(safeError(err))
    } finally {
      if (mine === token) setLoading(false)
    }
  }

  createEffect(
    on(
      () => `${props.sandboxId}\u0000${props.enabled ? '1' : '0'}`,
      () => {
        stopTimer()
        // A sample for the previous machine or state must not paint over this one.
        token += 1
        setInfo(null)
        setFailure(null)
        setLoading(false)
        if (!props.enabled || props.sandboxId.length === 0) return
        setLoading(true)
        void load()
        timer = window.setInterval(() => void load(), POLL_MS)
      },
    ),
  )
  onCleanup(stopTimer)

  return (
    <Card
      title="Нагрузка"
      subtitle={
        props.enabled
          ? 'Процессор, память и диск; показатели обновляются каждые 5 секунд.'
          : 'Показатели снимаются только с запущенной машины.'
      }
    >
      <Show when={!props.enabled}>
        <p class="mp-note">
          Машина не запущена, поэтому нагрузки нет. Запустите её — здесь появятся три полосы:
          процессор, память и диск.
        </p>
      </Show>

      <Show when={props.enabled}>
        <div class="mp-stack">
          <Show
            when={info()}
            fallback={
              <Show when={loading()} fallback={<p class="mp-note">Показатели ещё не пришли.</p>}>
                <Skeleton lines={3} />
              </Show>
            }
          >
            {(metrics) => (
              <div class="mp-meters">
                <Meter
                  label="Процессор"
                  value="загрузка ядер"
                  percent={
                    Number.isFinite(metrics().cpuPercent)
                      ? Math.min(100, Math.max(0, metrics().cpuPercent))
                      : null
                  }
                />
                <Meter
                  label="Память"
                  value={usageText(metrics().memoryUsedKb, metrics().memoryTotalKb)}
                  percent={usedPercent(metrics().memoryUsedKb, metrics().memoryTotalKb)}
                />
                <Meter
                  label="Диск"
                  value={usageText(metrics().diskUsedKb, metrics().diskTotalKb)}
                  percent={usedPercent(metrics().diskUsedKb, metrics().diskTotalKb)}
                />
              </div>
            )}
          </Show>

          <Show when={failure() !== null}>
            <p class="mp-error-quiet" role="status">
              Нагрузка не обновилась: {failure()}. Полосы останутся на прежнем замере.
            </p>
          </Show>

          <Show when={info()?.at != null && failure() === null}>
            <p class="mp-stamp">Обновлено в {formatTime(info()?.at ?? null)}</p>
          </Show>
        </div>
      </Show>
    </Card>
  )
}
