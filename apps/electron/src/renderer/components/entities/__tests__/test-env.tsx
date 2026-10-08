/**
 * W1-08 (#1505) test environment: happy-dom globals, real i18n (RU/EN),
 * markup rendering for snapshots and DOM mounting for axe.
 *
 * Import this module FIRST in a test file so globals exist before React DOM.
 * Nothing here touches ~/.rox or the real config dir.
 */
import { installDom, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'

export const testWindow = installDom()

// Radix primitives warn about useLayoutEffect during static rendering; the
// markup is still correct, so keep test output readable.
const originalConsoleError = console.error
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return
  originalConsoleError(...args)
}

import * as React from 'react'
import { mock } from 'bun:test'

// Radix picks `useLayoutEffect` once, at module load: a no-op when no
// `document` exists. When a DOM-less test file in the same `bun test` process
// imported Radix first, portals (popover, context menu, dialog) would never
// mount here. Re-bind it to React's hook now that the DOM is installed (Bun
// patches already-loaded modules in place).
mock.module('@radix-ui/react-use-layout-effect', () => ({ useLayoutEffect: React.useLayoutEffect }))

import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { initReactI18next, setI18n } from 'react-i18next'
import axe from 'axe-core'
import { setupI18n } from '@rox/shared/i18n'

export const i18n = setupI18n([initReactI18next])
// setupI18n is idempotent: when another test file in the same `bun test`
// process initialised i18next first (without the React plugin), bind it to
// react-i18next explicitly so components translate instead of echoing keys.
setI18n(i18n)

export type TestLang = 'ru' | 'en'
export type TestTheme = 'light' | 'dark'

export async function useLang(lang: TestLang): Promise<void> {
  if (i18n.language !== lang) await i18n.changeLanguage(lang)
}

/** Static markup inside a theme wrapper (tokens switch on `.dark`). */
export async function renderMarkup(node: React.ReactElement, options: { lang?: TestLang; theme?: TestTheme } = {}): Promise<string> {
  await useLang(options.lang ?? 'ru')
  const theme = options.theme ?? 'light'
  return renderToStaticMarkup(
    <div className={theme === 'dark' ? 'dark' : 'light'} data-theme={theme}>{node}</div>,
  )
}

export interface Mounted {
  container: HTMLElement
  root: Root
  unmount: () => Promise<void>
}

export async function mount(node: React.ReactElement, options: { lang?: TestLang } = {}): Promise<Mounted> {
  await useLang(options.lang ?? 'ru')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(node) })
  return {
    container,
    root,
    unmount: async () => {
      await act(async () => { root.unmount() })
      container.remove()
    },
  }
}

export async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

export async function wait(ms: number): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

/** axe-core over `element` (colour contrast needs real CSS; disabled). */
export async function axeViolations(element: Element): Promise<axe.Result[]> {
  const result = await axe.run(element as unknown as axe.ElementContext, {
    rules: { 'color-contrast': { enabled: false } },
  })
  return result.violations
}

export function describeViolations(violations: axe.Result[]): string {
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`).join('\n')
}

export { resetDom }
