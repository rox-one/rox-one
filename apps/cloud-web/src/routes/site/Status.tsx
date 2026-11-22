import { A } from '@solidjs/router'
import { For, Show, createSignal, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import { Badge, CodeBlock, PageHeader } from '@/components'
import { ApiError, api } from '@/lib/api'
import type { IncidentSeverity, IncidentStatus, PublicIncident } from '@/lib/api'
import { formatDate } from '@/lib/format'
import './status.css'

type ProbeState = 'checking' | 'ok' | 'down'
type IncidentsState = 'loading' | 'ok' | 'failed'

const SEVERITY_LABEL: Readonly<Record<IncidentSeverity, string>> = {
  minor: 'небольшое',
  major: 'серьёзное',
  critical: 'критическое',
}

const INCIDENT_LABEL: Readonly<Record<IncidentStatus, string>> = {
  investigating: 'разбираемся',
  identified: 'причина найдена',
  monitoring: 'наблюдаем',
  resolved: 'решено',
}

const PROVIDERS: readonly { name: string; href: string; note: string }[] = [
  { name: 'Daytona', href: 'https://status.app.daytona.io/', note: 'Официальная страница состояния Daytona.' },
  { name: 'Modal', href: 'https://status.modal.com/', note: 'Официальная страница состояния Modal.' },
  { name: 'E2B', href: 'https://status.e2b.dev/', note: 'Официальная страница состояния E2B.' },
]

export default function SiteStatus(): JSX.Element {
  const [probe, setProbe] = createSignal<ProbeState>('checking')
  const [latencyMs, setLatencyMs] = createSignal<number | null>(null)
  const [checkedAt, setCheckedAt] = createSignal<Date | null>(null)
  const [probeReason, setProbeReason] = createSignal('')
  const [address, setAddress] = createSignal('/health')

  const [incidents, setIncidents] = createSignal<readonly PublicIncident[]>([])
  const [incidentsState, setIncidentsState] = createSignal<IncidentsState>('loading')
  const [incidentsError, setIncidentsError] = createSignal('')

  async function checkApi(): Promise<void> {
    setProbe('checking')
    setProbeReason('')
    setLatencyMs(null)
    const started = performance.now()
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 6000)
    try {
      const response = await fetch('/health', {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
      const body = await response.text()
      let healthy = false
      try {
        const parsed: unknown = JSON.parse(body)
        healthy =
          response.ok &&
          typeof parsed === 'object' &&
          parsed !== null &&
          'ok' in parsed &&
          parsed.ok === true
      } catch {
        healthy = false
      }
      setCheckedAt(new Date())
      if (healthy) {
        setProbe('ok')
        setLatencyMs(Math.round(performance.now() - started))
      } else {
        setProbe('down')
        setProbeReason(
          response.ok
            ? 'Ответ пришёл, но это не /health: проверьте адрес API.'
            : `Ответ /health пришёл с кодом ${response.status}.`,
        )
      }
    } catch (error) {
      setCheckedAt(new Date())
      setProbe('down')
      setProbeReason(
        error instanceof Error && error.name === 'AbortError'
          ? 'Истекло время ожидания: за шесть секунд ответа не было.'
          : 'Запрос закрыт: сеть недоступна или браузер запретил соединение.',
      )
    } finally {
      window.clearTimeout(timer)
    }
  }

  async function loadIncidents(): Promise<void> {
    setIncidentsState('loading')
    setIncidentsError('')
    try {
      const payload = await api.status()
      setIncidents(Array.isArray(payload?.incidents) ? payload.incidents : [])
      setIncidentsState('ok')
    } catch (error) {
      setIncidents([])
      setIncidentsState('failed')
      if (error instanceof ApiError && error.code === 'network_error') {
        setIncidentsError('сервер не отвечает')
      } else if (error instanceof Error) {
        setIncidentsError(error.message)
      } else {
        setIncidentsError('ответа нет')
      }
    }
  }

  function refresh(): void {
    void checkApi()
    void loadIncidents()
  }

  onMount(() => {
    setAddress(`${location.origin.replace(/\/+$/, '')}/health`)
    refresh()
  })

  return (
    <div class="page status-page">
      <PageHeader
        eyebrow="Состояние"
        title="Состояние Rox Cloud"
        description="Эта страница проверяет /health Rox Cloud API прямо из вашего браузера и показывает живые происшествия из /v1/status. Состояние поставщиков она не пересказывает — для этого есть их собственные страницы."
        actions={
          <>
            <a class="btn btn-secondary" href="/docs">
              Как читать отказы
            </a>
            <A class="btn btn-primary" href="/console?guest=1">
              Запустить машину
            </A>
          </>
        }
      />

      <section class="site-section" aria-labelledby="probe-title">
        <div class="site-section-head">
          <p class="site-eyebrow">Проверка</p>
          <h2 class="site-title" id="probe-title">
            API и его ответ
          </h2>
          <p class="site-lede">
            Проверка идёт с этой страницы и ничего не кэширует. Сайт остаётся читаемым, даже когда API
            молчит: цены и документация посчитаны локально.
          </p>
        </div>

        <div class="status-probe" data-state={probe()}>
          <div class="status-probe-main">
            <span class="status-dot" aria-hidden="true" />
            <div class="status-probe-text">
              <p class="status-probe-title" role="status" aria-live="polite">
                {probe() === 'checking'
                  ? 'Проверяем API…'
                  : probe() === 'ok'
                    ? 'API отвечает'
                    : 'API не отвечает'}
              </p>
              <Show when={probe() === 'ok'}>
                <p class="status-probe-detail">
                  Ответ <code>/health</code> получен за {latencyMs() ?? 0} мс. Проверка:{' '}
                  {formatDate(checkedAt())}.
                </p>
              </Show>
              <Show when={probe() === 'checking'}>
                <p class="status-probe-detail">
                  Запрос <code>/health</code> отправлен с этой страницы.
                </p>
              </Show>
              <Show when={probe() === 'down'}>
                <p class="status-probe-detail">
                  {probeReason()} Время проверки: {formatDate(checkedAt())}.
                </p>
              </Show>
            </div>
          </div>
          <button type="button" class="btn btn-secondary" onClick={refresh} disabled={probe() === 'checking'}>
            Проверить снова
          </button>
        </div>

        <Show when={probe() === 'down'}>
          <div class="status-down">
            <h3 class="status-down-title">Что это значит</h3>
            <p>
              Кабинет, запуск машин и список происшествий сейчас не работают: им нужен тот же API.
              Цены, документация и эта страница открываются, потому что считаются в браузере.
            </p>
            <p>
              «API не отвечает» — это ответ из вашего браузера, а не приговор сервису. Причина может
              быть в остановленном процессе, другом адресе или закрытой сети. Проверьте тот же адрес
              командой ниже; если и она молчит — дело не в странице.
            </p>
          </div>
        </Show>

        <p class="status-address">
          Адрес проверки: <code>{address()}</code>
        </p>
        <CodeBlock
          label="Проверка из терминала"
          code={`curl -sS "$ROX_API_URL/health"
# {"ok":true}

curl -sS "$ROX_API_URL/v1/status"
# {"incidents":[]}`}
        />
      </section>

      <section class="site-section" aria-labelledby="incidents-title">
        <div class="site-section-head">
          <p class="site-eyebrow">Происшествия</p>
          <h2 class="site-title" id="incidents-title">
            Живые происшествия
          </h2>
          <p class="site-lede">
            Публичный список показывает только то, что ещё не закрыто: название, короткое объяснение,
            важность, состояние и время обновления. Ни клиентов, ни ключей, ни внутренних заметок здесь
            нет.
          </p>
        </div>

        <Show when={incidentsState() === 'loading'}>
          <p class="status-incidents-note" role="status" aria-live="polite">
            Запрашиваем /v1/status…
          </p>
        </Show>

        <Show when={incidentsState() === 'failed'}>
          <div class="status-incidents-failed">
            <h3 class="status-failed-title">Список происшествий недоступен</h3>
            <p>
              Запрос <code>/v1/status</code> не прошёл. Это не значит, что происшествий нет — значит,
              что их сейчас не видно. Причина: <span class="status-failed-reason">{incidentsError()}</span>
            </p>
            <button type="button" class="btn btn-secondary btn-sm" onClick={() => void loadIncidents()}>
              Повторить запрос
            </button>
          </div>
        </Show>

        <Show when={incidentsState() === 'ok' && incidents().length === 0}>
          <div class="status-incidents-empty">
            <p class="status-empty-title">Происшествий нет</p>
            <p>Решённые случаи со страницы уходят, поэтому здесь остаются только живые.</p>
          </div>
        </Show>

        <Show when={incidentsState() === 'ok' && incidents().length > 0}>
          <ul class="incident-list">
            <For each={incidents()}>
              {(incident) => (
                <li class="incident-card">
                  <div class="incident-head">
                    <h3 class="incident-title">{incident.title}</h3>
                    <div class="incident-badges">
                      <Badge
                        tone={
                          incident.severity === 'critical'
                            ? 'danger'
                            : incident.severity === 'major'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {SEVERITY_LABEL[incident.severity] ?? incident.severity}
                      </Badge>
                      <Badge tone={incident.status === 'monitoring' ? 'accent' : 'warning'} dot>
                        {INCIDENT_LABEL[incident.status] ?? incident.status}
                      </Badge>
                    </div>
                  </div>
                  <p class="incident-summary">{incident.public_summary}</p>
                  <p class="incident-time">Обновлено: {formatDate(incident.updated_at)}</p>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section class="site-section" aria-labelledby="providers-title">
        <div class="site-section-head">
          <p class="site-eyebrow">Поставщики</p>
          <h2 class="site-title" id="providers-title">
            Где смотреть площадки поставщиков
          </h2>
          <p class="site-lede">
            Машины работают на площадках поставщиков. Их состояние Rox не копирует и не подставляет свои
            адреса: ссылки ведут на официальные страницы. Сейчас запуск идёт на Daytona и только для
            Linux; Windows и H100 — по запросу, пока у организации нет класса и кредитов GPU.
          </p>
        </div>
        <ul class="provider-links">
          <For each={PROVIDERS}>
            {(provider) => (
              <li class="provider-link">
                <div>
                  <p class="provider-name">{provider.name}</p>
                  <p class="provider-note">{provider.note}</p>
                </div>
                <a
                  class="btn btn-secondary btn-sm"
                  href={provider.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Открыть страницу {provider.name}
                </a>
              </li>
            )}
          </For>
        </ul>
        <p class="site-note site-note--plain">
          <strong>Если поставщик недоступен,</strong> Rox вернёт <code>provider_error</code> с номером
          запроса — назовите его поддержке. Ключи и заголовок Authorization в журнал не попадают, и
          пересылать их при разборе не нужно.
        </p>
      </section>

      <section class="site-section" aria-labelledby="meaning-title">
        <div class="site-section-head">
          <p class="site-eyebrow">Что считается ответом</p>
          <h2 class="site-title" id="meaning-title">
            Как читать эту страницу
          </h2>
        </div>
        <ul class="site-list">
          <li>
            <strong>API отвечает</strong> — на <code>/health</code> пришёл код 200 с телом{' '}
            <code>{'{"ok":true}'}</code>. Время проверки и задержка показаны рядом.
          </li>
          <li>
            <strong>API не отвечает</strong> — ответа нет за шесть секунд, пришёл другой код или браузер
            закрыл запрос. Это проверка из браузера, а не общий статус сервиса.
          </li>
          <li>
            <strong>Происшествия</strong> — из <code>/v1/status</code>, без ключа. Если этот запрос не
            прошёл, страница честно пишет, что список недоступен, и не выдаёт пустоту за «всё хорошо».
          </li>
          <li>Страница не проверяет поставщиков, кошелёк и отдельные машины: для этого есть кабинет и журнал.</li>
        </ul>
      </section>

      <section class="site-cta-band" aria-labelledby="status-cta">
        <div>
          <h2 id="status-cta">Нужна машина, а не отчёт?</h2>
          <p>Пробный счёт открывается без карты и пароля.</p>
        </div>
        <div class="site-cta-actions">
          <A class="btn btn-primary" href="/console?guest=1">
            Запустить машину
          </A>
          <A class="btn btn-secondary" href="/docs">
            Документация
          </A>
        </div>
      </section>
    </div>
  )
}
