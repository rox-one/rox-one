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
import { __resetSlotRegistryForTests, getSlotRegistry } from '../slots'
import { GLOBAL_CREATE_SLOT } from '../global-create'

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

  it('flags OFF + an unflagged wave-2 entry: renders the menu trigger; disposing restores the baseline «+»', () => {
    const handle = getSlotRegistry().register({
      id: 'wiki.new-page', slot: GLOBAL_CREATE_SLOT, source: 'wave2.wiki', titleKey: 'wiki.create.page',
      payload: { intent: { type: 'route', route: 'notes' } },
    })
    expect(renderMenu()).toContain('data-global-create-trigger')
    handle.dispose()
    expect(renderMenu()).toBe('<button type="button" data-baseline-plus="true">+</button>')
  })
})
