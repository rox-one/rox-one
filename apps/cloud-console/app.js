'use strict'

/* Rox Cloud console: plain browser JavaScript, no build step, no dependencies.
 * The API key lives in sessionStorage only and never reaches the address bar
 * or a log line. Every request error is rendered with its server message,
 * code and request id. */

const DEFAULT_BASE = location.pathname.startsWith('/console') ? location.origin : 'http://localhost:8787'
const DEFAULT_ORG = 'Моя команда'
const SESSION_KEY = 'rox_cloud_key'
const LOCAL_BASE = 'rox_cloud_base'
const LOCAL_NAME = 'rox_cloud_name'
const REQUEST_TIMEOUT_MS = 20000
const POLL_MS = 5000

const TERMINAL_STATES = new Set(['stopped', 'failed', 'expired'])
const STATE_LABELS = {
  queued: 'в очереди',
  starting: 'запускается',
  running: 'работает',
  paused: 'на паузе',
  stopped: 'остановлена',
  stopping: 'останавливается',
  failed: 'ошибка',
  expired: 'истекла',
}

const state = {
  base: readLocal(LOCAL_BASE) || DEFAULT_BASE,
  key: readSession(SESSION_KEY) || '',
  connected: false,
  org: readLocal(LOCAL_NAME) || DEFAULT_ORG,
  view: 'overview',
  usage: null,
  account: null,
  sandboxes: null,
  keys: null,
  credentials: null,
  catalogProviders: [],
  providersMissing: false,
  providersError: null,
  journal: [],
  errors: [],
  lastOk: null,
  pollTimer: null,
  expiring: false,
  terminalSandbox: null,
}

const $ = (id) => document.getElementById(id)

/* ---------- storage (never throws in private mode) ---------- */

function readSession(name) {
  try {
    return sessionStorage.getItem(name)
  } catch {
    return null
  }
}

function writeSession(name, value) {
  try {
    sessionStorage.setItem(name, value)
  } catch {
    /* storage unavailable; the session simply is not remembered */
  }
}

function removeSession(name) {
  try {
    sessionStorage.removeItem(name)
  } catch {
    /* ignore */
  }
}

function readLocal(name) {
  try {
    return localStorage.getItem(name)
  } catch {
    return null
  }
}

function writeLocal(name, value) {
  try {
    localStorage.setItem(name, value)
  } catch {
    /* ignore */
  }
}

/* ---------- formatting ---------- */

function esc(value) {
  return String(value === null || value === undefined ? '—' : value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  )
}

function display(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatUsd(value) {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${number.toFixed(2).replace('.', ',')} $`
}

function formatMoney(cents) {
  const number = Number(cents)
  if (!Number.isFinite(number)) return '—'
  return `${(number / 100).toFixed(2).replace('.', ',')} $`
}

function formatTime(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function remaining(iso) {
  if (!iso) return '—'
  const end = new Date(iso).getTime()
  if (!Number.isFinite(end)) return '—'
  const seconds = Math.round((end - Date.now()) / 1000)
  if (seconds <= 0) return 'истекла'
  if (seconds < 60) return `осталось ${seconds} с`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `осталось ${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `осталось ${hours} ч ${rest} мин` : `осталось ${hours} ч`
}

function shortId(id) {
  const text = String(id || '')
  if (text.startsWith('sbx_')) return `sbx_${text.slice(4, 12)}`
  return text.length > 14 ? `${text.slice(0, 14)}…` : text
}

function sandboxCost(sandbox) {
  if (sandbox.cost_so_far_usd !== undefined && sandbox.cost_so_far_usd !== null) {
    return formatUsd(sandbox.cost_so_far_usd)
  }
  if (typeof sandbox.cost_so_far_cents === 'number') return formatUsd(sandbox.cost_so_far_cents / 100)
  return '—'
}

function sumCents(rows) {
  return rows.reduce((sum, row) => {
    const cents = Number(row.cents)
    return sum + (Number.isFinite(cents) ? cents : 0)
  }, 0)
}

function isNonTerminal(sandbox) {
  return !TERMINAL_STATES.has(sandbox.state)
}

function formatError(error) {
  return `${error.message} (код ${error.code}, запрос ${error.requestId})`
}

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `rox-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/* ---------- HTTP ---------- */

function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, '')}${path}`
}

async function request(base, key, path, options = {}) {
  const headers = { Authorization: `Bearer ${key}` }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.idempotency) headers['Idempotency-Key'] = options.idempotency

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response
  try {
    response = await fetch(joinUrl(base, path), {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
  } catch {
    return {
      ok: false,
      error: {
        type: 'network_error',
        code: 'network_error',
        message: 'Сервер не отвечает',
        requestId: '—',
        status: 0,
      },
    }
  } finally {
    clearTimeout(timer)
  }

  const headerId = response.headers.get('x-request-id') || '—'
  let data = null
  if (response.status !== 204) {
    try {
      data = await response.json()
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    const envelope = data && data.error ? data.error : null
    return {
      ok: false,
      error: {
        type: envelope && envelope.type ? envelope.type : 'http_error',
        code: envelope && envelope.code ? envelope.code : `http_${response.status}`,
        message: envelope && envelope.message ? envelope.message : `Сервер ответил ${response.status}`,
        requestId: envelope && envelope.request_id ? envelope.request_id : headerId,
        status: response.status,
      },
    }
  }

  return { ok: true, status: response.status, data, requestId: headerId }
}

async function api(path, options = {}) {
  if (!state.connected || !state.key) {
    const error = {
      type: 'client_error',
      code: 'not_connected',
      message: 'Нет подключения к API',
      requestId: '—',
      status: 0,
    }
    state.lastOk = false
    pushError(error)
    renderStatus()
    renderErrors()
    return { ok: false, error }
  }

  const result = await request(state.base, state.key, path, options)
  if (result.ok) {
    state.lastOk = true
  } else {
    state.lastOk = false
    pushError(result.error)
    if (result.error.status === 401) expireSession()
  }
  renderStatus()
  renderErrors()
  return result
}

function pushError(error) {
  const signature = `${error.code}|${error.requestId}|${error.message}`
  if (state.errors.some((entry) => entry.signature === signature)) return
  state.errors.unshift({ ...error, signature, at: new Date() })
  if (state.errors.length > 4) state.errors.length = 4
}

/* ---------- session ---------- */

function showConnect(message) {
  $('shell').hidden = true
  $('connect-screen').hidden = false
  $('connect-base').value = state.base
  $('connect-key').value = ''
  const errorEl = $('connect-error')
  errorEl.textContent = message || ''
  errorEl.hidden = !message
  state.errors = []
  renderErrors()
  $('connect-key').focus()
}

function expireSession() {
  if (state.expiring) return
  state.expiring = true
  removeSession(SESSION_KEY)
  state.key = ''
  state.connected = false
  stopPoll()
  state.usage = null
  state.sandboxes = null
  state.keys = null
  state.credentials = null
  state.providersMissing = false
  state.providersError = null
  showConnect('Ключ не подошёл')
  state.expiring = false
}

function logout() {
  removeSession(SESSION_KEY)
  state.key = ''
  state.connected = false
  stopPoll()
  state.usage = null
  state.sandboxes = null
  state.keys = null
  state.credentials = null
  state.providersMissing = false
  state.providersError = null
  state.lastOk = null
  state.errors = []
  state.view = 'overview'
  showConnect('')
  renderAll()
}

async function connect(event) {
  event.preventDefault()
  const errorEl = $('connect-error')
  errorEl.hidden = true
  const baseRaw = $('connect-base').value.trim()
  const key = $('connect-key').value.trim()

  if (!key) {
    errorEl.textContent = 'Введите ключ API.'
    errorEl.hidden = false
    $('connect-key').focus()
    return
  }
  if (!/^https?:\/\/\S+$/i.test(baseRaw)) {
    errorEl.textContent = 'Адрес API должен начинаться с http:// или https://'
    errorEl.hidden = false
    $('connect-base').focus()
    return
  }

  const base = baseRaw.replace(/\/+$/, '')
  const button = $('connect-submit')
  button.disabled = true
  button.textContent = 'Проверяем…'

  const result = await request(base, key, '/v1/catalog')

  button.disabled = false
  button.textContent = 'Подключиться'

  if (!result.ok) {
    const error = result.error
    if (error.status === 401) errorEl.textContent = 'Ключ не подошёл'
    else if (error.code === 'network_error') errorEl.textContent = 'Сервер не отвечает'
    else errorEl.textContent = formatError(error)
    errorEl.hidden = false
    return
  }

  state.base = base
  state.key = key
  state.connected = true
  state.errors = []
  state.lastOk = true
  writeSession(SESSION_KEY, key)
  writeLocal(LOCAL_BASE, base)
  $('connect-key').value = ''
  $('connect-error').hidden = true
  $('connect-screen').hidden = true
  $('shell').hidden = false
  renderStatus()
  renderErrors()
  await startSession()
}

async function startSession() {
  setView(state.view)
  await Promise.all([loadCatalog(), loadUsage(), loadSandboxes(), loadKeys(), loadCredentials(), loadAccount()])
  renderAll()
  ensurePoll()
}

/* ---------- data loads ---------- */

async function loadCatalog() {
  const result = await api('/v1/catalog')
  if (result.ok && result.data && Array.isArray(result.data.providers)) {
    state.catalogProviders = result.data.providers
      .map((provider) => provider && provider.id)
      .filter((id) => typeof id === 'string' && id.length > 0)
  }
}

async function loadUsage() {
  const result = await api('/v1/usage')
  if (result.ok && result.data && Array.isArray(result.data.data)) {
    state.usage = result.data.data
  }
}

async function loadAccount() {
  const result = await api('/v1/account')
  if (result.ok && result.data) state.account = result.data
}

async function loadSandboxes() {
  const result = await api('/v1/sandboxes?limit=50')
  if (result.ok && result.data && Array.isArray(result.data.data)) {
    state.sandboxes = result.data.data
  }
}

async function loadKeys() {
  const result = await api('/v1/keys')
  if (result.ok && result.data && Array.isArray(result.data.data)) {
    state.keys = result.data.data
  }
}

async function loadCredentials() {
  const result = await api('/v1/provider-credentials')
  if (result.ok) {
    const payload = result.data
    const list = Array.isArray(payload) ? payload : payload && Array.isArray(payload.data) ? payload.data : []
    state.credentials = list
    state.providersMissing = false
    state.providersError = null
  } else if (result.error.status === 404) {
    state.providersMissing = true
    state.providersError = result.error
    state.credentials = null
  }
}

/* ---------- journal ---------- */

function addJournal(text, ok = true) {
  state.journal.unshift({ at: new Date(), text, ok })
  if (state.journal.length > 200) state.journal.length = 200
  renderJournal()
}

/* ---------- polling ---------- */

function ensurePoll() {
  if (!state.connected) {
    stopPoll()
    return
  }
  const active = (state.sandboxes || []).some(isNonTerminal)
  if (!active) {
    stopPoll()
  } else if (!state.pollTimer) {
    state.pollTimer = setInterval(pollSandboxes, POLL_MS)
  }
  renderSandboxes()
}

function stopPoll() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer)
    state.pollTimer = null
  }
}

async function pollSandboxes() {
  if (!state.connected || !state.key) {
    stopPoll()
    return
  }
  const result = await api('/v1/sandboxes?limit=50')
  if (result.ok && result.data && Array.isArray(result.data.data)) {
    state.sandboxes = result.data.data
    renderSandboxes()
    renderOverview()
    renderTopbar()
    if (!state.sandboxes.some(isNonTerminal)) stopPoll()
  }
}

/* ---------- rendering ---------- */

function renderAll() {
  renderStatus()
  renderErrors()
  renderTopbar()
  renderOverview()
  renderSandboxes()
  renderKeys()
  renderProviders()
  renderJournal()
  renderCurl()
}

function renderStatus() {
  const dot = $('state-dot')
  const text = $('state-text')
  const status = $('status')
  const failed = state.lastOk === false
  dot.classList.toggle('ok', state.lastOk === true)
  dot.classList.toggle('bad', failed)
  status.classList.toggle('bad', failed)
  if (state.lastOk === true) {
    text.textContent = 'Связь есть'
    status.title = 'Последний запрос выполнен'
  } else if (failed) {
    const error = state.errors[0]
    text.textContent = error ? error.message : 'Ошибка'
    status.title = error ? formatError(error) : ''
  } else {
    text.textContent = 'Ожидание'
    status.title = ''
  }
}

function renderErrors() {
  const banner = $('error-banner')
  if (state.errors.length === 0) {
    banner.hidden = true
    banner.replaceChildren()
    return
  }
  banner.hidden = false
  banner.replaceChildren()

  const list = document.createElement('ul')
  list.className = 'error-list'
  for (const error of state.errors) {
    const item = document.createElement('li')
    const message = document.createElement('span')
    message.className = 'error-message'
    message.textContent = error.message
    const meta = document.createElement('span')
    meta.className = 'error-meta'
    meta.textContent = `код: ${error.code} · запрос: ${error.requestId}`
    item.append(message, meta)
    list.append(item)
  }

  const hide = document.createElement('button')
  hide.type = 'button'
  hide.className = 'ghost small'
  hide.textContent = 'Скрыть'
  hide.addEventListener('click', () => {
    state.errors = []
    renderErrors()
  })

  banner.append(list, hide)
}

function renderTopbar() {
  const orgInput = $('org-name')
  if (document.activeElement !== orgInput) orgInput.value = state.org
  $('top-spend').textContent = state.usage ? formatMoney(sumCents(state.usage)) : '—'
}

function renderOverview() {
  $('ov-spend').textContent = state.usage ? formatMoney(sumCents(state.usage)) : '—'
  $('ov-running').textContent = state.sandboxes
    ? String(state.sandboxes.filter(isNonTerminal).length)
    : '—'
  $('ov-keys').textContent = state.keys ? String(state.keys.length) : '—'

  const account = state.account
  const note = $('ov-balance-note')
  if (!account) {
    $('ov-balance').textContent = '—'
    note.textContent = 'на счёте Rox, USD'
    note.classList.remove('warn')
    return
  }
  const balanceCents = Number(account.balance_cents)
  const rate = Number(account.rate_cents_per_hour) || 0
  $('ov-balance').textContent = formatMoney(balanceCents)
  if (rate > 0 && balanceCents < rate * 24) {
    note.textContent = `меньше суток по ставке ${formatMoney(rate)}/ч`
    note.classList.add('warn')
  } else {
    note.textContent = `резерв ${formatMoney(Number(account.reserved_cents) || 0)} · ставка ${formatMoney(rate)}/ч`
    note.classList.remove('warn')
  }
}

function renderCurl() {
  const base = String(state.base || DEFAULT_BASE).replace(/\/+$/, '')
  $('curl-example').textContent = [
    `curl -sS ${base}/v1/sandboxes \\`,
    '  -H "Authorization: Bearer $ROX_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    '  -H "Idempotency-Key: $(uuidgen)" \\',
    `  -d '{"os":"linux","cpu":2,"memoryGb":4,"ttlSec":60}'`,
  ].join('\n')
}

function renderSandboxes() {
  const body = $('sandboxes-body')
  const hint = $('sandboxes-hint')

  if (!state.sandboxes) {
    body.innerHTML = '<tr><td colspan="7" class="empty">Данных пока нет.</td></tr>'
    hint.textContent = ''
    return
  }
  if (state.sandboxes.length === 0) {
    body.innerHTML = '<tr><td colspan="7" class="empty">Песочниц пока нет. Нажмите «Создать».</td></tr>'
    hint.textContent = ''
    return
  }

  const rows = [...state.sandboxes]
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))
    .map((sandbox) => {
      const id = String(sandbox.id || '')
      const stateLabel = STATE_LABELS[sandbox.state] || sandbox.state || '—'
      const canStop = isNonTerminal(sandbox) && sandbox.state !== 'stopping'
      return `<tr>
  <td><code title="${esc(id)}">${esc(shortId(id))}</code></td>
  <td><span class="state state-${esc(sandbox.state || 'unknown')}">${esc(stateLabel)}</span></td>
  <td>${esc(display(sandbox.provider))}</td>
  <td>${esc(formatTime(sandbox.created_at))}</td>
  <td data-countdown="${esc(sandbox.expires_at || '')}">${esc(remaining(sandbox.expires_at))}</td>
  <td class="num">${esc(sandboxCost(sandbox))}</td>
  <td class="actions">
    <button type="button" class="ghost small" data-action="terminal" data-id="${esc(id)}">Терминал</button>
    ${canStop ? `<button type="button" class="ghost small" data-action="stop" data-id="${esc(id)}">Остановить</button>` : ''}
    <button type="button" class="ghost small" data-action="delete" data-id="${esc(id)}">Удалить</button>
  </td>
</tr>`
    })
    .join('')

  body.innerHTML = rows
  hint.textContent = state.sandboxes.some(isNonTerminal)
    ? 'Список обновляется каждые 5 секунд, пока есть незавершённые песочницы.'
    : 'Все песочницы в конечном состоянии — автообновление остановлено.'
}

function renderKeys() {
  const body = $('keys-body')
  if (!state.keys) {
    body.innerHTML = '<tr><td colspan="6" class="empty">Данных пока нет.</td></tr>'
    return
  }
  if (state.keys.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty">Ключей пока нет.</td></tr>'
    return
  }

  body.innerHTML = state.keys
    .map((key) => {
      const id = String(key.id || '')
      const lastUsed = key.last_used_at !== undefined ? key.last_used_at : key.last_used
      const scopes = Array.isArray(key.scopes) ? key.scopes.join(', ') : display(key.scopes)
      return `<tr>
  <td>${esc(display(key.name))}</td>
  <td><code>${esc(`${key.prefix || 'rox_sk_live_'}…${key.last4 || '—'}`)}</code></td>
  <td>${esc(scopes)}</td>
  <td>${esc(formatTime(key.created_at))}</td>
  <td>${esc(formatTime(lastUsed))}</td>
  <td class="actions">
    <button type="button" class="ghost small" data-key-action="revoke" data-id="${esc(id)}">Отозвать</button>
  </td>
</tr>`
    })
    .join('')
}

function renderProviders() {
  const body = $('providers-body')
  const notice = $('provider-notice')

  if (state.providersMissing && state.providersError) {
    notice.hidden = false
    notice.textContent = `Сервер ещё не принимает ключи поставщиков. ${formatError(state.providersError)}`
  } else {
    notice.hidden = true
    notice.textContent = ''
  }

  if (state.providersMissing) {
    body.innerHTML = '<tr><td colspan="6" class="empty">Список недоступен: сервер ещё не принимает ключи поставщиков.</td></tr>'
    return
  }
  if (!state.credentials) {
    body.innerHTML = '<tr><td colspan="6" class="empty">Данных пока нет.</td></tr>'
    return
  }
  if (state.credentials.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty">Ключей поставщиков пока нет.</td></tr>'
    return
  }

  body.innerHTML = state.credentials
    .map((credential) => {
      const id = String(credential.id || '')
      const last4 = credential.last4 ? `…${credential.last4}` : '—'
      return `<tr>
  <td>${esc(display(credential.provider))}</td>
  <td>${esc(display(credential.label))}</td>
  <td><code>${esc(last4)}</code></td>
  <td>${esc(display(credential.status))}</td>
  <td>${esc(display(credential.health))}</td>
  <td class="actions">
    <button type="button" class="ghost small" data-credential-action="promote" data-id="${esc(id)}">Сделать основным</button>
    <button type="button" class="ghost small" data-credential-action="disable" data-id="${esc(id)}">Отключить</button>
  </td>
</tr>`
    })
    .join('')
}

function renderJournal() {
  const list = $('journal-list')
  list.replaceChildren()
  for (const entry of state.journal) {
    const item = document.createElement('li')
    item.className = entry.ok ? 'journal-item' : 'journal-item bad'
    const time = document.createElement('span')
    time.className = 'journal-time'
    time.textContent = entry.at.toLocaleTimeString('ru-RU', { hour12: false })
    const text = document.createElement('span')
    text.className = 'journal-text'
    text.textContent = entry.text
    const result = document.createElement('span')
    result.className = 'journal-result'
    result.textContent = entry.ok ? 'ок' : 'ошибка'
    item.append(time, text, result)
    list.append(item)
  }
}

/* ---------- navigation ---------- */

function setView(view) {
  state.view = view
  document.querySelectorAll('.view').forEach((section) => {
    section.hidden = section.id !== `view-${view}`
  })
  document.querySelectorAll('.nav-item').forEach((button) => {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  })
  renderAll()
}

async function navigate(view) {
  setView(view)
  if (!state.connected) return
  if (view === 'overview') await Promise.all([loadUsage(), loadSandboxes(), loadAccount()])
  else if (view === 'sandboxes') await loadSandboxes()
  else if (view === 'keys') await loadKeys()
  else if (view === 'providers') await loadCredentials()
  renderAll()
  ensurePoll()
}

/* ---------- sandboxes ---------- */

function syncProviderOptions() {
  const select = $('create-provider')
  const current = select.value
  const options = ['<option value="">По умолчанию</option>']
  for (const provider of state.catalogProviders) {
    options.push(`<option value="${esc(provider)}">${esc(provider)}</option>`)
  }
  select.innerHTML = options.join('')
  if ([...select.options].some((option) => option.value === current)) select.value = current
}

function openCreateDialog(preset = {}) {
  syncProviderOptions()
  $('create-os').value = preset.os || 'linux'
  if (preset.ttlSec) $('create-ttl').value = String(preset.ttlSec)
  $('create-error').hidden = true
  $('create-error').textContent = ''
  const dialog = $('create-dialog')
  if (!dialog.open) dialog.showModal()
  $('create-cpu').focus()
}

function showCreateError(text) {
  $('create-error').textContent = text
  $('create-error').hidden = false
}

async function submitCreateSandbox(event) {
  event.preventDefault()
  const os = $('create-os').value
  const cpu = Number($('create-cpu').value)
  const memoryGb = Number($('create-memory').value)
  const ttlSec = Number($('create-ttl').value)
  const provider = $('create-provider').value

  if (!(cpu > 0) || !(memoryGb > 0) || !(ttlSec >= 1)) {
    showCreateError('Проверьте процессор, память и время жизни: нужны положительные числа.')
    return
  }

  const body = { os, cpu, memoryGb, ttlSec }
  if (provider) body.provider = provider

  const button = $('create-submit')
  button.disabled = true
  button.textContent = 'Создаём…'
  const result = await api('/v1/sandboxes', {
    method: 'POST',
    body,
    idempotency: newIdempotencyKey(),
  })
  button.disabled = false
  button.textContent = 'Создать'

  if (!result.ok) {
    showCreateError(formatError(result.error))
    addJournal(`Не удалось создать песочницу: ${result.error.message}`, false)
    return
  }

  addJournal(`Создана песочница ${shortId(result.data && result.data.id)}`, true)
  $('create-dialog').close()
  await loadSandboxes()
  setView('sandboxes')
  renderAll()
  ensurePoll()
}

function findSandbox(id) {
  return (state.sandboxes || []).find((sandbox) => String(sandbox.id) === String(id))
}

async function stopSandbox(sandbox) {
  const result = await api(`/v1/sandboxes/${encodeURIComponent(sandbox.id)}/stop`, { method: 'POST' })
  if (result.ok) {
    addJournal(`Остановлена песочница ${shortId(sandbox.id)}`, true)
    await loadSandboxes()
    renderAll()
    ensurePoll()
  } else {
    addJournal(`Не удалось остановить ${shortId(sandbox.id)}: ${result.error.message}`, false)
  }
}

async function deleteSandbox(sandbox) {
  if (!window.confirm(`Удалить песочницу ${shortId(sandbox.id)}? Машина будет удалена без восстановления.`)) {
    return
  }
  const result = await api(`/v1/sandboxes/${encodeURIComponent(sandbox.id)}`, { method: 'DELETE' })
  if (!result.ok) {
    addJournal(`Не удалось удалить ${shortId(sandbox.id)}: ${result.error.message}`, false)
    return
  }
  addJournal(`Удалена песочница ${shortId(sandbox.id)}`, true)
  state.sandboxes = (state.sandboxes || []).filter((item) => item.id !== sandbox.id)
  renderAll()
  ensurePoll()
  await loadUsage()
  renderAll()
}

function openTerminal(sandbox) {
  state.terminalSandbox = sandbox
  $('terminal-id').textContent = shortId(sandbox.id)
  $('terminal-output').textContent = `Песочница ${shortId(sandbox.id)}: ${STATE_LABELS[sandbox.state] || sandbox.state}. Введите команду и нажмите «Выполнить».`
  const dialog = $('terminal-dialog')
  if (!dialog.open) dialog.showModal()
  $('terminal-command').focus()
}

async function runTerminalCommand(event) {
  event.preventDefault()
  const sandbox = state.terminalSandbox
  if (!sandbox) return
  const command = $('terminal-command').value.trim()
  if (!command) {
    $('terminal-output').textContent = 'Введите команду.'
    return
  }
  const button = $('terminal-run')
  button.disabled = true
  button.textContent = 'Выполняем…'
  const result = await api(`/v1/sandboxes/${encodeURIComponent(sandbox.id)}/exec`, {
    method: 'POST',
    body: { command },
  })
  button.disabled = false
  button.textContent = 'Выполнить'

  if (!result.ok) {
    $('terminal-output').textContent = `$ ${command}\n\n${formatError(result.error)}`
    addJournal(`Команда в ${shortId(sandbox.id)} не выполнена: ${result.error.message}`, false)
    return
  }
  const data = result.data || {}
  $('terminal-output').textContent =
    `$ ${command}\n\nstdout:\n${data.stdout === undefined ? '' : data.stdout}` +
    `\n\nstderr:\n${data.stderr === undefined ? '' : data.stderr}` +
    `\n\nкод выхода: ${data.exit_code === undefined ? '—' : data.exit_code}`
  addJournal(`Команда в ${shortId(sandbox.id)}: код ${data.exit_code === undefined ? '—' : data.exit_code}`, true)
}

/* ---------- keys ---------- */

function resetKeyDialog() {
  $('key-form').hidden = false
  $('key-result').hidden = true
  $('secret-value').textContent = ''
  $('copy-secret-note').textContent = ''
  $('key-error').hidden = true
  $('key-error').textContent = ''
  document.querySelectorAll('input[name="scope"]').forEach((input) => {
    input.checked = true
  })
}

function openKeyDialog() {
  resetKeyDialog()
  const dialog = $('key-dialog')
  if (!dialog.open) dialog.showModal()
}

async function submitCreateKey(event) {
  event.preventDefault()
  const scopes = [...document.querySelectorAll('input[name="scope"]:checked')].map((input) => input.value)
  if (scopes.length === 0) {
    $('key-error').textContent = 'Выберите хотя бы одно право.'
    $('key-error').hidden = false
    return
  }

  const button = $('key-submit')
  button.disabled = true
  button.textContent = 'Создаём…'
  const result = await api('/v1/keys', { method: 'POST', body: { scopes } })
  button.disabled = false
  button.textContent = 'Создать'

  if (!result.ok) {
    $('key-error').textContent = formatError(result.error)
    $('key-error').hidden = false
    addJournal(`Не удалось создать ключ: ${result.error.message}`, false)
    return
  }

  const created = result.data || {}
  $('secret-value').textContent = created.secret || '—'
  $('key-form').hidden = true
  $('key-result').hidden = false
  addJournal(`Создан ключ ${created.prefix || ''}…${created.last4 || ''}`, true)
  await loadKeys()
  renderAll()
}

async function revokeKey(key) {
  const label = `${key.prefix || 'rox_sk_live_'}…${key.last4 || ''}`
  if (!window.confirm(`Отозвать ключ ${label}? Он перестанет работать сразу.`)) return
  const result = await api(`/v1/keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' })
  if (!result.ok) {
    addJournal(`Не удалось отозвать ключ ${label}: ${result.error.message}`, false)
    return
  }
  addJournal(`Отозван ключ ${label}`, true)
  await loadKeys()
  renderAll()
}

/* ---------- provider credentials ---------- */

function showProviderFormError(text) {
  $('provider-form-error').textContent = text
  $('provider-form-error').hidden = false
}

async function submitProviderCredential(event) {
  event.preventDefault()
  $('provider-form-error').hidden = true
  $('provider-form-error').textContent = ''

  const provider = $('provider-name').value
  const label = $('provider-label').value.trim()
  const secret = $('provider-secret').value.trim()
  const capRaw = $('provider-cap').value.trim()

  if (!secret) {
    showProviderFormError('Введите секрет поставщика.')
    $('provider-secret').focus()
    return
  }

  const body = { provider, label, secret }
  if (capRaw !== '') {
    const cap = Number(capRaw)
    if (!Number.isFinite(cap) || cap < 0) {
      showProviderFormError('Потолок расхода должен быть неотрицательным числом.')
      $('provider-cap').focus()
      return
    }
    body.spendCapCents = Math.round(cap * 100)
  }

  const button = $('provider-submit')
  button.disabled = true
  button.textContent = 'Добавляем…'
  const result = await api('/v1/provider-credentials', { method: 'POST', body })
  button.disabled = false
  button.textContent = 'Добавить'

  if (result.ok) {
    addJournal(`Добавлен ключ поставщика ${provider}${label ? ` «${label}»` : ''}`, true)
    $('provider-secret').value = ''
    $('provider-cap').value = ''
    $('provider-label').value = ''
    state.providersMissing = false
    state.providersError = null
    await loadCredentials()
    renderAll()
    return
  }

  if (result.error.status === 404) {
    state.providersMissing = true
    state.providersError = result.error
    addJournal('Сервер ещё не принимает ключи поставщиков', false)
    renderProviders()
    return
  }

  showProviderFormError(formatError(result.error))
  addJournal(`Не удалось добавить ключ поставщика: ${result.error.message}`, false)
}

async function promoteCredential(credential) {
  const result = await api(`/v1/provider-credentials/${encodeURIComponent(credential.id)}/promote`, {
    method: 'POST',
  })
  if (result.ok) {
    addJournal(`Основным поставщиком выбран ${credential.provider}${credential.label ? ` «${credential.label}»` : ''}`, true)
    await loadCredentials()
    renderAll()
  } else {
    addJournal(`Не удалось сменить основного поставщика: ${result.error.message}`, false)
  }
}

async function disableCredential(credential) {
  const name = `${credential.provider}${credential.label ? ` «${credential.label}»` : ''}`
  if (!window.confirm(`Отключить ключ поставщика ${name}?`)) return
  const result = await api(`/v1/provider-credentials/${encodeURIComponent(credential.id)}`, { method: 'DELETE' })
  if (result.ok) {
    addJournal(`Отключён ключ поставщика ${name}`, true)
    await loadCredentials()
    renderAll()
  } else {
    addJournal(`Не удалось отключить ключ поставщика: ${result.error.message}`, false)
  }
}

/* ---------- clipboard ---------- */

async function copyText(text, noteEl) {
  let copied = false
  try {
    await navigator.clipboard.writeText(text)
    copied = true
  } catch {
    copied = false
  }

  if (!copied) {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    try {
      copied = document.execCommand('copy')
    } catch {
      copied = false
    }
    area.remove()
  }

  if (noteEl) {
    noteEl.textContent = copied ? 'Скопировано' : 'Не удалось скопировать — выделите вручную'
    setTimeout(() => {
      noteEl.textContent = ''
    }, 2500)
  }
}

/* ---------- countdown ticker ---------- */

function tickCountdowns() {
  if (!state.connected) return
  document.querySelectorAll('[data-countdown]').forEach((cell) => {
    const iso = cell.getAttribute('data-countdown')
    const text = remaining(iso)
    if (cell.textContent !== text) cell.textContent = text
  })
}

/* ---------- events ---------- */

function bindEvents() {
  $('connect-form').addEventListener('submit', connect)
  $('logout').addEventListener('click', logout)

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => navigate(button.dataset.view))
  })

  const orgInput = $('org-name')
  const saveOrg = () => {
    const value = orgInput.value.trim() || DEFAULT_ORG
    state.org = value
    orgInput.value = value
    writeLocal(LOCAL_NAME, value)
  }
  orgInput.addEventListener('change', saveOrg)
  orgInput.addEventListener('blur', saveOrg)
  orgInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      orgInput.blur()
    }
  })

  $('copy-curl').addEventListener('click', () => copyText($('curl-example').textContent, $('copy-curl-note')))
  $('trial-button').addEventListener('click', () => openCreateDialog({ os: 'linux', ttlSec: 60 }))
  $('sandbox-create').addEventListener('click', () => openCreateDialog())
  $('sandboxes-refresh').addEventListener('click', async () => {
    await loadSandboxes()
    renderAll()
    ensurePoll()
  })

  $('create-form').addEventListener('submit', submitCreateSandbox)
  $('create-cancel').addEventListener('click', () => $('create-dialog').close())
  $('create-dialog').addEventListener('close', () => {
    $('create-error').hidden = true
    $('create-error').textContent = ''
  })

  $('sandboxes-body').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]')
    if (!button) return
    const sandbox = findSandbox(button.dataset.id)
    if (!sandbox) return
    if (button.dataset.action === 'terminal') openTerminal(sandbox)
    else if (button.dataset.action === 'stop') stopSandbox(sandbox)
    else if (button.dataset.action === 'delete') deleteSandbox(sandbox)
  })

  $('terminal-form').addEventListener('submit', runTerminalCommand)
  $('terminal-close').addEventListener('click', () => $('terminal-dialog').close())
  $('terminal-dialog').addEventListener('close', () => {
    state.terminalSandbox = null
  })

  $('key-create').addEventListener('click', openKeyDialog)
  $('key-form').addEventListener('submit', submitCreateKey)
  $('key-cancel').addEventListener('click', () => $('key-dialog').close())
  $('secret-close').addEventListener('click', () => $('key-dialog').close())
  $('copy-secret').addEventListener('click', () =>
    copyText($('secret-value').textContent, $('copy-secret-note')),
  )
  $('key-dialog').addEventListener('close', resetKeyDialog)

  $('keys-body').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-key-action]')
    if (!button) return
    const key = (state.keys || []).find((item) => String(item.id) === button.dataset.id)
    if (key) revokeKey(key)
  })

  $('provider-form').addEventListener('submit', submitProviderCredential)
  $('providers-refresh').addEventListener('click', async () => {
    await loadCredentials()
    renderAll()
  })
  $('providers-body').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-credential-action]')
    if (!button) return
    const credential = (state.credentials || []).find((item) => String(item.id) === button.dataset.id)
    if (!credential) return
    if (button.dataset.credentialAction === 'promote') promoteCredential(credential)
    else if (button.dataset.credentialAction === 'disable') disableCredential(credential)
  })
}

/* ---------- boot ---------- */

function init() {
  $('connect-base').value = state.base
  $('org-name').value = state.org
  bindEvents()
  renderAll()
  setInterval(tickCountdowns, 1000)

  if (state.key) {
    state.connected = true
    $('connect-screen').hidden = true
    $('shell').hidden = false
    renderStatus()
    startSession()
  } else {
    showConnect('')
  }
}

init()
