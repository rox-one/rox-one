import { expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { buildRuntimeGraph, projectRuntimeEvents } from '@rox/core/runtime-trace'
import { createRuntimeTraceFixture } from '@rox/core/runtime-trace/fixture'
import { RuntimeInspector } from '../inspector/RuntimeInspector'

it('keeps actual stderr output separate when stdout was not recorded', async () => {
  const events = createRuntimeTraceFixture().map(event => event.kind === 'terminal.completed'
    ? { ...event, payload: { ...event.payload, stdout: undefined, stderr: { text: 'stderr-only-marker' } } }
    : event)
  const terminal = buildRuntimeGraph(projectRuntimeEvents(events)).nodes.find(node => node.kind === 'terminal')!
  const i18n = createInstance()
  await i18n.init({ lng: 'en', fallbackLng: 'en', initAsync: false, resources: { en: { translation: { runtimeMap: { notRecorded: 'Unavailable' } } } } })
  const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><RuntimeInspector node={terminal} onClose={() => undefined} /></I18nextProvider>)
  expect(html.match(/stderr-only-marker/g)).toHaveLength(1)
  const stdout = html.slice(html.indexOf('<h4>stdout</h4>'), html.indexOf('<h4>stderr</h4>'))
  expect(stdout).toContain('Unavailable')
  expect(stdout).not.toContain('stderr-only-marker')
})
