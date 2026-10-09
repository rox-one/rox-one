/**
 * G1 «Орбита» / Orbit — flagged spatial board (default OFF).
 *
 * A pannable / zoomable canvas of live-work cards. Zoom is a *semantic* dial,
 * not a magnifier: card footprint is screen-constant per LOD
 * (мини < 0.62 ≤ обзор < 1.15 ≤ детали) while card POSITIONS live in world
 * space, so ru typography never drops below the 11px floor at any zoom.
 *
 * Ported 1:1 from the standalone prototype `prototypes/g01-orbit/` as React +
 * ROX tokens. The `--orbit-*` token block is declared as inline custom
 * properties on the board root (materials / surfaces / text floor / ring);
 * geometry that feeds arithmetic (LOD thresholds, footprint sizes, camera
 * clamps) lives in the module constants below. No raw hex, no blur, no
 * always-on animation — the camera is the single authored motion and it is
 * skipped under `prefers-reduced-motion` and `data-render-profile=performance`.
 *
 * The board reads no atoms: it is a projection of the pilot scene, mounted only
 * when `featureOrbitBoardAtom` is ON (see WorkspaceSurfaceHost.tsx).
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  CalendarDays,
  Check,
  ChevronRight,
  CornerDownRight,
  Cpu,
  FileText,
  GitBranch,
  LayoutGrid,
  ListChecks,
  Map as MapIcon,
  Maximize2,
  Mic,
  Minus,
  MoreHorizontal,
  Orbit,
  Paperclip,
  Plus,
  Search,
  Send,
  Shield,
  Sparkles,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ tokens - */

/**
 * New `--orbit-*` tokens (ported from `orbit.css`). Colours derive from the ROX
 * semantic layer only, so a palette preset re-skins the whole board.
 */
const ORBIT_VARS = {
  '--orbit-canvas-bg': 'var(--canvas)',
  '--orbit-canvas-dot': 'color-mix(in oklch, var(--foreground) 14%, transparent)',
  '--orbit-card-bg': 'var(--surface-elevated)',
  '--orbit-card-bg-selected': 'color-mix(in oklch, var(--accent) 6%, var(--surface-elevated))',
  '--orbit-text-quiet': 'var(--text-secondary)',
  '--orbit-ring-stroke': 'color-mix(in oklch, var(--accent) 34%, transparent)',
} as React.CSSProperties

/* ---------------------------------------------------------------- geometry - */

type Lod = 'mini' | 'standard' | 'detail'

const LOD_MINI_MAX = 0.62
const LOD_STD_MAX = 1.15
const ZOOM_MIN = 0.45
const ZOOM_MAX = 2.4
const ZOOM_DETAIL = 1.35
const ZOOM_STEP = 1.15
const CAMERA_MS = 420

const FOOT: Record<Lod, { w: number; h: number }> = {
  mini: { w: 176, h: 48 },
  standard: { w: 300, h: 210 },
  detail: { w: 580, h: 500 },
}

const GRID_STEP = 32
const DOT_SIZE = 1.5
const MM_W = 200
const MM_H = 118

const clampZ = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))
const lodFor = (z: number): Lod => (z < LOD_MINI_MAX ? 'mini' : z < LOD_STD_MAX ? 'standard' : 'detail')

/* -------------------------------------------------------------- card model - */

type StatusId = 'running' | 'waiting' | 'done' | 'idle' | 'error'
type CardType = 'session' | 'note' | 'tasks' | 'terminal' | 'meeting'

type Tone = 'dim' | 'ok' | 'warn' | 'accent'
interface Seg {
  t: string
  tone?: Tone
}
type Block =
  | { k: 'msg'; r: 'user' | 'ai'; t: string }
  | { k: 'tool'; t: string; a: string; d: string }
  | { k: 'turn'; r: 'user' | 'ai'; name: string; t: string[]; ul?: string[] }
  | { k: 'approval'; t: string; s: string; yes: string; no: string }
  | { k: 'term'; lines: Seg[][] }
  | { k: 'h'; t: string }
  | { k: 'p'; t: string }
  | { k: 'ul'; li: string[] }
  | { k: 'tk'; d: boolean; t: string; due: string }
  | { k: 'progress'; v: number; t: string }
  | { k: 'mt'; t: string; b: string; x: string }
  | { k: 'note'; t: string }

interface OrbitCard {
  id: string
  type: CardType
  x: number
  y: number
  title: string
  status: StatusId
  statusLabel: string
  time: string
  standard: Block[]
  detail: Block[]
}

const TYPE_META: Record<CardType, { icon: LucideIcon; label: string }> = {
  session: { icon: Sparkles, label: 'Сессия' },
  note: { icon: FileText, label: 'Заметка' },
  tasks: { icon: ListChecks, label: 'Задачи' },
  terminal: { icon: Terminal, label: 'Терминал' },
  meeting: { icon: CalendarDays, label: 'Встреча' },
}

const STATUS_COLOR: Record<StatusId, string> = {
  running: 'var(--status-running)',
  waiting: 'var(--status-warning)',
  done: 'var(--status-success)',
  idle: 'var(--status-neutral)',
  error: 'var(--status-danger)',
}

const TONE_COLOR: Record<Tone, string> = {
  dim: 'var(--orbit-text-quiet)',
  ok: 'var(--status-success)',
  warn: 'var(--status-warning)',
  accent: 'var(--accent-text)',
}

const BUILD_LOG_STD: Seg[][] = [
  [{ t: '$', tone: 'dim' }, { t: ' bun run build' }],
  [{ t: 'vite', tone: 'accent' }, { t: ' v5.4.8 building for production…' }],
  [{ t: '✓', tone: 'ok' }, { t: ' 1284 modules transformed' }],
  [{ t: '✓', tone: 'ok' }, { t: ' renderer 2.81 MB │ gzip 812 kB' }],
  [{ t: '▲', tone: 'warn' }, { t: ' chunk >500 kB: chat-panel' }],
  [{ t: '…', tone: 'dim' }, { t: ' 6 записей скрыто' }],
]

const BUILD_LOG_DETAIL: Seg[][] = [
  [{ t: '$', tone: 'dim' }, { t: ' bun run build' }],
  [{ t: 'vite', tone: 'accent' }, { t: ' v5.4.8 building for production…' }],
  [{ t: '✓', tone: 'ok' }, { t: ' 1284 modules transformed' }],
  [{ t: '✓', tone: 'ok' }, { t: ' renderer 2.81 MB │ gzip 812 kB' }],
  [{ t: '▲', tone: 'warn' }, { t: ' chunk >500 kB: chat-panel (612 kB)' }],
  [{ t: '✓', tone: 'ok' }, { t: ' styles 214 kB │ gzip 31 kB' }],
  [{ t: '✓', tone: 'ok' }, { t: ' tokens lint: 0 нарушений' }],
  [{ t: '✓', tone: 'ok' }, { t: ' i18n parity: 12 локалей сходятся' }],
  [{ t: '✓', tone: 'ok' }, { t: ' build in 24.6s' }],
  [{ t: '$', tone: 'dim' }, { t: ' bun run test:visual' }],
  [{ t: '✓', tone: 'ok' }, { t: ' desktop-light 5/5 · desktop-dark 5/5' }],
  [{ t: '✓', tone: 'ok' }, { t: ' mobile-light 5/5' }],
  [{ t: '▲', tone: 'warn' }, { t: ' 1 предупреждение: не задан hash для иконок' }],
]

const CARDS: OrbitCard[] = [
  {
    id: 'c1',
    type: 'session',
    x: 0,
    y: 0,
    title: 'Рефакторинг аутентификации',
    status: 'running',
    statusLabel: 'Выполняется',
    time: '12 мин',
    standard: [
      { k: 'msg', r: 'user', t: 'Вынеси проверку токенов из middleware в TokenService. Тесты на refresh падают.' },
      { k: 'msg', r: 'ai', t: 'Понял. Читаю auth/middleware.ts и выношу валидацию — сейчас 2 теста на refresh красные.' },
      { k: 'tool', t: 'Правка · src/auth/token-service.ts', a: '+84', d: '−12' },
    ],
    detail: [
      { k: 'turn', r: 'user', name: 'Вы', t: ['Вынеси проверку токенов из middleware в отдельный TokenService. Тесты на refresh падают — надо зелёные.'] },
      { k: 'turn', r: 'ai', name: 'Rox', t: ['Начал с чтения текущего флоу. Refresh-токен валидируется в двух местах, свёл обе проверки в один сервис.'] },
      { k: 'tool', t: 'Правка файлов · src/auth/token-service.ts', a: '+84', d: '−12' },
      { k: 'tool', t: 'Тесты · auth', a: '43 прошло', d: 'было 2 падения' },
      { k: 'turn', r: 'ai', name: 'Rox', t: ['Тесты зелёные. Осталось применить миграцию — для записи в прод-базу нужно подтверждение.'] },
      { k: 'approval', t: 'Требуется доступ', s: 'Запись в prod-db (миграция 0042_refresh_tokens).', yes: 'Разрешить', no: 'Запретить' },
    ],
  },
  {
    id: 'c2',
    type: 'session',
    x: 660,
    y: 0,
    title: 'Миграция на Postgres 17',
    status: 'waiting',
    statusLabel: 'Ждёт подтверждения',
    time: '26 мин',
    standard: [
      { k: 'msg', r: 'user', t: 'Перепиши план миграции под 17-ю: логическая репликация вместо pg_dump.' },
      { k: 'msg', r: 'ai', t: 'Собрал план на 4 этапа, простой ≈0. Черновик — в заметке «Архитектура синхронизации».' },
    ],
    detail: [
      { k: 'turn', r: 'user', name: 'Вы', t: ['Перепиши план миграции под 17-ю: логическая репликация вместо pg_dump. Простой не больше минуты.'] },
      {
        k: 'turn',
        r: 'ai',
        name: 'Rox',
        t: ['План на четыре этапа:'],
        ul: ['поднять реплику 17.2 рядом с основной;', 'включить logical replication на отмеченных таблицах;', 'прогнать репетицию на стейдже и сверить счётчики;', 'переключение с окном простоя ≈0.'],
      },
      { k: 'tool', t: 'Репетиция на стейдже', a: '18 мин', d: 'счётчики сходятся' },
      { k: 'turn', r: 'ai', name: 'Rox', t: ['Репетиция прошла чисто. Чтобы запустить этап 1, нужен доступ к реплике.'] },
      { k: 'approval', t: 'Требуется доступ', s: 'Подключение к prod-replica-01 (только чтение).', yes: 'Разрешить', no: 'Запретить' },
    ],
  },
  {
    id: 'c6',
    type: 'meeting',
    x: 1320,
    y: 0,
    title: 'Планёрка продукта',
    status: 'idle',
    statusLabel: 'Сегодня 15:00',
    time: '45 мин',
    standard: [
      { k: 'mt', t: '15:00', b: 'Итоги недели', x: 'статус по трём сессиям' },
      { k: 'mt', t: '15:10', b: 'Орбита: тест навигации', x: 'проверить ⌘K и Tab' },
      { k: 'mt', t: '15:25', b: 'Задачи спринта 42', x: 'разбор блокеров' },
      { k: 'mt', t: '15:40', b: 'Решения и действия', x: 'запись в протокол' },
    ],
    detail: [
      { k: 'mt', t: '15:00', b: 'Итоги недели', x: 'статус по трём сессиям, метрики сборки' },
      { k: 'mt', t: '15:10', b: 'Орбита: тест навигации', x: 'проверить ⌘K, Tab и мини-карту на реальной доске' },
      { k: 'mt', t: '15:25', b: 'Задачи спринта 42', x: 'разбор блокеров, перенос двух задач' },
      { k: 'mt', t: '15:35', b: 'Доступы и подтверждения', x: 'закрыть открытые запросы агентов' },
      { k: 'mt', t: '15:40', b: 'Решения и действия', x: 'запись в протокол, назначение ответственных' },
      { k: 'note', t: 'Повестка собрана автоматически из задач и сессий недели.' },
    ],
  },
  {
    id: 'c3',
    type: 'note',
    x: 0,
    y: 580,
    title: 'Архитектура синхронизации',
    status: 'idle',
    statusLabel: 'Правка 3 ч назад',
    time: '5 мин',
    standard: [
      { k: 'h', t: 'Синхронизация состояния' },
      { k: 'p', t: 'Источник истины — сервер. Клиент держит локальную копию и очередь непроведённых операций.' },
      { k: 'p', t: 'Конфликты разрешаются по версии последнего изменения: проигравшая операция уходит в историю.' },
      { k: 'p', t: 'Реплика читается только в режиме логической подписки — без записи.' },
    ],
    detail: [
      { k: 'h', t: 'Синхронизация состояния' },
      { k: 'p', t: 'Источник истины — сервер. Клиент держит локальную копию и очередь непроведённых операций, чтобы работать без сети.' },
      { k: 'p', t: 'Конфликты разрешаются по версии последнего изменения: проигравшая операция не теряется, а уходит в историю и доступна для ручного слияния.' },
      { k: 'p', t: 'Во время миграции реплика читается в режиме логической подписки — запись идёт только в основную базу.' },
      { k: 'ul', li: ['очередь операций переживает перезапуск клиента;', 'для платежей включаем строгий порядок;', 'метрика расхождения видна в инспекторе.'] },
    ],
  },
  {
    id: 'c4',
    type: 'tasks',
    x: 660,
    y: 580,
    title: 'Спринт 42',
    status: 'done',
    statusLabel: '62% готово',
    time: '6 задач',
    standard: [
      { k: 'tk', d: true, t: 'Вынести TokenService', due: 'сегодня' },
      { k: 'tk', d: true, t: 'Прогнать тесты auth', due: 'сегодня' },
      { k: 'tk', d: false, t: 'Репетиция миграции 17.2', due: 'чт' },
      { k: 'tk', d: false, t: 'Собрать протокол планёрки', due: 'пт' },
    ],
    detail: [
      { k: 'progress', v: 0.62, t: '4 из 6 закрыто' },
      { k: 'tk', d: true, t: 'Вынести TokenService', due: 'сегодня' },
      { k: 'tk', d: true, t: 'Прогнать тесты auth', due: 'сегодня' },
      { k: 'tk', d: true, t: 'Согласовать окно миграции', due: 'ср' },
      { k: 'tk', d: true, t: 'Обновить заметку по синхронизации', due: 'ср' },
      { k: 'tk', d: false, t: 'Репетиция миграции 17.2', due: 'чт' },
      { k: 'tk', d: false, t: 'Собрать протокол планёрки', due: 'пт' },
    ],
  },
  {
    id: 'c5',
    type: 'terminal',
    x: 1320,
    y: 580,
    title: 'Логи сборки',
    status: 'running',
    statusLabel: 'Идёт сборка',
    time: '2 мин',
    standard: [{ k: 'term', lines: BUILD_LOG_STD }],
    detail: [{ k: 'term', lines: BUILD_LOG_DETAIL }],
  },
]

interface Satellite {
  pos: 'top' | 'right' | 'bottom' | 'left'
  kind: 'agent' | 'session'
  name: string
  ini: string
  status: StatusId
  target?: string
}

const SATELLITES: Satellite[] = [
  { pos: 'top', kind: 'agent', name: 'Планировщик', ini: 'ПЛ', status: 'running' },
  { pos: 'right', kind: 'session', name: 'Дизайн-ревью', ini: 'ДР', status: 'waiting', target: 'c2' },
  { pos: 'bottom', kind: 'agent', name: 'Тестировщик', ini: 'ТТ', status: 'done' },
  { pos: 'left', kind: 'session', name: 'Логи сборки', ini: 'ЛС', status: 'running', target: 'c5' },
]

const BOUNDS = CARDS.reduce(
  (acc, c) => ({
    minX: Math.min(acc.minX, c.x),
    maxX: Math.max(acc.maxX, c.x),
    minY: Math.min(acc.minY, c.y),
    maxY: Math.max(acc.maxY, c.y),
  }),
  { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
)

const SAT_POS: Record<Satellite['pos'], React.CSSProperties> = {
  top: { top: -34, left: '50%', transform: 'translate(-50%, -50%)' },
  bottom: { bottom: -34, left: '50%', transform: 'translate(-50%, 50%)' },
  left: { left: -44, top: '50%', transform: 'translate(-50%, -50%)' },
  right: { right: -44, top: '50%', transform: 'translate(50%, -50%)' },
}

/* ----------------------------------------------------------------- helpers - */

function Dot({ status, size = 7 }: { status: StatusId; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: STATUS_COLOR[status] }}
    />
  )
}

/* --------------------------------------------------------------- the board - */

export function OrbitBoard() {
  const { t } = useTranslation()
  const stageRef = React.useRef<HTMLDivElement>(null)

  const [cam, setCam] = React.useState({ x: 0, y: 0, z: 1 })
  const [size, setSize] = React.useState({ w: 0, h: 0 })
  const [selectedId, setSelectedId] = React.useState<string>(CARDS[0].id)
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)
  const [isPanning, setIsPanning] = React.useState(false)
  const [narrow, setNarrow] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1000px)').matches,
  )
  const [minimapOpen, setMinimapOpen] = React.useState(false)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [paletteQuery, setPaletteQuery] = React.useState('')
  const [paletteIdx, setPaletteIdx] = React.useState(0)
  const [toast, setToast] = React.useState<string | null>(null)
  const [reduced, setReduced] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  const camRef = React.useRef(cam)
  camRef.current = cam
  const sizeRef = React.useRef(size)
  sizeRef.current = size
  const selectedRef = React.useRef(selectedId)
  selectedRef.current = selectedId
  const narrowRef = React.useRef(narrow)
  narrowRef.current = narrow

  const lod = lodFor(cam.z)
  const selectedCard = CARDS.find((c) => c.id === selectedId) ?? CARDS[0]

  /* camera primitives ------------------------------------------------------- */

  const rafRef = React.useRef<number | null>(null)
  const stopTween = React.useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  const reducedRef = React.useRef(reduced)
  reducedRef.current = reduced

  const motionMs = React.useCallback((v: number) => {
    const performance = typeof document !== 'undefined' && document.documentElement.dataset.renderProfile === 'performance'
    return reducedRef.current || performance ? 0 : v
  }, [])

  const jumpTo = React.useCallback((x: number, y: number, z: number) => {
    setCam({ x, y, z: clampZ(z) })
  }, [])

  const animateTo = React.useCallback(
    (x: number, y: number, z: number, ms?: number) => {
      stopTween()
      const dur = motionMs(ms ?? CAMERA_MS)
      const from = camRef.current
      const tz = clampZ(z)
      if (dur <= 0) {
        setCam({ x, y, z: tz })
        return
      }
      const t0 = performance.now()
      const ease = (u: number) => 1 - Math.pow(1 - u, 4) // expo-out
      const step = (now: number) => {
        const u = Math.min(1, (now - t0) / dur)
        const e = ease(u)
        setCam({ x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e, z: from.z + (tz - from.z) * e })
        rafRef.current = u < 1 ? requestAnimationFrame(step) : null
      }
      rafRef.current = requestAnimationFrame(step)
    },
    [motionMs, stopTween],
  )

  const centerOn = React.useCallback(
    (card: OrbitCard, z: number, ms?: number) => {
      const s = sizeRef.current
      const f = FOOT[lodFor(z)]
      animateTo(s.w / 2 - card.x * z - f.w / 2, s.h / 2 - card.y * z - f.h / 2, z, ms)
    },
    [animateTo],
  )

  const fit = React.useCallback(
    (animate: boolean) => {
      const s = sizeRef.current
      if (s.w === 0) return
      const pad = 56
      const availW = s.w - pad * 2
      const availH = s.h - pad * 2
      const spanX = Math.max(1, BOUNDS.maxX - BOUNDS.minX)
      const spanY = Math.max(1, BOUNDS.maxY - BOUNDS.minY)
      const guess = (f: { w: number; h: number }) => Math.min((availW - f.w) / spanX, (availH - f.h) / spanY)
      let z = clampZ(guess(FOOT.standard))
      z = clampZ(guess(FOOT[lodFor(z)]))
      const f = FOOT[lodFor(z)]
      const x = s.w / 2 - ((BOUNDS.minX + BOUNDS.maxX) / 2) * z - f.w / 2
      const y = s.h / 2 - ((BOUNDS.minY + BOUNDS.maxY) / 2) * z - f.h / 2
      if (animate) animateTo(x, y, z)
      else {
        stopTween()
        jumpTo(x, y, z)
      }
    },
    [animateTo, jumpTo, stopTween],
  )

  const ensureVisible = React.useCallback(
    (card: OrbitCard) => {
      const s = sizeRef.current
      const c = camRef.current
      const f = FOOT[lodFor(c.z)]
      const sx = c.x + card.x * c.z
      const sy = c.y + card.y * c.z
      const m = 40
      if (sx < m || sy < m || sx + f.w > s.w - m || sy + f.h > s.h - m) centerOn(card, c.z)
    },
    [centerOn],
  )

  const zoomAt = React.useCallback((factor: number, cx?: number, cy?: number) => {
    const s = sizeRef.current
    const c = camRef.current
    const px = cx ?? s.w / 2
    const py = cy ?? s.h / 2
    const nz = clampZ(c.z * factor)
    if (nz === c.z) return
    // keep the point under (px, py) fixed
    setCam({ x: px - (px - c.x) * (nz / c.z), y: py - (py - c.y) * (nz / c.z), z: nz })
  }, [])

  const openCard = React.useCallback(
    (id: string) => {
      const card = CARDS.find((c) => c.id === id)
      if (!card) return
      setSelectedId(id)
      centerOn(card, ZOOM_DETAIL)
    },
    [centerOn],
  )

  const selectCard = React.useCallback(
    (id: string, opts: { open?: boolean; ensure?: boolean } = {}) => {
      setSelectedId(id)
      const card = CARDS.find((c) => c.id === id)
      if (!card) return
      if (opts.open) centerOn(card, ZOOM_DETAIL)
      else if (narrowRef.current) centerOn(card, Math.max(camRef.current.z, ZOOM_DETAIL))
      else if (opts.ensure) ensureVisible(card)
    },
    [centerOn, ensureVisible],
  )

  const showToast = React.useCallback((message: string) => {
    setToast(message)
  }, [])
  const toastTimer = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (toast == null) return
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
    return () => {
      if (toastTimer.current != null) window.clearTimeout(toastTimer.current)
    }
  }, [toast])

  /* size + responsive ------------------------------------------------------- */

  React.useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 1000px)')
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Boot once the container has real dimensions, then re-frame on every resize:
  // narrow keeps a single card at detail LOD, desktop re-fits the whole board.
  const bootedRef = React.useRef(false)
  React.useEffect(() => {
    if (size.w === 0) return
    const first = CARDS.find((c) => c.id === selectedRef.current) ?? CARDS[0]
    if (!bootedRef.current) {
      bootedRef.current = true
      if (narrow) centerOn(first, ZOOM_DETAIL, 0)
      else fit(false)
      return
    }
    if (narrow) centerOn(first, Math.max(camRef.current.z, ZOOM_DETAIL))
    else fit(false)
  }, [size, narrow, centerOn, fit])

  React.useEffect(() => () => stopTween(), [stopTween])

  /* palette ----------------------------------------------------------------- */

  const paletteItems = React.useMemo(() => {
    const q = paletteQuery.trim().toLowerCase()
    if (!q) return CARDS
    return CARDS.filter(
      (c) => c.title.toLowerCase().includes(q) || TYPE_META[c.type].label.toLowerCase().includes(q),
    )
  }, [paletteQuery])

  const safePaletteIdx = Math.min(paletteIdx, Math.max(0, paletteItems.length - 1))

  const openPalette = React.useCallback(() => {
    setPaletteQuery('')
    setPaletteIdx(0)
    setPaletteOpen(true)
  }, [])
  const closePalette = React.useCallback(() => setPaletteOpen(false), [])

  /* pointer: drag to pan, click to open ------------------------------------ */

  const dragRef = React.useRef<{
    x: number
    y: number
    camX: number
    camY: number
    card?: string
    pending: boolean
  } | null>(null)
  const movedRef = React.useRef(false)
  const spaceRef = React.useRef(false)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    const target = e.target as HTMLElement
    const onCard = target.closest('[data-card-id]') as HTMLElement | null
    if (onCard && target.closest('button, [data-sat], [data-approve], [data-deny]')) return
    if (onCard && !spaceRef.current && e.button === 0) {
      dragRef.current = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y, card: onCard.dataset.cardId, pending: true }
    } else {
      dragRef.current = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y, pending: false }
      setIsPanning(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    movedRef.current = false
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      movedRef.current = true
      if (drag.pending) {
        drag.pending = false
        setIsPanning(true)
        e.currentTarget.setPointerCapture(e.pointerId)
      }
    }
    if (!drag.pending) {
      stopTween()
      setCam({ x: drag.camX + dx, y: drag.camY + dy, z: cam.z })
    }
  }

  const endPan = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag && drag.pending && !movedRef.current && drag.card) openCard(drag.card)
    setIsPanning(false)
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // capture may already be released
    }
  }

  const onWheel = React.useCallback(
    (e: WheelEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('[data-orbit-overlay]')) return
      e.preventDefault()
      const el = stageRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const f = Math.exp(-e.deltaY * 0.0016)
      zoomAt(f, e.clientX - r.left, e.clientY - r.top)
    },
    [zoomAt],
  )

  React.useEffect(() => {
    const el = stageRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  /* keyboard ---------------------------------------------------------------- */

  const keyApiRef = React.useRef({ animateTo, zoomAt, openCard, fit })
  keyApiRef.current = { animateTo, zoomAt, openCard, fit }
  const paletteOpenRef = React.useRef(paletteOpen)
  paletteOpenRef.current = paletteOpen

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'к')) {
        e.preventDefault()
        e.stopPropagation()
        if (paletteOpenRef.current) closePalette()
        else openPalette()
        return
      }
      if (e.key === 'Escape' && paletteOpenRef.current) {
        closePalette()
        return
      }
      if (e.code === 'Space') spaceRef.current = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [closePalette, openPalette])

  const onBoardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    const c = camRef.current
    const api = keyApiRef.current
    if (e.code === 'Space') {
      if (!e.repeat) e.preventDefault()
      return
    }
    if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      api.animateTo(c.x, c.y, c.z * ZOOM_STEP, 160)
      return
    }
    if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      api.animateTo(c.x, c.y, c.z / ZOOM_STEP, 160)
      return
    }
    if (e.key === '0') {
      e.preventDefault()
      api.fit(true)
      return
    }
    if (e.key === '1') {
      e.preventDefault()
      api.animateTo(c.x, c.y, 0.52, 200)
      return
    }
    if (e.key === '2') {
      e.preventDefault()
      api.animateTo(c.x, c.y, 0.85, 200)
      return
    }
    if (e.key === '3') {
      e.preventDefault()
      api.openCard(selectedRef.current)
      return
    }
    if (e.key === 'Escape') {
      const order: Lod[] = ['mini', 'standard', 'detail']
      if (order.indexOf(lodFor(c.z)) > 0) {
        e.preventDefault()
        api.zoomAt((lodFor(c.z) === 'detail' ? 0.85 : 0.52) / c.z)
      }
      return
    }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      stopTween()
      const step = 96
      let { x, y } = c
      if (e.key === 'ArrowLeft') x += step
      else if (e.key === 'ArrowRight') x -= step
      else if (e.key === 'ArrowUp') y += step
      else if (e.key === 'ArrowDown') y -= step
      setCam({ x, y, z: c.z })
    }
  }

  /* minimap ----------------------------------------------------------------- */

  const minimap = React.useMemo(() => {
    const f = FOOT[lod]
    const spanX = BOUNDS.maxX - BOUNDS.minX + f.w / cam.z
    const spanY = BOUNDS.maxY - BOUNDS.minY + f.h / cam.z
    const k = Math.min(MM_W / spanX, MM_H / spanY)
    const ox = (MM_W - spanX * k) / 2 - BOUNDS.minX * k
    const oy = (MM_H - spanY * k) / 2 - BOUNDS.minY * k
    const cw = Math.max(3, (f.w / cam.z) * k)
    const ch = Math.max(2, (f.h / cam.z) * k)
    return { k, ox, oy, cw, ch }
  }, [cam.z, lod])

  const onMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const wx = (e.clientX - r.left - minimap.ox) / minimap.k
    const wy = (e.clientY - r.top - minimap.oy) / minimap.k
    const s = sizeRef.current
    animateTo(s.w / 2 - wx * cam.z, s.h / 2 - wy * cam.z, cam.z)
  }

  /* render ------------------------------------------------------------------ */

  const lodLabel = t(`orbit.lod.${lod}`, {
    defaultValue: { mini: 'мини', standard: 'обзор', detail: 'детали' }[lod],
  })
  const zoomPct = Math.round(cam.z * 100)
  const minimapVisible = !narrow || minimapOpen
  const focusTransition = reduced ? 'none' : 'box-shadow var(--motion-base) var(--ease-standard), background-color var(--motion-base) var(--ease-standard)'

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--orbit-canvas-bg)] text-[color:var(--text-primary)]"
      style={ORBIT_VARS}
      tabIndex={-1}
      onKeyDown={onBoardKeyDown}
    >
      {/* board toolbar — the board's own command surface (omnibox → «Прыжок») */}
      <header
        className="flex shrink-0 items-center gap-2 border-b border-[color:var(--border-subtle)] bg-[var(--surface-elevated)] px-2"
        style={{ height: 'var(--chrome-topbar-height)' }}
      >
        <span className="flex items-center gap-1.5 pl-1 text-[length:var(--text-small)] font-semibold">
          <Orbit className="icon-toolbar text-[color:var(--accent-text)]" aria-hidden />
          Орбита
        </span>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-[var(--radius-control)] border border-[color:var(--border-subtle)] bg-[var(--surface-rail)] px-2 text-[length:var(--chrome-font-size-sm)] text-[color:var(--orbit-text-quiet)]">
          <LayoutGrid className="icon-caption" aria-hidden />
          {t('orbit.boardName', { defaultValue: 'Доска' })}: <b className="font-medium text-[color:var(--text-primary)]">Продукт</b>
        </span>
        <button
          type="button"
          onClick={openPalette}
          aria-haspopup="dialog"
          aria-expanded={paletteOpen}
          className="flex h-7 max-w-[460px] flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--border-subtle)] bg-[var(--surface-input)] px-2 text-left text-[length:var(--chrome-font-size-sm)] text-[color:var(--orbit-text-quiet)] outline-none hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-secondary)] focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]"
        >
          <Search className="icon-caption shrink-0" aria-hidden />
          <span className="truncate">{t('orbit.omniboxPlaceholder', { defaultValue: 'Прыжок к карточке…' })}</span>
          <span className="ml-auto flex shrink-0 gap-0.5">
            <kbd className="rounded-[var(--radius-xs)] border border-[color:var(--border-subtle)] bg-[var(--surface-elevated)] px-1 py-0.5 font-mono text-caption text-[color:var(--text-secondary)]">
              ⌘
            </kbd>
            <kbd className="rounded-[var(--radius-xs)] border border-[color:var(--border-subtle)] bg-[var(--surface-elevated)] px-1 py-0.5 font-mono text-caption text-[color:var(--text-secondary)]">
              K
            </kbd>
          </span>
        </button>
        <span className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-full border border-[color:var(--border-subtle)] bg-[var(--surface-rail)] px-2 text-[length:var(--text-caption)] text-[color:var(--orbit-text-quiet)]">
          {t('orbit.lod', { defaultValue: 'уровень' })}: {lodLabel}
        </span>
        <button
          type="button"
          onClick={() => setMinimapOpen((v) => !v)}
          aria-label={t('orbit.minimap', { defaultValue: 'Мини-карта' })}
          aria-pressed={minimapVisible}
          className={cn(
            'grid size-7 place-items-center rounded-[var(--radius-control)] text-[color:var(--text-secondary)] outline-none hover:bg-[var(--state-hover)] focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]',
            !narrow && 'hidden',
          )}
        >
          <MapIcon className="icon-toolbar" aria-hidden />
        </button>
      </header>

      {/* stage: canvas + overlay chrome */}
      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden bg-[var(--orbit-canvas-bg)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(var(--orbit-canvas-dot) ${DOT_SIZE}px, transparent ${DOT_SIZE}px)`,
            backgroundSize: `${GRID_STEP * cam.z}px ${GRID_STEP * cam.z}px`,
            backgroundPosition: `${cam.x}px ${cam.y}px`,
          }}
        />

        <div
          className={cn('absolute inset-0 overflow-hidden touch-none', isPanning ? 'cursor-grabbing' : 'cursor-grab')}
          role="application"
          aria-label={t('orbit.viewportLabel', {
            defaultValue:
              'Пространственная доска карточек. Стрелки — перемещение, Tab — следующая карточка, ⌘K — прыжок.',
          })}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPan}
          onPointerCancel={() => {
            dragRef.current = null
            setIsPanning(false)
          }}
          onFocus={(e) => {
            if (e.target === e.currentTarget) selectCard(selectedRef.current, { ensure: false })
          }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: 0, height: 0, transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`, willChange: 'transform' }}
          >
            {CARDS.map((card) => (
              <BoardCard
                key={card.id}
                card={card}
                lod={lod}
                z={cam.z}
                selected={card.id === selectedId}
                hovered={card.id === hoveredId}
                transition={focusTransition}
                onHover={setHoveredId}
                onFocusCard={(el) => {
                  let visible = true
                  try {
                    visible = el.matches(':focus-visible')
                  } catch {
                    visible = true
                  }
                  if (visible) selectCard(card.id, { ensure: true })
                }}
                onOpen={() => openCard(card.id)}
                onOpenCard={openCard}
                onToast={showToast}
                t={t}
              />
            ))}
          </div>
        </div>

        {/* zoom controls */}
        <div
          role="group"
          aria-label="Масштаб"
          className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-[var(--radius-control)] bg-[var(--surface-elevated)] p-[3px] shadow-middle"
        >
          <IconButton label={t('orbit.zoomOut', { defaultValue: 'Уменьшить' })} onClick={() => animateTo(cam.x, cam.y, cam.z / ZOOM_STEP, 160)}>
            <Minus className="icon-toolbar" aria-hidden />
          </IconButton>
          <span className="min-w-[46px] text-center font-mono text-[length:var(--text-caption)] text-[color:var(--text-secondary)]">{zoomPct}%</span>
          <IconButton label={t('orbit.zoomIn', { defaultValue: 'Увеличить' })} onClick={() => animateTo(cam.x, cam.y, cam.z * ZOOM_STEP, 160)}>
            <Plus className="icon-toolbar" aria-hidden />
          </IconButton>
          <IconButton label={t('orbit.zoomFit', { defaultValue: 'Показать всю доску' })} onClick={() => fit(true)}>
            <Maximize2 className="icon-toolbar" aria-hidden />
          </IconButton>
        </div>

        {/* minimap */}
        {minimapVisible && (
          <aside
            aria-label={t('orbit.minimap', { defaultValue: 'Мини-карта' })}
            className={cn(
              'absolute right-3 z-chrome w-[216px] rounded-[var(--radius-card)] bg-[var(--surface-elevated)] p-2 shadow-middle',
              narrow ? 'bottom-[84px]' : 'bottom-3',
            )}
          >
            <div className="mb-1.5 flex items-center gap-1.5 text-[length:var(--text-caption)] text-[color:var(--orbit-text-quiet)]">
              <MapIcon className="icon-status" aria-hidden />
              <b className="font-medium text-[color:var(--text-secondary)]">{t('orbit.boardName', { defaultValue: 'Доска' })}</b>
              <span className="ml-auto">{t('orbit.minimapHint', { defaultValue: 'клик — переход' })}</span>
            </div>
            <div
              onClick={onMinimapClick}
              className="relative cursor-pointer overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--border-subtle)] bg-[var(--canvas)]"
              style={{ width: MM_W, height: MM_H }}
            >
              {CARDS.map((card) => (
                <span
                  key={card.id}
                  className="absolute rounded-[var(--radius-xs)]"
                  style={{
                    left: minimap.ox + card.x * minimap.k,
                    top: minimap.oy + card.y * minimap.k,
                    width: minimap.cw,
                    height: minimap.ch,
                    background: card.id === selectedId ? 'var(--accent)' : 'color-mix(in oklch, var(--foreground) 22%, transparent)',
                  }}
                />
              ))}
              <span
                className="pointer-events-none absolute rounded-[var(--radius-xs)] border-[1.5px] border-[color:var(--accent)]"
                style={{
                  left: minimap.ox + (-cam.x / cam.z) * minimap.k,
                  top: minimap.oy + (-cam.y / cam.z) * minimap.k,
                  width: (size.w / cam.z) * minimap.k,
                  height: (size.h / cam.z) * minimap.k,
                  background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                }}
              />
            </div>
          </aside>
        )}
      </div>

      {/* status bar */}
      <footer
        className="flex shrink-0 items-center gap-3 border-t border-[color:var(--border-subtle)] bg-[var(--surface-elevated)] px-3 text-[length:var(--chrome-font-size-sm)] text-[color:var(--orbit-text-quiet)]"
        style={{ height: 'var(--chrome-status-height)' }}
      >
        <span>
          <b className="font-medium text-[color:var(--text-secondary)]">{CARDS.length}</b>{' '}
          {t('orbit.statusCards', { defaultValue: 'карточек на доске' })}
        </span>
        <span className="truncate">
          {t('orbit.statusFocus', { defaultValue: 'фокус' })}:{' '}
          <b className="font-medium text-[color:var(--text-secondary)]">{selectedCard.title}</b>
        </span>
        {!narrow && (
          <span className="truncate text-[length:var(--text-caption)]">
            {t('orbit.statusHint', { defaultValue: 'Space+перетаскивание — панорама · Tab — следующая · ⌘K — прыжок' })}
          </span>
        )}
        <span className="ml-auto">
          <b className="font-medium text-[color:var(--text-secondary)]">{zoomPct}%</b>
        </span>
      </footer>

      {/* «Прыжок» command palette */}
      {paletteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('orbit.jumpTitle', { defaultValue: 'Прыжок к карточке' })}
          data-orbit-overlay
          className="absolute inset-0 z-scrim flex items-start justify-center px-4 pt-[14%]"
          style={{ background: 'var(--dialog-backdrop)' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closePalette()
          }}
        >
          <div className="flex max-h-[60vh] w-[520px] max-w-full flex-col overflow-hidden rounded-[var(--radius-overlay)] bg-[var(--surface-popover)] shadow-modal-small">
            <div className="flex items-center gap-2 border-b border-[color:var(--border-subtle)] px-3 py-2.5">
              <CornerDownRight className="icon-toolbar text-[color:var(--orbit-text-quiet)]" aria-hidden />
              <input
                autoFocus
                type="text"
                value={paletteQuery}
                onChange={(e) => {
                  setPaletteQuery(e.target.value)
                  setPaletteIdx(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setPaletteIdx(Math.min(paletteItems.length - 1, safePaletteIdx + 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setPaletteIdx(Math.max(0, safePaletteIdx - 1))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    const item = paletteItems[safePaletteIdx]
                    if (item) {
                      closePalette()
                      openCard(item.id)
                    }
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    closePalette()
                  }
                }}
                placeholder={t('orbit.jumpSearchPlaceholder', {
                  defaultValue: 'Прыжок: имя карточки, сессии, заметки…',
                })}
                aria-label={t('orbit.jumpSearchLabel', { defaultValue: 'Поиск карточки' })}
                className="flex-1 bg-transparent font-sans text-[length:var(--text-body)] text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--orbit-text-quiet)]"
              />
              <kbd className="rounded-[var(--radius-xs)] border border-[color:var(--border-subtle)] bg-[var(--surface-elevated)] px-1 py-0.5 font-mono text-caption text-[color:var(--text-secondary)]">
                Esc
              </kbd>
            </div>
            <div className="overflow-y-auto p-1.5" role="listbox" aria-label={t('orbit.jumpGroupCards', { defaultValue: 'Карточки на доске' })}>
              {paletteItems.length === 0 ? (
                <div className="p-4 text-center text-[length:var(--text-small)] text-[color:var(--orbit-text-quiet)]">
                  {t('orbit.jumpEmpty', { defaultValue: 'Ничего не найдено по запросу' })} «{paletteQuery}»
                </div>
              ) : (
                <>
                  <div className="px-2 pb-0.5 pt-1.5 text-[length:var(--text-caption)] text-[color:var(--orbit-text-quiet)]">
                    {t('orbit.jumpGroupCards', { defaultValue: 'Карточки на доске' })}
                  </div>
                  {paletteItems.map((card, i) => {
                    const Icon = TYPE_META[card.type].icon
                    return (
                      <button
                        key={card.id}
                        type="button"
                        role="option"
                        aria-selected={i === safePaletteIdx}
                        onMouseMove={() => setPaletteIdx(i)}
                        onClick={() => {
                          closePalette()
                          openCard(card.id)
                        }}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[color:var(--text-secondary)]',
                          i === safePaletteIdx && 'bg-[var(--surface-selected)] text-[color:var(--text-primary)]',
                        )}
                      >
                        <Icon className="icon-toolbar shrink-0 text-[color:var(--orbit-text-quiet)]" aria-hidden />
                        <b className="font-medium text-[length:var(--text-small)] text-[color:var(--text-primary)]">{card.title}</b>
                        <span className="ml-auto shrink-0 font-mono text-[length:var(--text-caption)] text-[color:var(--orbit-text-quiet)]">
                          {TYPE_META[card.type].label} · {card.statusLabel}
                        </span>
                      </button>
                    )
                  })}
                </>
              )}
            </div>
            <div className="flex gap-3 border-t border-[color:var(--border-subtle)] px-3 py-2 text-[length:var(--text-caption)] text-[color:var(--orbit-text-quiet)]">
              <span>{t('orbit.jumpHintSelect', { defaultValue: '↑↓ — выбор' })}</span>
              <span>{t('orbit.jumpHintGo', { defaultValue: '↵ — перейти' })}</span>
            </div>
          </div>
        </div>
      )}

      {/* static status toast (never auto-animated) */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="absolute bottom-10 left-1/2 z-toast -translate-x-1/2 rounded-[var(--radius-control)] bg-[var(--surface-popover)] px-3 py-2 text-[length:var(--text-small)] text-[color:var(--text-secondary)] shadow-middle"
        >
          {toast}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- pieces - */

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-[var(--radius-control)] text-[color:var(--text-secondary)] outline-none hover:bg-[var(--state-hover)] hover:text-[color:var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]"
    >
      {children}
    </button>
  )
}

interface BoardCardProps {
  card: OrbitCard
  lod: Lod
  z: number
  selected: boolean
  hovered: boolean
  transition: string
  onHover: (id: string | null) => void
  onFocusCard: (el: HTMLElement) => void
  onOpen: () => void
  onOpenCard: (id: string) => void
  onToast: (message: string) => void
  t: TFunction
}

function BoardCard({ card, lod, z, selected, hovered, transition, onHover, onFocusCard, onOpen, onOpenCard, onToast, t }: BoardCardProps) {
  const meta = TYPE_META[card.type]
  const Icon = meta.icon
  const foot = FOOT[lod]
  const blocks = lod === 'detail' ? card.detail : card.standard
  const footerText =
    card.type === 'session'
      ? `${card.time} назад`
      : card.type === 'note'
        ? `${card.time} чтения`
        : card.type === 'terminal'
          ? `zsh · ${card.time}`
          : card.statusLabel

  const statusChip = (
    <span className="inline-flex h-[18px] items-center gap-1.5 rounded-full border border-[color:var(--border-subtle)] bg-[var(--surface-rail)] px-1.5 text-[length:var(--text-caption)] text-[color:var(--text-secondary)]">
      <Dot status={card.status} size={6} />
      {card.statusLabel}
    </span>
  )

  return (
    <div
      data-card-id={card.id}
      data-type={card.type}
      role="button"
      tabIndex={0}
      aria-label={`${meta.label}: ${card.title}. ${card.statusLabel}`}
      onPointerEnter={() => onHover(card.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={(e) => onFocusCard(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'absolute left-0 top-0 flex origin-top-left flex-col rounded-[var(--radius-card)] text-left outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]',
        selected || hovered ? 'shadow-strong' : 'shadow-thin',
      )}
      style={{
        width: foot.w,
        height: foot.h,
        transform: `translate(${card.x}px, ${card.y}px) scale(${1 / z})`,
        background: selected ? 'var(--orbit-card-bg-selected)' : 'var(--orbit-card-bg)',
        transition,
      }}
    >
      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[var(--radius-card)] ring-2 ring-inset ring-[color:var(--focus)]"
        />
      )}

      {lod === 'mini' ? (
        <div className="flex flex-1 items-center gap-2 px-2.5">
          <Icon className="icon-toolbar shrink-0 text-[color:var(--orbit-text-quiet)]" aria-hidden />
          <span className="truncate text-[length:var(--text-small)] font-medium text-[color:var(--text-primary)]">{card.title}</span>
          <span className="ml-auto">
            <Dot status={card.status} />
          </span>
        </div>
      ) : (
        <>
          <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-[color:var(--border-subtle)] px-2.5">
            <Icon className="icon-toolbar shrink-0 text-[color:var(--orbit-text-quiet)]" aria-hidden />
            <span className="truncate text-[length:var(--text-small)] font-semibold text-[color:var(--text-primary)]">{card.title}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {statusChip}
              <ChevronRight className="icon-caption text-[color:var(--orbit-text-quiet)]" aria-hidden />
            </span>
          </div>

          {lod === 'detail' && card.type === 'session' ? (
            <div className="min-h-0 flex-1 overflow-hidden p-3">{blocks.map((b, i) => renderBlock(b, i, t, onToast))}</div>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden p-2.5">{blocks.map((b, i) => renderBlock(b, i, t, onToast))}</div>
          )}

          {lod === 'detail' && card.type === 'session' ? (
            <Composer t={t} onSend={() => onToast(t('orbit.toast.sent', { defaultValue: 'Сообщение отправлено в сессию' }))} />
          ) : (
            <div className="flex h-[26px] shrink-0 items-center gap-1.5 border-t border-[color:var(--border-subtle)] px-2.5 text-[length:var(--text-caption)] text-[color:var(--orbit-text-quiet)]">
              {card.type === 'session' && <GitBranch className="icon-status" aria-hidden />}
              {card.type === 'note' && <FileText className="icon-status" aria-hidden />}
              {card.type === 'terminal' && <Terminal className="icon-status" aria-hidden />}
              {card.type === 'meeting' && <CalendarDays className="icon-status" aria-hidden />}
              <span>{footerText}</span>
              <MoreHorizontal className="ml-auto icon-caption" aria-hidden />
            </div>
          )}
        </>
      )}

      {/* «орбита» — pinned satellites, only on the focused card */}
      {selected && lod !== 'mini' && (
        <div className="pointer-events-none absolute inset-0">
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 rounded-[var(--radius-card)] border border-dashed"
            style={{
              width: `calc(100% + 88px)`,
              height: `calc(100% + 68px)`,
              transform: 'translate(-50%, -50%)',
              borderColor: 'var(--orbit-ring-stroke)',
            }}
          />
          {SATELLITES.map((sat) => (
            <button
              key={`${sat.pos}-${sat.name}`}
              type="button"
              data-sat={sat.kind}
              aria-label={`${sat.kind === 'agent' ? 'Агент' : 'Сессия'}: ${sat.name}`}
              onClick={(e) => {
                e.stopPropagation()
                if (sat.target) onOpenCard(sat.target)
                else onToast(t('orbit.toast.pinned', { defaultValue: `Агент «${sat.name}» закреплён за этой карточкой` }))
              }}
              className="pointer-events-auto absolute grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]"
              style={SAT_POS[sat.pos]}
            >
              <span className="flex h-[30px] items-center gap-1.5 rounded-full bg-[var(--surface-elevated)] pl-1 pr-2.5 text-[length:var(--text-caption)] text-[color:var(--text-secondary)] shadow-middle">
                <span className="relative grid size-[22px] place-items-center rounded-full bg-[color-mix(in_oklch,var(--accent)_15%,var(--surface-elevated))] text-caption font-semibold text-[color:var(--accent-text)]">
                  {sat.ini}
                  <span
                    className="absolute -bottom-px -right-px size-2 rounded-full border-[1.5px] border-[color:var(--surface-elevated)]"
                    style={{ background: STATUS_COLOR[sat.status] }}
                  />
                </span>
                <span className="whitespace-nowrap font-medium">{sat.name}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Composer({ t, onSend }: { t: TFunction; onSend: () => void }) {
  const chip = 'inline-flex h-[22px] items-center gap-1.5 rounded-full border border-[color:var(--border-subtle)] bg-[var(--surface-rail)] px-1.5 text-[length:var(--text-caption)] text-[color:var(--text-secondary)]'
  return (
    <div className="shrink-0 rounded-b-[var(--radius-card)] border-t border-[color:var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 pb-2.5 pt-2">
      <div className="rounded-[var(--radius-composer)] border border-[color:var(--border-subtle)] bg-[var(--surface-input)] px-2.5 py-2">
        <div className="text-[length:var(--text-small)] text-[color:var(--orbit-text-quiet)]">
          {t('orbit.composerPlaceholder', { defaultValue: 'Ответьте или поставьте задачу…' })}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-[color:color-mix(in_oklch,var(--accent)_40%,var(--border-subtle))] bg-[color-mix(in_oklch,var(--accent)_10%,var(--surface-elevated))] px-1.5 text-[length:var(--text-caption)] text-[color:var(--accent-text)]">
            <Cpu className="icon-status" aria-hidden /> Rox-1
          </span>
          <span className={chip}>
            <Shield className="icon-status" aria-hidden /> Спрашивать
          </span>
          <span className="ml-auto flex items-center gap-1">
            <span className={chip}>
              <Paperclip className="icon-status" aria-hidden /> Вложить
            </span>
            <span className={chip}>
              <Mic className="icon-status" aria-hidden /> Голос
            </span>
            <button
              type="button"
              aria-label={t('orbit.send', { defaultValue: 'Отправить' })}
              onClick={onSend}
              className="grid size-6 place-items-center rounded-[var(--radius-control)] bg-[var(--accent)] text-[color:var(--accent-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]"
            >
              <Send className="icon-caption" aria-hidden />
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

function renderBlock(
  block: Block,
  key: number,
  t: TFunction,
  onToast: (message: string) => void,
): React.ReactNode {
  switch (block.k) {
    case 'msg':
      return (
        <div key={key} className={cn('mb-2 flex gap-2', block.r === 'ai' && 'flex-row')}>
          <span
            className="grid size-[18px] shrink-0 place-items-center rounded-full text-caption font-semibold"
            style={{
              background:
                block.r === 'ai'
                  ? 'color-mix(in oklch, var(--accent) 16%, var(--surface-elevated))'
                  : 'color-mix(in oklch, var(--foreground) 8%, var(--surface-elevated))',
              color: block.r === 'ai' ? 'var(--accent-text)' : 'var(--text-secondary)',
            }}
          >
            {block.r === 'ai' ? 'R' : 'В'}
          </span>
          <span
            className="line-clamp-2 min-w-0 text-[length:var(--text-small)] leading-normal"
            style={{ color: block.r === 'ai' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          >
            {block.t}
          </span>
        </div>
      )
    case 'tool':
      return (
        <div
          key={key}
          className="my-1.5 flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--border-subtle)] bg-[var(--surface-rail)] px-2 py-1.5 font-mono text-[length:var(--text-caption)] text-[color:var(--text-secondary)]"
        >
          <GitBranch className="icon-status shrink-0 text-[color:var(--orbit-text-quiet)]" aria-hidden />
          <span className="truncate">{block.t}</span>
          <span className="ml-auto flex shrink-0 gap-2">
            <span style={{ color: 'var(--status-success)' }}>{block.a}</span>
            <span style={{ color: 'var(--status-danger)' }}>{block.d}</span>
          </span>
        </div>
      )
    case 'turn':
      return (
        <div key={key} className="mb-3 flex gap-2.5">
          <span
            className="grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold"
            style={{
              background:
                block.r === 'ai'
                  ? 'color-mix(in oklch, var(--accent) 16%, var(--surface-elevated))'
                  : 'color-mix(in oklch, var(--foreground) 8%, var(--surface-elevated))',
              color: block.r === 'ai' ? 'var(--accent-text)' : 'var(--text-secondary)',
            }}
          >
            {block.r === 'ai' ? 'R' : 'В'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 text-[length:var(--text-caption)] text-[color:var(--orbit-text-quiet)]">{block.name}</div>
            <div className="text-[length:var(--text-body)] leading-relaxed" style={{ color: block.r === 'ai' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {block.t.map((p, i) => (
                <p key={i} className="mb-1.5 last:mb-0">
                  {p}
                </p>
              ))}
              {block.ul && (
                <ul className="mt-0.5 list-disc pl-4 text-[length:var(--text-small)]">
                  {block.ul.map((li, i) => (
                    <li key={i} className="leading-relaxed">
                      {li}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )
    case 'approval':
      return (
        <div
          key={key}
          className="my-1.5 rounded-[var(--radius-sm)] border p-2 text-[length:var(--text-caption)] text-[color:var(--text-secondary)]"
          style={{
            background: 'color-mix(in oklch, var(--status-warning) 10%, var(--surface-elevated))',
            borderColor: 'color-mix(in oklch, var(--status-warning) 32%, var(--border-subtle))',
          }}
        >
          <b className="mb-0.5 block text-[length:var(--text-small)] font-semibold text-[color:var(--text-primary)]">{block.t}</b>
          {block.s}
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              data-approve
              onClick={() => onToast(t('orbit.toast.approved', { defaultValue: 'Доступ разрешён — агент продолжает работу' }))}
              className="inline-flex h-[22px] items-center gap-1.5 rounded-full border px-1.5 text-[length:var(--text-caption)] text-[color:var(--accent-text)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]"
              style={{
                borderColor: 'color-mix(in oklch, var(--accent) 40%, var(--border-subtle))',
                background: 'color-mix(in oklch, var(--accent) 10%, var(--surface-elevated))',
              }}
            >
              <Check className="icon-status" aria-hidden /> {block.yes}
            </button>
            <button
              type="button"
              data-deny
              onClick={() => onToast(t('orbit.toast.denied', { defaultValue: 'Отклонено — агент остановился и ждёт инструкций' }))}
              className="inline-flex h-[22px] items-center rounded-full border border-[color:var(--border-subtle)] bg-[var(--surface-rail)] px-1.5 text-[length:var(--text-caption)] text-[color:var(--text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]"
            >
              {block.no}
            </button>
          </div>
        </div>
      )
    case 'term':
      return (
        <div key={key} className="whitespace-pre-wrap break-words font-mono text-[length:var(--text-caption)] leading-relaxed">
          {block.lines.map((line, i) => (
            <div key={i}>
              {line.map((seg, j) => (
                <span key={j} style={seg.tone ? { color: TONE_COLOR[seg.tone] } : { color: 'var(--text-secondary)' }}>
                  {seg.t}
                </span>
              ))}
            </div>
          ))}
        </div>
      )
    case 'h':
      return (
        <h4 key={key} className="mb-1.5 text-[length:var(--text-small)] font-semibold text-[color:var(--text-primary)]">
          {block.t}
        </h4>
      )
    case 'p':
      return (
        <p key={key} className="mb-1.5 text-[length:var(--text-small)] leading-normal text-[color:var(--text-secondary)]">
          {block.t}
        </p>
      )
    case 'ul':
      return (
        <ul key={key} className="list-disc pl-4">
          {block.li.map((li, i) => (
            <li key={i} className="text-[length:var(--text-small)] leading-relaxed text-[color:var(--text-secondary)]">
              {li}
            </li>
          ))}
        </ul>
      )
    case 'tk':
      return (
        <div key={key} className="flex items-center gap-2 py-1 text-[length:var(--text-small)] text-[color:var(--text-secondary)]">
          <span
            className="grid size-3.5 shrink-0 place-items-center rounded-[var(--radius-xs)] border-[1.5px]"
            style={{
              borderColor: block.d ? 'var(--status-success)' : 'var(--border-strong)',
              background: block.d ? 'var(--status-success)' : 'transparent',
              color: block.d ? 'var(--surface-elevated)' : 'transparent',
            }}
          >
            {block.d && <Check className="h-full w-full" aria-hidden />}
          </span>
          <span className={cn('min-w-0 flex-1 truncate', block.d && 'text-[color:var(--orbit-text-quiet)] line-through')}>{block.t}</span>
          <span
            className="shrink-0 font-mono text-[length:var(--text-caption)]"
            style={{ color: block.due === 'сегодня' && !block.d ? 'var(--status-warning)' : 'var(--orbit-text-quiet)' }}
          >
            {block.due}
          </span>
        </div>
      )
    case 'progress':
      return (
        <div key={key}>
          <div className="my-2 h-1 overflow-hidden rounded-full bg-[var(--surface-rail)]">
            <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round(block.v * 100)}%` }} />
          </div>
          <div className="mb-1.5 text-[length:var(--text-caption)] text-[color:var(--orbit-text-quiet)]">{block.t}</div>
        </div>
      )
    case 'mt':
      return (
        <div key={key} className="flex gap-2.5 border-b border-[color:var(--border-subtle)] py-1.5 text-[length:var(--text-small)] text-[color:var(--text-secondary)] last:border-b-0">
          <span className="w-[42px] shrink-0 font-mono text-[length:var(--text-caption)] text-[color:var(--orbit-text-quiet)]">{block.t}</span>
          <span className="min-w-0 flex-1">
            <b className="font-medium text-[color:var(--text-primary)]">{block.b}</b> — {block.x}
          </span>
        </div>
      )
    case 'note':
      return (
        <div key={key} className="flex gap-2.5 py-1.5 text-[length:var(--text-small)] text-[color:var(--orbit-text-quiet)]">
          <span className="min-w-0 flex-1">{block.t}</span>
        </div>
      )
    default:
      return null
  }
}