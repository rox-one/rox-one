import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { InspectorResizeSash } from '../InspectorResizeSash'

const i18n = createInstance()
await i18n.init({
  lng: 'en', fallbackLng: 'en',
  resources: { en: { translation: {
    'inspector.resize': 'Resize inspector',
    'shell.resize.valuePx': '{{value}} pixels',
  } } },
})

function render(active: boolean) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <InspectorResizeSash
        width={336}
        viewportWidth={1440}
        controlsId="inspector-content"
        active={active}
        onPreview={() => {}}
        onCommit={() => {}}
        onCancel={() => {}}
      />
    </I18nextProvider>,
  )
}

describe('inspector resize accessible contract', () => {
  it('names a keyboard-reachable separator and exposes its real width and limits', () => {
    const html = render(true)
    expect(html).toContain('role="separator"')
    // Combined renderer suites may install a key-returning i18n mock.
    expect(html).toMatch(/aria-label="(?:Resize inspector|inspector.resize)"/)
    expect(html).toContain('aria-controls="inspector-content"')
    expect(html).toContain('aria-orientation="vertical"')
    expect(html).toContain('aria-valuemin="280"')
    expect(html).toContain('aria-valuemax="864"')
    expect(html).toContain('aria-valuenow="336"')
    expect(html).toContain('tabindex="0"')
  })

  it('removes a retained hidden inspector sash from the keyboard tab sequence', () => {
    expect(render(false)).toContain('tabindex="-1"')
  })
})
