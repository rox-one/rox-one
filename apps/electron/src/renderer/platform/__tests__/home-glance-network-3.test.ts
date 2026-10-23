import { describe, expect, it } from 'bun:test'
import { cleanSymbol, parseChart, parseForecast, parseGeocode, parseIcal, parseIcalDate, sparkPoints, weatherGlyph } from '../home/glance/widgets/net/data'
import { coordsOf, forecastUrl, geocodeUrl } from '../home/glance/widgets/WeatherWidget'
import { chartUrl, symbolList } from '../home/glance/widgets/MarketsWidget'
import { icalUrl } from '../home/glance/widgets/CalendarWidget'
import { hitsToItems } from '../home/glance/widgets/SearchWidget'

describe('glance network widgets batch 3', () => {
  it('weather', () => {
    expect(coordsOf('55.75, 37.62')).toEqual({ name: '', lat: 55.75, lon: 37.62 })
    expect(coordsOf('95,0')).toBeNull()
    expect(geocodeUrl('55.75,37.62', 'ru')).toBeNull()
    expect(geocodeUrl('Санкт Петербург', 'ru-RU')).toContain('name=%D0%A1')
    expect(forecastUrl({ name: '', lat: 1, lon: 2 }, true)).toContain('temperature_unit=fahrenheit')
    expect(parseGeocode({ results: [{ name: 'Moscow', latitude: 55.7, longitude: 37.6, country: 'Russia' }] })).toEqual({ name: 'Moscow', lat: 55.7, lon: 37.6, country: 'Russia' })
    expect(parseGeocode({})).toBeNull()
    const w = parseForecast({ current: { temperature_2m: 5.4, weather_code: 3 }, daily: { time: ['2026-10-15', 'bad'], temperature_2m_max: [8, 9], temperature_2m_min: [1, 2], weather_code: [61, 0] }, hourly: { temperature_2m: [1, 2, 'x', 3] } })
    expect(w).toMatchObject({ temp: 5.4, code: 3, days: [{ date: '2026-10-15', max: 8, min: 1, code: 61 }], hourly: [1, 2, 3] })
    expect(parseForecast({ current: {} })).toBeNull()
    expect(weatherGlyph(0)).toBe('☀️')
  })

  it('markets', () => {
    expect(cleanSymbol(' btc-usd ')).toBe('BTC-USD')
    expect(cleanSymbol('../x')).toBeNull()
    expect(symbolList(['^GSPC', 'eurusd=x', 'a b'])).toEqual(['^GSPC', 'EURUSD=X'])
    expect(chartUrl('^GSPC')).toBe('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=1mo&interval=1d')
    const q = parseChart({ chart: { result: [{ meta: { symbol: 'AAPL', regularMarketPrice: 110, chartPreviousClose: 100, currency: 'USD', shortName: 'Apple' }, indicators: { quote: [{ close: [100, null, 105, 110] }] } }] } })
    expect(q).toEqual({ symbol: 'AAPL', name: 'Apple', price: 110, prev: 100, currency: 'USD', closes: [100, 105, 110] })
    expect(parseChart({ chart: { result: null, error: {} } })).toBeNull()
    expect(sparkPoints([0, 10], 10, 10)).toBe('0.0,10.0 10.0,0.0')
    expect(sparkPoints([1], 10, 10)).toBe('')
  })

  it('iCal: single, all-day, recurring with EXDATE, cancelled', () => {
    const from = Date.UTC(2026, 9, 15)
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'UID:a', 'DTSTART:20261016T090000Z', 'DTEND:20261016T100000Z', 'SUMMARY:Stand\\, up', 'LOCATION:Room 1', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:b', 'DTSTART;VALUE=DATE:20261020', 'SUMMARY:Holiday', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:c', 'DTSTART:20261001T120000Z', 'RRULE:FREQ=WEEKLY;COUNT=10', 'EXDATE:20261022T120000Z', 'SUMMARY:Weekly', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:d', 'DTSTART:20261017T120000Z', 'STATUS:CANCELLED', 'SUMMARY:Gone', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:e', 'DTSTART:20251017T120000Z', 'SUMMARY:Past', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const ev = parseIcal(ics, from, from + 14 * 86_400_000)
    expect(ev.map((e) => e.title)).toEqual(['Weekly', 'Stand, up', 'Holiday'])
    expect(ev[1]).toMatchObject({ location: 'Room 1', allDay: false, end: Date.UTC(2026, 9, 16, 10) })
    expect(ev[2]!.allDay).toBe(true)
    expect(ev[0]!.start).toBe(Date.UTC(2026, 9, 15, 12))
    expect(parseIcalDate('garbage', '')).toBeNull()
    expect(icalUrl('webcal://cal.test/a.ics')).toBe('https://cal.test/a.ics')
    expect(icalUrl('http://cal.test/a.ics')).toBeNull()
  })

  it('search hits', () => {
    expect(hitsToItems([{ title: 'T', url: 'https://x.test', snippet: 's', publishedDate: '2026-10-01' }, { title: 'bad', url: 'javascript:1' }])).toEqual([
      { id: 'https://x.test/', title: 'T', url: 'https://x.test/', at: Date.parse('2026-10-01'), meta: 's' },
    ])
  })
})
