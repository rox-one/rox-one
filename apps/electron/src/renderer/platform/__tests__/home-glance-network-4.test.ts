import { describe, expect, it } from 'bun:test'
import { contentFingerprint } from '../home/glance/widgets/ChangeDetectionWidget'
import { parseExtension } from '../home/glance/widgets/ExtensionWidget'
import { siteState } from '../home/glance/widgets/MonitorWidget'
import { formatBytes, formatUptime } from '../home/glance/widgets/ServerStatsWidget'
import { display, getPath, hashText, pageText, parseFieldSpecs } from '../home/glance/widgets/net/json-path'

describe('glance network widgets batch 4', () => {
  it('monitor siteState', () => {
    expect(siteState(true, null)).toBe(true)
    expect(siteState(false, null)).toBeNull()
    expect(siteState(false, 'http')).toBe(false)
    expect(siteState(false, 'too-large')).toBe(true)
    expect(siteState(true, 'offline')).toBeNull()
    expect(siteState(true, 'rate-limited')).toBeNull()
  })

  it('server-stats formatters', () => {
    expect(formatBytes(1536, 'en')).toMatch(/1(\.5)?\s*KB/)
    expect(formatUptime(90)).toBe('1m')
    expect(formatUptime(3700)).toBe('1h 1m')
    expect(formatUptime(90_000)).toBe('1d 1h')
  })

  it('json-path, fields, hash, pageText', () => {
    expect(getPath({ a: { b: [null, { c: 7 }] } }, 'a.b[1].c')).toBe(7)
    expect(getPath({ a: 1 }, 'a.__proto__')).toBeUndefined()
    expect(getPath([{ x: 1 }], '0.x')).toBe(1)
    expect(parseFieldSpecs(['Price = data.price', '  alone  ', 3, ''])).toEqual([
      { label: 'Price', path: 'data.price' },
      { label: 'alone', path: 'alone' },
    ])
    expect(display(12.34567, 'en')).toMatch(/12\.3457/)
    expect(display(undefined, 'en')).toBe('—')
    expect(hashText('abc')).toBe(hashText('abc'))
    expect(hashText('abc')).not.toBe(hashText('abd'))
    expect(pageText('<html><script>evil()</script><p>Hi <b>there</b></p><!--x--></html>')).toBe('Hi there')
  })

  it('change detection fingerprint', () => {
    expect(contentFingerprint('<p>Hello</p>', '')).toBe(hashText('Hello'))
    expect(contentFingerprint(JSON.stringify({ data: { v: 2 } }), 'data.v')).toBe(hashText('2'))
    expect(contentFingerprint('not-json', 'a.b')).toBe(hashText(''))
  })

  it('extension payload', () => {
    expect(parseExtension({ text: 'hi', items: [{ title: 'A', url: 'https://x.test' }, { title: 'B', url: 'javascript:1' }, { title: '' }] })).toEqual({
      text: 'hi',
      items: [
        { id: '0:A', title: 'A', url: 'https://x.test/' },
        { id: '1:B', title: 'B', url: '' },
      ],
    })
    expect(parseExtension([])).toBeNull()
    expect(parseExtension({ text: '', items: [] })).toBeNull()
  })
})
