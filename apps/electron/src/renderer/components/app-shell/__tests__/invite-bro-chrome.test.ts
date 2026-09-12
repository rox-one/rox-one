import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const MENU = readFileSync(join(__dirname, '..', 'SessionMenu.tsx'), 'utf8')
const COMPACT = readFileSync(join(__dirname, '..', 'CompactSessionMenu.tsx'), 'utf8')
const HOOK = readFileSync(join(__dirname, '..', '..', '..', 'hooks', 'useSessionMenuActions.ts'), 'utf8')
const CHAT = readFileSync(join(__dirname, '..', '..', '..', 'pages', 'ChatPage.tsx'), 'utf8')

describe('Позвать Бро session chrome', () => {
  it('adds inviteBro next to publication share in desktop and compact menus', () => {
    expect(MENU).toContain("t('sessionMenu.inviteBro')")
    expect(MENU).toContain('actions.inviteBro')
    expect(COMPACT).toContain("t('sessionMenu.inviteBro')")
    expect(HOOK).toContain("type: 'inviteBro'")
  })

  it('renders presence avatars under session header controls', () => {
    expect(CHAT).toContain('<SessionPresenceAvatars')
    expect(CHAT).toContain('sessionId={sessionId}')
  })
})
