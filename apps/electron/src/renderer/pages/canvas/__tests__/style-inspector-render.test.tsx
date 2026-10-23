import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import type { CanvasObject } from '@rox/canvas-core'
import { StyleInspector } from '../StyleInspector'

const i18n = createInstance()
await i18n.init({
  lng: 'en', fallbackLng: 'en',
  resources: { en: { translation: {
    'canvas.inspector.title': 'Style',
    'canvas.inspector.selected': '{{count}} selected',
    'canvas.inspector.mixed': 'Mixed',
    'canvas.inspector.fill': 'Fill',
    'canvas.inspector.stroke': 'Stroke',
    'canvas.inspector.strokeWidth': 'Stroke width',
    'canvas.inspector.opacity': 'Opacity',
    'canvas.inspector.cornerRadius': 'Corner radius',
    'canvas.inspector.fontSize': 'Font size',
    'canvas.inspector.fontWeight': 'Font weight',
  } } },
})

function obj(partial: Partial<CanvasObject> & Pick<CanvasObject, 'id' | 'type'>): CanvasObject {
  return {
    parentId: null, index: 'a0', x: 0, y: 0, w: 40, h: 40, rotation: 0, opacity: 1,
    locked: false, hidden: false, style: {}, props: {}, links: [],
    ...partial,
  } as CanvasObject
}

function render(objects: CanvasObject[]) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <StyleInspector objects={objects} onChange={() => {}} />
    </I18nextProvider>,
  )
}

describe('StyleInspector render smoke', () => {
  it('renders nothing with an empty selection', () => {
    expect(render([])).toBe('')
  })

  it('shows fill/stroke/opacity for a rect and marks mixed stroke width', () => {
    const a = obj({
      id: 'a', type: 'shape', props: { kind: 'rect' },
      style: { fill: { type: 'solid', color: '#ff0000' }, stroke: { color: '#000000', width: 2 } },
    })
    const b = obj({
      id: 'b', type: 'shape', props: { kind: 'rect' },
      style: { fill: { type: 'solid', color: '#ff0000' }, stroke: { color: '#000000', width: 6 } },
    })
    const html = render([a, b])
    expect(html).toContain('data-testid="canvas-style-inspector"')
    expect(html).toContain('data-testid="canvas-style-fill"')
    expect(html).toContain('data-testid="canvas-style-strokeWidth"')
    expect(html).toContain('data-mixed="true"')
    expect(html).toContain('2 selected')
    expect(html).toContain('value="#ff0000"')
  })

  it('shows font controls for text and hides corner radius', () => {
    const t = obj({ id: 't', type: 'text', props: { text: 'hi' }, style: { font: { family: 'sans-serif', size: 16, weight: 400 } } })
    const html = render([t])
    expect(html).toContain('data-testid="canvas-style-fontSize"')
    expect(html).toContain('data-testid="canvas-style-fontWeight"')
    expect(html).not.toContain('data-testid="canvas-style-cornerRadius"')
  })
})
