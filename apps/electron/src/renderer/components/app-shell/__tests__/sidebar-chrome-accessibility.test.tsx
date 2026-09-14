import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { LeftSidebar, type LinkItem } from '../LeftSidebar'
import { ProfileStrip, type ProfileStripData } from '../ProfileStrip'
import { SidebarChrome } from '../SidebarChrome'
import { dismissSidebarGuidance, isSidebarGuidanceDismissed, type SidebarGuidanceStore } from '../sidebar-guidance'

const i18n = createInstance()
await i18n.init({
  lng: 'en', fallbackLng: 'en',
  resources: { en: { translation: {
    'profile.openSettings': 'Open settings for {{name}}',
    'profile.defaultName': 'User',
    'profile.balance': '{{amount}}',
    'profile.balanceLabel': 'Balance',
    'profile.balanceEmpty': '—',
    'settings.account.plan.standard': 'Standard',
    'promo.onboardingTitle': 'Set up memory',
    'promo.onboardingBody': 'Add lessons so Rox remembers your preferences.',
    'promo.reminderTitle': 'Reminders',
    'sidebar.guidance.dismiss': 'Dismiss memory setup suggestion',
  } } },
})

const profile: ProfileStripData = {
  displayName: 'Rox User', plan: 'standard', level: 1, xp: 0, progress: 0,
  xpIntoLevel: 0, xpForNext: 100, nextThreshold: 100, balance: 12,
}

const change = () => {}
const render = (content: React.ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{content}</I18nextProvider>)
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(([button]) => button)

function memoryStore() {
  const data = new Map<string, unknown>()
  const store: SidebarGuidanceStore = {
    get: (key, fallback, suffix) => data.get(`${key}:${suffix}`) as typeof fallback ?? fallback,
    set: (key, value, suffix) => { data.set(`${key}:${suffix}`, value) },
  }
  return { data, store }
}

describe('compact sidebar guidance preferences', () => {
  it('retains dismissal across reloads while keeping other workspaces independent', () => {
    const { store } = memoryStore()
    expect(isSidebarGuidanceDismissed('first', store)).toBe(false)
    dismissSidebarGuidance('first', store)
    expect(isSidebarGuidanceDismissed('first', store)).toBe(true)
    expect(isSidebarGuidanceDismissed('second', store)).toBe(false)
    expect(isSidebarGuidanceDismissed(null, store)).toBe(false)
  })

  it('keeps the unscoped state separate and rejects malformed stored preferences', () => {
    const { data, store } = memoryStore()
    data.set('sidebar-dismissed-guidance:first', 'true')
    expect(isSidebarGuidanceDismissed('first', store)).toBe(false)
    dismissSidebarGuidance(null, store)
    expect(isSidebarGuidanceDismissed(undefined, store)).toBe(true)
    expect(isSidebarGuidanceDismissed('first', store)).toBe(false)
  })
})

describe('compact sidebar rendered accessibility', () => {
  let previousStorage: PropertyDescriptor | undefined
  let persisted: Map<string, string>

  beforeEach(() => {
    previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    persisted = new Map()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => persisted.get(key) ?? null,
        setItem: (key: string, value: string) => persisted.set(key, value),
      },
    })
  })
  afterEach(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  })

  it('keeps profile navigation keyboard reachable with billing in its accessible description', () => {
    const html = render(<ProfileStrip data={profile} onClick={change} />)
    const button = buttons(html)[0]!
    expect(button).toContain('type="button"')
    expect(button).toContain('aria-label="Open settings for Rox User"')
    expect(button).not.toContain('tabindex="-1"')
    const descriptionId = button.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(descriptionId).toBeTruthy()
    expect(html).toContain(`id="${descriptionId}" class="sr-only">Standard · Balance 12`)
    expect(button).toContain('>Rox User</span>')
  })

  it('exposes setup as a closed keyboard popover without mounting its card', () => {
    const html = render(<SidebarChrome workspaceId="first" profile={profile} onProfileClick={change} promoKind="onboarding" onPromoCta={change} />)
    const controls = buttons(html)
    expect(controls).toHaveLength(3)
    expect(controls[0]).toContain('aria-haspopup="dialog"')
    expect(controls[0]).toContain('aria-expanded="false"')
    expect(controls[1]).toContain('aria-label="Dismiss memory setup suggestion"')
    expect(controls.every(button => button.includes('type="button"') && !button.includes('tabindex="-1"'))).toBe(true)
    expect(html).not.toContain('Add lessons so Rox remembers your preferences.')
    expect(html).not.toContain('data-promo-slot=')
  })

  it('honors a persisted dismissal without removing the profile or another workspace suggestion', () => {
    dismissSidebarGuidance('first')
    const props = { profile, onProfileClick: change, promoKind: 'onboarding' as const, onPromoCta: change }
    const first = render(<SidebarChrome {...props} workspaceId="first" />)
    const second = render(<SidebarChrome {...props} workspaceId="second" />)
    expect(buttons(first)).toHaveLength(1)
    expect(first).toContain('data-tutorial="profile-strip"')
    expect(first).not.toContain('Set up memory')
    expect(buttons(second)).toHaveLength(3)
  })

  it('keeps measured reminders reachable after setup was dismissed', () => {
    dismissSidebarGuidance('first')
    const html = render(<SidebarChrome workspaceId="first" profile={profile} onProfileClick={change} promoKind="reminder" reminderDueCount={3} onPromoCta={change} />)
    expect(buttons(html)).toHaveLength(2)
    expect(html).toContain('>Reminders</span>')
    expect(html).toContain('>3</span>')
    expect(html).not.toContain('Dismiss memory setup suggestion')
  })

  it('hides zero badges while preserving every filter and positive or semantic badge', () => {
    const links: LinkItem[] = [
      { id: 'nav:state:empty', title: 'Empty bucket', label: '0', icon: <svg />, variant: 'default', onClick: change },
      { id: 'nav:state:todo', title: 'To do', label: '3', icon: <svg />, variant: 'ghost', onClick: change },
      { id: 'nav:custom', title: 'Custom view', label: 'New', icon: <svg />, variant: 'ghost', onClick: change },
    ]
    const html = render(<LeftSidebar isCollapsed={false} links={links} />)
    const controls = buttons(html)
    expect(controls).toHaveLength(3)
    expect(controls[0]).toContain('>Empty bucket</span>')
    expect(controls[0]).toContain('aria-current="page"')
    expect(controls[0]).not.toContain('>0</span>')
    expect(controls[1]).toContain('>3</span>')
    expect(controls[2]).toContain('>New</span>')
    expect(controls.every(button => button.includes('type="button"'))).toBe(true)
  })
})
