/** Weather via Open-Meteo (no key): geocode once (cached a day), then forecast. */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useHomeFetch } from '@/lib/home-fetch'
import type { GlanceWidgetProps } from '../registry'
import { ListSkeleton, NetStatus, useOnScreen } from './net/kit'
import { parseForecast, parseGeocode, sparkPoints, weatherGlyph, type GeoPlace } from './net/data'

export function geocodeUrl(location: string, lang: string): string | null {
  const q = location.trim().slice(0, 100)
  if (!q || /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(q)) return null
  return `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=${encodeURIComponent(lang.slice(0, 2))}&format=json`
}

export function coordsOf(location: string): GeoPlace | null {
  const m = location.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1]), lon = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { name: '', lat, lon } : null
}

export function forecastUrl(p: GeoPlace, imperial: boolean): string {
  const units = imperial ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : ''
  return `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(3)}&longitude=${p.lon.toFixed(3)}&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=7&forecast_hours=24&timezone=auto${units}`
}

export default function WeatherWidget({ config, width }: GlanceWidgetProps) {
  const { t, i18n } = useTranslation()
  const [ref, visible] = useOnScreen<HTMLDivElement>()
  const location = typeof config.location === 'string' ? config.location : ''
  const imperial = config.units === 'imperial'
  const direct = coordsOf(location)
  const geo = useHomeFetch<unknown>(direct ? null : geocodeUrl(location, i18n.language), { as: 'json', refreshMs: 24 * 60 * 60_000, paused: !visible })
  const place = direct ?? (geo.data ? parseGeocode(geo.data) : null)
  const fc = useHomeFetch<unknown>(place ? forecastUrl(place, imperial) : null, { as: 'json', refreshMs: 30 * 60_000, paused: !visible })
  const weather = fc.data ? parseForecast(fc.data) : null
  if (!location.trim()) return <p className="text-sm text-muted-foreground">{t('glance.configureHint')}</p>
  const error = geo.error ?? fc.error
  if (geo.data && !place) return <p className="text-sm text-muted-foreground">{t('omnibox.empty')}</p>
  const deg = imperial ? '°F' : '°C'
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(i18n.language, { weekday: 'short' })
  const days = weather?.days.slice(0, width < 320 ? 4 : 7) ?? []
  return (
    <div ref={ref} className="min-h-[1px]" data-glance-weather="">
      <NetStatus error={error} hasData={!!weather} onRetry={() => { geo.refresh(); fc.refresh() }} />
      {weather ? (
        <>
          <div className="flex items-center gap-3">
            <span className="text-display" aria-hidden>{weatherGlyph(weather.code)}</span>
            <div className="min-w-0">
              <div className="text-display font-bold tabular-nums text-foreground">{Math.round(weather.temp)}{deg}</div>
              <div className="truncate text-xs text-muted-foreground">{[place?.name || location, place?.country].filter(Boolean).join(', ')}{weather.wind !== undefined ? ` · ${Math.round(weather.wind)} ${imperial ? 'mph' : 'km/h'}` : ''}</div>
            </div>
            {weather.hourly.length > 1 && (
              <svg viewBox="0 0 96 28" className="ml-auto h-7 w-24 text-muted-foreground" aria-hidden>
                <polyline points={sparkPoints(weather.hourly, 96, 28)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <ul className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, days.length)}, minmax(0, 1fr))` }}>
            {days.map((d) => (
              <li key={d.date} className="flex flex-col items-center rounded-[var(--radius-control)] py-1 text-xs">
                <span className="text-muted-foreground">{day(d.date)}</span>
                <span aria-hidden>{weatherGlyph(d.code)}</span>
                <span className="tabular-nums text-foreground">{Math.round(d.max)}°</span>
                <span className="tabular-nums text-muted-foreground">{Math.round(d.min)}°</span>
              </li>
            ))}
          </ul>
        </>
      ) : !error && <ListSkeleton rows={3} />}
    </div>
  )
}
