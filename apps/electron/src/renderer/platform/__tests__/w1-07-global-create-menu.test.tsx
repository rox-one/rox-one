/**
 * W1-07 (#1504): the rail «+» renders the baseline button until a flagged
 * global-create entry is visible, then becomes the §3.2 menu trigger.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { getDefaultStore } from 'jotai'
import { RESET } from 'jotai/utils'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { GlobalCreateMenu } from '../GlobalCreateMenu'
import { workbenchFlagAtom } from '../unified-flags'
import { __resetSlotRegistryForTests } from '../slots'

const i18n = createInstance()
void i18n.init({ lng: 'ru', resources: {}, initAsync: false })

function renderMenu() {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
    <GlobalCreateMenu
      label="menu"
      navigate={() => {}}
      host={{}}
      fallback={<button type="button" data-baseline-plus>+</button>}
      trigger={({ label }) => <button type="button" aria-label={label} data-global-create-trigger>+</button>}
    />
    </I18nextProvider>,
  )
}

afterEach(() => {
  getDefaultStore().set(workbenchFlagAtom(WORKBENCH_FLAG.modeGoalsV1), RESET)
  __resetSlotRegistryForTests()
})

describe('GlobalCreateMenu', () => {
  it('flags OFF: renders exactly the baseline «+»', () => {
    expect(renderMenu()).toBe('<button type="button" data-baseline-plus="true">+</button>')
  })

  it('a flagged entry visible: renders the menu trigger instead', () => {
    getDefaultStore().set(workbenchFlagAtom(WORKBENCH_FLAG.modeGoalsV1), true)
    const html = renderMenu()
    expect(html).toContain('data-global-create-trigger')
    expect(html).not.toContain('data-baseline-plus')
  })
})
