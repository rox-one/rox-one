import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createPortalSlot } from '../content-slot'

describe('createPortalSlot', () => {
  it('outlet is a stable DOM host; target starts empty', () => {
    const slot = createPortalSlot('p-1')
    const { Outlet } = slot
    expect(renderToStaticMarkup(<Outlet />)).toBe('<div class="p-1" data-sidebar-content-slot=""></div>')
    expect(slot.getTarget()).toBeNull()
    expect(slot.Outlet).toBe(Outlet)
  })
})
