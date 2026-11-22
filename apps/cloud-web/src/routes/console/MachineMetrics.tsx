import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import { Button, Card, Dialog, Skeleton } from '@/components'
import { api } from '@/lib/api'
import type { MetricsInfo, NetworkCheck, ProcessInfo } from '@/lib/api'
import { formatBytes, formatTime } from '@/lib/format'

import { errorText } from './components/console-ui'

import './machine-panels.css'

const METRICS_MS = 5000
const PROCESSES_MS = 10000
const NETWORK_MS = 30000
const TOP_PROCESSES = 8
const HISTORY_LIMIT = 20

const URL_SECRET = /\b(?:https?|wss?):\/\/[^\s<>"']+/gi
const NAMED_SECRET = /\b(token|secret|password|passwd|api[_-]?key|key)=[^\s,&;]+/gi

/** Customer-visible text never names the vendor: the home path is `~`, the account is rox. */
function readable(text: string): string {
  return text
    .replace(/\/home\/(?:daytona|rox)(?=\/|$)/g, '~')
    .replace(/daytona/gi, 'rox')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The server's own words, with any address or named secret cut out. */
function safeError(err: unknown): string {
  return readable(
    errorText(err).replace(URL_SECRET, '[адрес скрыт]').replace(NAMED_SECRET, '$1=скрыт'),
  )
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

interface NetworkSample {
  at: number | null
  online: boolean
  downloadMbps: number
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
 * What the machine is doing right now: three bars refreshed every five seconds,
 * the eight busiest processes every ten seconds, and an honest egress check
 * every thirty seconds. Each section owns its timer and its last good answer, so
 * one failed call only dims that line instead of blanking the whole card.
 */
export default function MachineMetrics(props: MachineMetricsProps): JSX.Element {
  const [info, setInfo] = createSignal<MetricsInfo | null>(null)
  const [metricsFailure, setMetricsFailure] = createSignal<string | null>(null)
  const [metricsLoading, setMetricsLoading] = createSignal(true)

  const [processes, setProcesses] = createSignal<ProcessInfo[] | null>(null)
  const [processesAt, setProcessesAt] = createSignal<number | null>(null)
  const [processesFailure, setProcessesFailure] = createSignal<string | null>(null)
  const [processesLoading, setProcessesLoading] = createSignal(true)

  const [network, setNetwork] = createSignal<NetworkCheck | null>(null)
  const [history, setHistory] = createSignal<NetworkSample[]>([])
  const [networkFailure, setNetworkFailure] = createSignal<string | null>(null)
  const [networkLoading, setNetworkLoading] = createSignal(true)

  const [killTarget, setKillTarget] = createSignal<ProcessInfo | null>(null)
  const [killing, setKilling] = createSignal(false)
  const [killFailure, setKillFailure] = createSignal<string | null>(null)

  let metricsTimer: number | undefined
  let processesTimer: number | undefined
  let networkTimer: number | undefined
  let metricsToken = 0
  let processesToken = 0
  let networkToken = 0

  const stopTimers = (): void => {
    if (metricsTimer !== undefined) {
      window.clearInterval(metricsTimer)
      metricsTimer = undefined
    }
    if (processesTimer !== undefined) {
      window.clearInterval(processesTimer)
      processesTimer = undefined
    }
    if (networkTimer !== undefined) {
      window.clearInterval(networkTimer)
      networkTimer = undefined
    }
  }

  const loadMetrics = async (): Promise<void> => {
    if (!props.enabled || props.sandboxId.length === 0) return
    const id = props.sandboxId
    const mine = ++metricsToken
    try {
      const next = await api.metrics(id)
      if (mine !== metricsToken) return
      setInfo(next)
      setMetricsFailure(null)
    } catch (err) {
      if (mine !== metricsToken) return
      setMetricsFailure(safeError(err))
    } finally {
      if (mine === metricsToken) setMetricsLoading(false)
    }
  }

  const loadProcesses = async (): Promise<void> => {
    if (!props.enabled || props.sandboxId.length === 0) return
    const id = props.sandboxId
    const mine = ++processesToken
    try {
      const rows = await api.processes(id)
      if (mine !== processesToken) return
      const top = [...rows]
        .sort((left, right) => (right.cpuPercent || 0) - (left.cpuPercent || 0))
        .slice(0, TOP_PROCESSES)
      setProcesses(top)
      setProcessesAt(Date.now())
      setProcessesFailure(null)
    } catch (err) {
      if (mine !== processesToken) return
      setProcessesFailure(safeError(err))
    } finally {
      if (mine === processesToken) setProcessesLoading(false)
    }
  }

  const loadNetwork = async (): Promise<void> => {
    if (!props.enabled || props.sandboxId.length === 0) return
    const id = props.sandboxId
    const mine = ++networkToken
    try {
      const next = await api.networkCheck(id)
      if (mine !== networkToken) return
      setNetwork(next)
      setNetworkFailure(null)
      const sample: NetworkSample = {
        at: Number.isFinite(next.at) ? next.at : null,
        online: next.online,
        downloadMbps: Number.isFinite(next.downloadMbps) ? Math.max(0, next.downloadMbps) : 0,
      }
      setHistory((previous) => [...previous, sample].slice(-HISTORY_LIMIT))
    } catch (err) {
      if (mine !== networkToken) return
      setNetworkFailure(safeError(err))
    } finally {
      if (mine === networkToken) setNetworkLoading(false)
    }
  }

  createEffect(
    on(
      () => `${props.sandboxId}\u0000${props.enabled ? '1' : '0'}`,
      () => {
        stopTimers()
        // Answers for the previous machine or state must not paint over this one.
        metricsToken += 1
        processesToken += 1
        networkToken += 1
        setInfo(null)
        setMetricsFailure(null)
        setMetricsLoading(false)
        setProcesses(null)
        setProcessesAt(null)
        setProcessesFailure(null)
        setProcessesLoading(false)
        setNetwork(null)
        setHistory([])
        setNetworkFailure(null)
        setNetworkLoading(false)
        setKillTarget(null)
        setKilling(false)
        setKillFailure(null)
        if (!props.enabled || props.sandboxId.length === 0) return
        setMetricsLoading(true)
        setProcessesLoading(true)
        setNetworkLoading(true)
        void loadMetrics()
        void loadProcesses()
        void loadNetwork()
        metricsTimer = window.setInterval(() => void loadMetrics(), METRICS_MS)
        processesTimer = window.setInterval(() => void loadProcesses(), PROCESSES_MS)
        networkTimer = window.setInterval(() => void loadNetwork(), NETWORK_MS)
      },
    ),
  )
  onCleanup(stopTimers)

  const topProcesses = createMemo<ProcessInfo[]>(() => processes() ?? [])

  const historyScale = createMemo<number>(() => {
    let peak = 0
    for (const sample of history()) {
      if (sample.online && Number.isFinite(sample.downloadMbps)) {
        peak = Math.max(peak, sample.downloadMbps)
      }
    }
    return peak > 0 ? peak : 1
  })

  const historySummary = createMemo<string>(() => {
    const rows = history()
    if (rows.length === 0) return ''
    const online = rows.filter((sample) => sample.online).length
    return rows.length === 1 ? 'История начнётся со второго замера.' : `Связь: ${online} из ${rows.length} замеров.`
  })

  const sampleHeight = (sample: NetworkSample): string => {
    if (!sample.online) return '8%'
    const share = (sample.downloadMbps / historyScale()) * 100
    return `${Math.max(10, Math.min(100, Math.round(share)))}%`
  }

  const askKill = (process: ProcessInfo): void => {
    if (process.pid <= 1 || killing()) return
    setKillFailure(null)
    setKillTarget(process)
  }

  const closeKill = (): void => {
    if (killing()) return
    setKillTarget(null)
    setKillFailure(null)
  }

  const confirmKill = async (): Promise<void> => {
    const target = killTarget()
    if (target === null || killing()) return
    const id = props.sandboxId
    if (id.length === 0) return
    setKilling(true)
    setKillFailure(null)
    try {
      await api.killProcess(id, target.pid)
      setKilling(false)
      setKillTarget(null)
      await loadProcesses()
    } catch (err) {
      setKilling(false)
      setKillFailure(safeError(err))
      // The list may already be stale if the process died between calls.
      await loadProcesses()
    }
  }

  return (
    <Card
      title="Нагрузка"
      subtitle={
        props.enabled
          ? 'Процессор, память и диск — каждые 5 секунд, процессы — каждые 10, связь — каждые 30.'
          : 'Показатели снимаются только с запущенной машины.'
      }
    >
      <Show when={!props.enabled}>
        <p class="mp-note">
          Машина не запущена, поэтому нагрузки, процессов и связи нет. Запустите её — здесь появятся
          три полосы, список процессов и проверка связи.
        </p>
      </Show>

      <Show when={props.enabled}>
        <div class="mp-stack">
          <section class="mp-block" aria-label="Процессор, память и диск">
            <Show
              when={info()}
              fallback={
                <Show
                  when={metricsLoading()}
                  fallback={<p class="mp-note">Показатели ещё не пришли.</p>}
                >
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

            <Show when={metricsFailure() !== null}>
              <p class="mp-error-quiet" role="status">
                Нагрузка не обновилась: {metricsFailure()}. Полосы останутся на прежнем замере.
              </p>
            </Show>

            <Show when={info()?.at != null && metricsFailure() === null}>
              <p class="mp-stamp">Обновлено в {formatTime(info()?.at ?? null)}</p>
            </Show>
          </section>

          <section class="mp-block" aria-label="Процессы">
            <div class="mp-block-head">
              <span class="mp-block-title">Процессы</span>
              <span class="mp-block-meta">
                {processesAt() === null
                  ? 'каждые 10 секунд'
                  : `обновлено в ${formatTime(processesAt())}`}
              </span>
            </div>

            <Show
              when={processes()}
              fallback={
                <Show
                  when={processesLoading()}
                  fallback={<p class="mp-note">Список процессов ещё не пришёл.</p>}
                >
                  <Skeleton lines={4} />
                </Show>
              }
            >
              <Show
                when={topProcesses().length > 0}
                fallback={<p class="mp-note">Сейчас на машине не видно ни одного процесса.</p>}
              >
                <div class="mp-proc" role="table" aria-label="Самые нагруженные процессы">
                  <div class="mp-proc-row mp-proc-head" role="row">
                    <span class="mp-proc-pid" role="columnheader">
                      PID
                    </span>
                    <span class="mp-proc-user" role="columnheader">
                      пользователь
                    </span>
                    <span class="mp-proc-cpu" role="columnheader">
                      ЦП
                    </span>
                    <span class="mp-proc-mem" role="columnheader">
                      память
                    </span>
                    <span class="mp-proc-cmd sr-only" role="columnheader">
                      команда
                    </span>
                    <span class="mp-proc-action" role="columnheader">
                      <span class="sr-only">действие</span>
                    </span>
                  </div>
                  <For each={topProcesses()}>
                    {(process) => (
                      <div class="mp-proc-row" role="row">
                        <span class="mp-proc-pid" role="cell">
                          {process.pid}
                        </span>
                        <span class="mp-proc-user" role="cell" title={readable(process.user)}>
                          {process.user.trim() === '' ? '—' : readable(process.user)}
                        </span>
                        <span class="mp-proc-cpu" role="cell">
                          {Number.isFinite(process.cpuPercent) && process.cpuPercent >= 0
                            ? `${Math.round(process.cpuPercent)}%`
                            : '—'}
                        </span>
                        <span class="mp-proc-mem" role="cell">
                          {formatBytes(process.memoryKb * 1024)}
                        </span>
                        <span class="mp-proc-cmd" role="cell" title={readable(process.command)}>
                          {process.command.trim() === '' ? '—' : readable(process.command)}
                        </span>
                        <span class="mp-proc-action" role="cell">
                          <button
                            type="button"
                            class="mp-proc-kill"
                            disabled={process.pid <= 1}
                            title={
                              process.pid <= 1
                                ? 'Эту службу машины завершить нельзя'
                                : `Завершить процесс ${process.pid}`
                            }
                            onClick={() => askKill(process)}
                          >
                            Завершить
                          </button>
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>

            <Show when={processesFailure() !== null}>
              <p class="mp-error-quiet" role="status">
                Список процессов не обновился: {processesFailure()}. Показаны прежние строки.
              </p>
            </Show>
          </section>

          <section class="mp-block" aria-label="Связь">
            <div class="mp-block-head">
              <span class="mp-block-title">Связь</span>
              <span class="mp-block-meta">каждые 30 секунд</span>
            </div>

            <Show
              when={network()}
              fallback={
                <Show
                  when={networkLoading()}
                  fallback={<p class="mp-note">Проверка связи ещё не пришла.</p>}
                >
                  <Skeleton lines={2} />
                </Show>
              }
            >
              {(check) => (
                <div class="mp-net">
                  <div class="mp-net-line">
                    <span class="mp-net-state" data-online={check().online ? '1' : '0'}>
                      <span class="mp-net-dot" aria-hidden="true" />
                      {check().online ? 'есть связь' : 'нет связи'}
                    </span>
                    <span class="mp-net-fact">
                      Задержка:{' '}
                      {!check().online || !Number.isFinite(check().latencyMs)
                        ? '—'
                        : `${Math.round(check().latencyMs)} мс`}
                    </span>
                    <span class="mp-net-fact">
                      Скачивание:{' '}
                      {!check().online || !Number.isFinite(check().downloadMbps)
                        ? '—'
                        : `${check().downloadMbps.toFixed(1).replace('.', ',')} Мбит/с`}
                    </span>
                  </div>

                  <Show when={check().note}>
                    {(note) => <p class="mp-note">{readable(note())}</p>}
                  </Show>

                  <Show when={history().length > 0}>
                    <div class="mp-hist" aria-hidden="true">
                      <For each={history()}>
                        {(sample) => (
                          <span
                            class="mp-hist-bar"
                            data-online={sample.online ? '1' : '0'}
                            style={{ height: sampleHeight(sample) }}
                          />
                        )}
                      </For>
                    </div>
                  </Show>

                  <div class="mp-net-foot">
                    <span class="mp-stamp">
                      {check().at === null
                        ? 'Время замера неизвестно'
                        : `Обновлено в ${formatTime(check().at)}`}
                    </span>
                    <Show when={historySummary() !== ''}>
                      <span class="mp-stamp">{historySummary()}</span>
                    </Show>
                  </div>
                </div>
              )}
            </Show>

            <Show when={networkFailure() !== null}>
              <p class="mp-error-quiet" role="status">
                Связь не проверена: {networkFailure()}. Остался прошлый замер.
              </p>
            </Show>
          </section>
        </div>
      </Show>

      <Dialog
        open={killTarget() !== null}
        onClose={closeKill}
        closeOnBackdrop={!killing()}
        title="Завершить процесс?"
        subtitle={
          killTarget() === null
            ? undefined
            : `PID ${killTarget()?.pid}, пользователь ${readable(killTarget()?.user ?? '')}`
        }
        footer={
          <>
            <Button variant="ghost" disabled={killing()} onClick={closeKill}>
              Отмена
            </Button>
            <Button
              variant="danger"
              loading={killing()}
              disabled={killTarget() === null}
              onClick={() => void confirmKill()}
            >
              Завершить
            </Button>
          </>
        }
      >
        <p>
          Процесс получит сигнал остановки. Несохранённая работа этого процесса пропадёт, а службы
          самой машины завершить нельзя.
        </p>
        <Show when={killTarget()}>
          {(target) => (
            <p class="mp-kill-cmd" title={readable(target().command)}>
              {readable(target().command)}
            </p>
          )}
        </Show>
        <Show when={killFailure() !== null}>
          <p class="mp-error-quiet" role="alert">
            Процесс не завершился: {killFailure()}.
          </p>
        </Show>
      </Dialog>
    </Card>
  )
}
