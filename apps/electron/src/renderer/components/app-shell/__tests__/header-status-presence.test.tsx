import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PresenceContext } from 'motion/react'
import { HeaderStatusPresence } from '../HeaderStatusLane'

function renderNotice(isPresent: boolean) {
  return renderToStaticMarkup(
    <PresenceContext.Provider value={{ id: 'notice', isPresent, register: () => () => {} }}>
      <HeaderStatusPresence>
        {present => <><button type="button">Apply skill</button>{present && <div role="menu">Actions</div>}</>}
      </HeaderStatusPresence>
    </PresenceContext.Provider>,
  )
}

describe('header status exit accessibility', () => {
  it('keeps an active notice and its action menu reachable', () => {
    const html = renderNotice(true)
    expect(html).not.toContain(' inert=')
    expect(html).not.toContain('aria-hidden="true"')
    expect(html).toContain('role="menu"')
  })

  it('removes exiting actions from interaction immediately while their notice finishes painting', () => {
    const html = renderNotice(false)
    expect(html).toContain(' inert=""')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('Apply skill')
    expect(html).not.toContain('role="menu"')
  })
})
