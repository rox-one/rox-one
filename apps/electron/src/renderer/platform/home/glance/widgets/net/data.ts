/**
 * Parsers for weather (Open-Meteo), markets (Yahoo chart API) and iCalendar.
 * Untrusted input: everything is type-checked and capped.
 */
import { safeLink } from './parsers'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : NaN)) : [])

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export interface GeoPlace { name: string; lat: number; lon: number; country?: string }

export function parseGeocode(raw: unknown): GeoPlace | null {
  const r = isRecord(raw) && Array.isArray(raw.results) ? raw.results[0] : null
  if (!isRecord(r)) return null
  const lat = r.latitude, lon = r.longitude
  if (typeof lat !== 'number' || typeof lon !== 'number' || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { name: typeof r.name === 'string' ? r.name.slice(0, 80) : '', lat, lon, ...(typeof r.country === 'string' ? { country: r.country.slice(0, 60) } : {}) }
}

export interface WeatherDay { date: string; max: number; min: number; code: number }
export interface Weather { temp: number; code: number; wind?: number; days: WeatherDay[]; hourly: number[] }

export function parseForecast(raw: unknown): Weather | null {
  if (!isRecord(raw) || !isRecord(raw.current)) return null
  const temp = raw.current.temperature_2m
  const code = raw.current.weather_code
  if (typeof temp !== 'number' || typeof code !== 'number') return null
  const d = isRecord(raw.daily) ? raw.daily : {}
  const dates = Array.isArray(d.time) ? d.time : []
  const max = nums(d.temperature_2m_max), min = nums(d.temperature_2m_min), codes = nums(d.weather_code)
  const days: WeatherDay[] = []
  for (let i = 0; i < Math.min(dates.length, 7); i++) {
    const date = dates[i]
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(max[i]!) || !Number.isFinite(min[i]!)) continue
    days.push({ date, max: max[i]!, min: min[i]!, code: Number.isFinite(codes[i]!) ? codes[i]! : 0 })
  }
  const h = isRecord(raw.hourly) ? nums(raw.hourly.temperature_2m).filter(Number.isFinite).slice(0, 24) : []
  const wind = raw.current.wind_speed_10m
  return { temp, code, ...(typeof wind === 'number' ? { wind } : {}), days, hourly: h }
}

/** WMO weather code → glyph (no strings to translate). */
export function weatherGlyph(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code <= 48) return '🌫️'
  if (code <= 57) return '🌦️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '🌨️'
  if (code <= 82) return '🌧️'
  if (code <= 86) return '🌨️'
  return '⛈️'
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

export interface Quote { symbol: string; name: string; price: number; prev: number; currency: string; closes: number[] }

export function cleanSymbol(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toUpperCase()
  return /^[A-Z0-9^][A-Z0-9.=^-]{0,19}$/.test(v) ? v : null
}

export function parseChart(raw: unknown): Quote | null {
  const result = isRecord(raw) && isRecord(raw.chart) && Array.isArray(raw.chart.result) ? raw.chart.result[0] : null
  if (!isRecord(result) || !isRecord(result.meta)) return null
  const m = result.meta
  const price = m.regularMarketPrice
  if (typeof price !== 'number' || typeof m.symbol !== 'string') return null
  const q = isRecord(result.indicators) && Array.isArray(result.indicators.quote) ? result.indicators.quote[0] : null
  const closes = isRecord(q) ? nums(q.close).filter(Number.isFinite).slice(-120) : []
  const prev = typeof m.chartPreviousClose === 'number' ? m.chartPreviousClose : typeof m.previousClose === 'number' ? m.previousClose : closes[0] ?? price
  const name = typeof m.shortName === 'string' ? m.shortName : typeof m.longName === 'string' ? m.longName : m.symbol
  return { symbol: m.symbol.slice(0, 20), name: name.slice(0, 60), price, prev, currency: typeof m.currency === 'string' ? m.currency.slice(0, 5) : '', closes }
}

/** Polyline points for a sparkline in a w×h box. */
export function sparkPoints(values: readonly number[], w: number, h: number): string {
  if (values.length < 2) return ''
  const lo = Math.min(...values), hi = Math.max(...values)
  const span = hi - lo || 1
  return values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - lo) / span) * h).toFixed(1)}`).join(' ')
}

// ---------------------------------------------------------------------------
// iCalendar (RFC 5545 subset: VEVENT, DTSTART/DTEND, SUMMARY, LOCATION, URL,
// simple DAILY/WEEKLY/MONTHLY/YEARLY RRULE with COUNT/UNTIL/INTERVAL)
// ---------------------------------------------------------------------------

export interface CalEvent { id: string; title: string; start: number; end?: number; allDay: boolean; location?: string; url?: string }

function unfold(text: string): string[] {
  return text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()
}

/** DTSTART value → epoch ms. Floating / TZID times are read as local time. */
export function parseIcalDate(value: string, params: string): { at: number; allDay: boolean } | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return null
  const [, y, mo, d, hh, mi, ss, z] = m
  const allDay = !hh || /VALUE=DATE(?!-)/i.test(params)
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(hh ?? 0), Number(mi ?? 0), Number(ss ?? 0)] as const
  const at = z ? Date.UTC(...parts) : new Date(...parts).getTime()
  return Number.isFinite(at) ? { at, allDay } : null
}

const STEP: Record<string, (d: Date, n: number) => void> = {
  DAILY: (d, n) => d.setDate(d.getDate() + n),
  WEEKLY: (d, n) => d.setDate(d.getDate() + 7 * n),
  MONTHLY: (d, n) => d.setMonth(d.getMonth() + n),
  YEARLY: (d, n) => d.setFullYear(d.getFullYear() + n),
}

export function parseIcal(text: string, from: number, to: number, limit = 50): CalEvent[] {
  if (typeof text !== 'string' || text.length > 5_000_000) return []
  const out: CalEvent[] = []
  let cur: Record<string, { value: string; params: string }> | null = null
  let n = 0
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue }
    if (line === 'END:VEVENT') {
      if (cur && ++n <= 5000) expand(cur, from, to, out)
      cur = null
      continue
    }
    if (!cur) continue
    const colon = line.indexOf(':')
    if (colon < 1) continue
    const head = line.slice(0, colon)
    const semi = head.indexOf(';')
    const name = (semi < 0 ? head : head.slice(0, semi)).toUpperCase()
    cur[name] = { value: line.slice(colon + 1), params: semi < 0 ? '' : head.slice(semi + 1) }
  }
  return out.sort((a, b) => a.start - b.start).slice(0, limit)
}

function expand(ev: Record<string, { value: string; params: string }>, from: number, to: number, out: CalEvent[]): void {
  if (ev.STATUS?.value.toUpperCase() === 'CANCELLED' || !ev.DTSTART) return
  const start = parseIcalDate(ev.DTSTART.value.trim(), ev.DTSTART.params)
  if (!start) return
  const end = ev.DTEND ? parseIcalDate(ev.DTEND.value.trim(), ev.DTEND.params) : null
  const dur = end ? Math.max(0, end.at - start.at) : start.allDay ? 86_400_000 : 0
  const title = unescapeText(ev.SUMMARY?.value ?? '').slice(0, 200)
  if (!title) return
  const location = ev.LOCATION ? unescapeText(ev.LOCATION.value).slice(0, 200) : ''
  const url = ev.URL ? safeLink(ev.URL.value.trim()) : null
  const base = { title, allDay: start.allDay, ...(location ? { location } : {}), ...(url ? { url } : {}) }
  const uid = (ev.UID?.value ?? title).slice(0, 200)
  const push = (at: number) => { if (at + dur >= from && at <= to) out.push({ id: `${uid}@${at}`, start: at, ...(dur ? { end: at + dur } : {}), ...base }) }
  const rule = ev.RRULE?.value
  if (!rule) return push(start.at)
  const r = Object.fromEntries(rule.split(';').map((p) => p.split('=') as [string, string]))
  const step = STEP[(r.FREQ ?? '').toUpperCase()]
  if (!step) return push(start.at)
  const interval = Math.max(1, Math.min(1000, Number(r.INTERVAL) || 1))
  const count = r.COUNT ? Math.max(1, Math.min(10_000, Number(r.COUNT) || 1)) : Infinity
  const until = r.UNTIL ? parseIcalDate(r.UNTIL, '')?.at ?? Infinity : Infinity
  const exdates = new Set(Object.entries(ev).filter(([k]) => k === 'EXDATE').flatMap(([, v]) => v.value.split(',').map((x) => parseIcalDate(x.trim(), v.params)?.at)))
  const d = new Date(start.at)
  for (let i = 0; i < count && i < 5000; i++) {
    const at = d.getTime()
    if (at > to || at > until) break
    if (!exdates.has(at)) push(at)
    step(d, interval)
  }
}
