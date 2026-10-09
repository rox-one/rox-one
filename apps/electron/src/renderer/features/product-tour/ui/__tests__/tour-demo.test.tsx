import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TourTargetRegistration } from '../../contracts'
import type { TargetGeometry } from '../geometry'
import { TourVignette } from '../TourVignette'
import { TourPopover } from '../TourPopover'
import { devSpaceTour } from '../../catalogue/__tests__/fixtures/dynamic-tour'

const root = resolve(import.meta.dir, '../../../../../../../..')
const indexCss = readFileSync(resolve(root, 'packages/ui/src/styles/index.css'), 'utf8')
const zCss = readFileSync(resolve(root, 'packages/ui/src/styles/tokens/z.css'), 'utf8')

const rect = { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }
const geometry: TargetGeometry = { rect, spotlightRect: rect, viewport: { width: 800, height: 600 } }
const target = { id: 'devspace.repo.overview', registrationToken: 'token', scope: 'bound-panel', context: { workspaceId: 'w', panelId: 'p' }, variant: 'regular', element: undefined as unknown as HTMLElement } as TourTargetRegistration
const binding = { workspaceId: 'w', panelId: 'p', clientProfileId: 'profile', runToken: 'run' }

const step = devSpaceTour().steps[0]!

const i18n = createInstance()
await i18n.init({
  lng: 'en', fallbackLng: 'en',
  resources: { en: { translation: {
    'productTour.common.stepProgress': 'Step {{current}} of {{total}}',
    'productTour.controls.focusTarget': 'Focus',
    'productTour.controls.pause': 'Pause',
    'productTour.controls.next': 'Next',
  } } },
})

describe('TOUR-DEMO vignette spec (D10)', () => {
  test('TOUR-DEMO-01 the edge vignette has a radial gradient, in-range opacity and a 4-6s breathe', () => {
    expect(indexCss).toContain('@keyframes tour-vignette-breathe')
    const block = indexCss.match(/\.tour-vignette\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(block).toContain('radial-gradient')
    const opacity = Number(block.match(/opacity:\s*(0\.\d+)/)?.[1])
    expect(opacity).toBeGreaterThanOrEqual(0.1)
    expect(opacity).toBeLessThanOrEqual(0.18)
    const duration = Number(indexCss.match(/animation:\s*tour-vignette-breathe\s+(\d+(?:\.\d+)?)s/)?.[1])
    expect(duration).toBeGreaterThanOrEqual(4)
    expect(duration).toBeLessThanOrEqual(6)
  })

  test('TOUR-DEMO-02 reduced motion keeps a static gradient and stops the target pulse', () => {
    expect(indexCss).toContain('@keyframes tour-target-pulse')
    expect(indexCss).toMatch(/\.tour-target-pulse\s*\{[^}]*animation:\s*tour-target-pulse/s)
    const reduced = indexCss.slice(indexCss.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.tour-vignette')
    expect(reduced).toContain('.tour-target-pulse')
    expect(reduced).toMatch(/\.tour-vignette,\s*\.tour-target-pulse\s*\{\s*animation:\s*none\s*!important/)
  })

  test('TOUR-DEMO-03 the vignette layer sits above content and below the spotlight panel', () => {
    expect(zCss).toContain('--z-tour-vignette: 90')
    expect(zCss).toContain('--z-index-tour-vignette: var(--z-tour-vignette)')
    const sash = Number(zCss.match(/--z-sash:\s*(\d+)/)?.[1])
    const vignette = Number(zCss.match(/--z-tour-vignette:\s*(\d+)/)?.[1])
    const popover = Number(zCss.match(/--z-popover:\s*(\d+)/)?.[1])
    expect(sash).toBeLessThan(vignette)
    expect(vignette).toBeLessThan(popover)
  })

  test('TOUR-DEMO-04 the vignette element is decorative, non-interactive and on the new layer', () => {
    const html = renderToStaticMarkup(<TourVignette />)
    expect(html).toContain('data-product-tour-vignette')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('pointer-events-none')
    expect(html).toContain('z-tour-vignette')
    expect(html).toContain('motion-reduce:animate-none')
  })
})

describe('TOUR-DEMO step panel progress (D9/D10)', () => {
  test('TOUR-DEMO-05 the panel shows the "step N of M" counter and a progress bar', () => {
    const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><TourPopover target={target} step={step} binding={binding} geometry={geometry} progress={{ current: 2, total: 3 }} onPause={() => {}} /></I18nextProvider>)
    expect(html).toContain('data-product-tour-progress')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="2"')
    expect(html).toContain('aria-valuemax="3"')
    expect(html).toContain('Step 2 of 3')
    expect(html).toContain('motion-reduce:transition-none')
  })

  test('TOUR-DEMO-06 generated tours fall back to their inline copy when no locale key exists', () => {
    const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><TourPopover target={target} step={step} binding={binding} geometry={geometry} onPause={() => {}} /></I18nextProvider>)
    expect(html).toContain('Overview')
    expect(html).toContain('Body')
    expect(html).not.toContain('productTour.repo-overview')
  })
})