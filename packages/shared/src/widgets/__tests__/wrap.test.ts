import { describe, expect, it } from 'bun:test'
import {
  WIDGET_BOOTSTRAP_MESSAGE_TYPE,
  WIDGET_BRIDGE_GLOBAL,
  WIDGET_READY_MESSAGE_TYPE,
  WIDGET_SIZE_MESSAGE_TYPE,
  assertWidgetConnectOrigin,
  buildWidgetDocument,
} from '../wrap.ts'

const WIDGET_CODE = '<div data-widget-probe="b3">hello &amp; <b>world</b></div>'

function cspOf(document: string): string {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(document)
  if (!match) throw new Error('widget document has no Content-Security-Policy meta')
  return match[1]!
}

describe('buildWidgetDocument — document skeleton', () => {
  it('emits a complete standalone document with the widget code as its body', () => {
    const document = buildWidgetDocument('Widget', WIDGET_CODE)
    expect(document.startsWith('<!doctype html>\n<html><head>')).toBe(true)
    expect(document).toContain('<meta charset="utf-8">')
    expect(document).toContain('<meta name="viewport" content="width=device-width,initial-scale=1">')
    expect(document).toContain('<meta name="referrer" content="no-referrer">')
    expect(document.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1)
    expect(document.endsWith(`${WIDGET_CODE}</body></html>`)).toBe(true)
  })

  it('embeds the widget code verbatim, not escaped', () => {
    const code = '<span>&</span> "quoted" </div>'
    expect(buildWidgetDocument('Widget', code)).toContain(code)
  })
})

describe('buildWidgetDocument — bridge ordering', () => {
  it('emits the bridge bootstrap bytes strictly before the widget code', () => {
    const document = buildWidgetDocument('Widget', WIDGET_CODE)
    const bridgeOffset = document.indexOf(WIDGET_BOOTSTRAP_MESSAGE_TYPE)
    const widgetOffset = document.indexOf(WIDGET_CODE)
    expect(bridgeOffset).toBeGreaterThan(-1)
    expect(widgetOffset).toBeGreaterThan(-1)
    expect(bridgeOffset).toBeLessThan(widgetOffset)
  })

  it('installs the bridge global and offers the port before the widget code', () => {
    const document = buildWidgetDocument('Widget', WIDGET_CODE)
    const widgetOffset = document.indexOf(WIDGET_CODE)
    expect(document.indexOf('new MessageChannel()')).toBeLessThan(widgetOffset)
    expect(document.indexOf(WIDGET_BRIDGE_GLOBAL)).toBeLessThan(widgetOffset)
    expect(document.indexOf(WIDGET_READY_MESSAGE_TYPE)).toBeLessThan(widgetOffset)
    expect(document.indexOf('channel.port2')).toBeLessThan(widgetOffset)
  })

  it('emits the size reporter before the widget code', () => {
    const document = buildWidgetDocument('Widget', WIDGET_CODE)
    expect(document.indexOf(WIDGET_SIZE_MESSAGE_TYPE)).toBeLessThan(document.indexOf(WIDGET_CODE))
    expect(document).toContain('new ResizeObserver(report).observe(document.body)')
  })
})

describe('buildWidgetDocument — content security policy', () => {
  it('isolates the document and keeps the network closed by default', () => {
    const csp = cspOf(buildWidgetDocument('Widget', WIDGET_CODE))
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('sandbox allow-scripts')
    expect(csp).toContain("script-src 'unsafe-inline'")
    expect(csp).toContain("style-src 'unsafe-inline'")
    expect(csp).toContain('img-src data:')
    expect(csp).toContain("connect-src 'none'")
  })

  it('never emits a bare scheme source', () => {
    const csp = cspOf(
      buildWidgetDocument('Widget', WIDGET_CODE, {
        connectOrigins: ['https://api.example', 'wss://live.example:8443'],
      }),
    )
    expect(csp).not.toMatch(/(?:^|;|\s)(?:https?|wss?):(?:\s|;|$)/)
    expect(csp).not.toContain('*')
    expect(csp).not.toContain("'self'")
  })

  it('widens connect-src only with the granted origins, verbatim and in order', () => {
    const document = buildWidgetDocument('Widget', WIDGET_CODE, {
      connectOrigins: ['https://api.example', 'wss://live.example:8443'],
    })
    expect(cspOf(document)).toContain('connect-src https://api.example wss://live.example:8443')
  })

  it('leaks no granted origin when none were granted', () => {
    const document = buildWidgetDocument('Widget', WIDGET_CODE, { connectOrigins: [] })
    expect(cspOf(document)).toContain("connect-src 'none'")
    expect(document).not.toContain('api.example')
  })

  it('rejects a bare scheme in connectOrigins', () => {
    expect(() => buildWidgetDocument('Widget', WIDGET_CODE, { connectOrigins: ['https:'] })).toThrow(
      /Widget connect origin is not a URL/,
    )
    expect(() => buildWidgetDocument('Widget', WIDGET_CODE, { connectOrigins: ['wss:'] })).toThrow(
      /Widget connect origin is not a URL/,
    )
    expect(() =>
      buildWidgetDocument('Widget', WIDGET_CODE, { connectOrigins: ['ftp://api.example'] }),
    ).toThrow(/must use http, https, ws or wss/)
  })
})

describe('assertWidgetConnectOrigin', () => {
  it.each([
    'https://api.example',
    'http://api.example:8080',
    'ws://live.example',
    'wss://live.example:8443',
  ])('accepts %s unchanged', (origin) => {
    expect(assertWidgetConnectOrigin(origin)).toBe(origin)
  })

  it.each([
    'https:',
    'http:',
    'ws:',
    'wss:',
    '*',
    "'self'",
    'not a url',
    'ftp://api.example',
    'data:text/html,<b>x</b>',
    'https://api.example/path',
    'https://user:pass@api.example',
  ])('rejects %s', (origin) => {
    expect(() => assertWidgetConnectOrigin(origin)).toThrow()
  })

  it('names the offending value in the error', () => {
    expect(() => assertWidgetConnectOrigin('https://api.example/a')).toThrow(/"https:\/\/api\.example\/a"/)
  })
})

describe('buildWidgetDocument — title escaping', () => {
  it('escapes the title', () => {
    const document = buildWidgetDocument('Bad </title><script>alert(1)</script> & "quoted" \'x\'', WIDGET_CODE)
    expect(document).toContain(
      '<title>Bad &lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot; &#39;x&#39;</title>',
    )
    expect(document).not.toContain('Bad </title>')
    expect(document).not.toContain('<script>alert(1)</script>')
  })
})