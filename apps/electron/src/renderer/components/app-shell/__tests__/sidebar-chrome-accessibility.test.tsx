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
    'profile.openMenu': 'Open profile menu for {{name}}',
    'profile.defaultName': 'User',
    'profile.balance': '{{amount}}',
    'profile.balanceLabel': 'Balance',
    'profile.balanceUnknown': 'No data',
    'settings.account.plan.standard': 'Standard',
    'promo.onboardingTitle': 'Set up memory',
    'promo.onboardingBody': 'Add lessons so Rox remembers your preferences.',
    'promo.onboardingCta': 'Open memory',
    'promo.reminderTitle': 'Reminders',
    'promo.reminderBody': '{{count}} due',
    'promo.reminderCta': 'Review',
    'common.dismiss': 'Dismiss',
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
    expect(button).toContain('aria-label="Open profile menu for Rox User"')
    expect(button).not.toContain('tabindex="-1"')
    const descriptionId = button.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(descriptionId).toBeTruthy()
    expect(html).toContain(`id="${descriptionId}" class="sr-only">Standard · Balance 12`)
    expect(button).toContain('>Rox User</span>')
  })

  it('exposes setup as a closed keyboard popover above a reachable promo slot', () => {
    const html = render(<SidebarChrome workspaceId="first" profile={profile} onProfileClick={change} promoKind="onboarding" onPromoCta={change} />)
    const controls = buttons(html)
    const profileButton = controls.find(button => button.includes('data-tutorial="profile-strip"'))
    expect(profileButton).toBeDefined()
    expect(profileButton).toContain('aria-haspopup="dialog"')
    expect(profileButton).toContain('aria-expanded="false"')
    expect(controls.every(button => button.includes('type="button"') && !button.includes('tabindex="-1"'))).toBe(true)
    expect(html).toContain('data-promo-slot="onboarding"')
    expect(html).toContain('>Set up memory</div>')
    expect(html).toContain('>Open memory</button>')
    expect(controls.find(button => button.includes('aria-label="Dismiss"'))).toBeDefined()
  })

  it('honors a persisted dismissal without removing the profile or another workspace suggestion', () => {
    dismissSidebarGuidance('first')
    const props = { profile, onProfileClick: change, promoKind: 'onboarding' as const, onPromoCta: change }
    const first = render(<SidebarChrome {...props} workspaceId="first" />)
    const second = render(<SidebarChrome {...props} workspaceId="second" />)
    expect(first).toContain('data-tutorial="profile-strip"')
    expect(first).not.toContain('data-promo-slot=')
    expect(first).not.toContain('Set up memory')
    expect(second).toContain('data-promo-slot="onboarding"')
    expect(second).toContain('Set up memory')
  })

  it('keeps measured reminders reachable after setup was dismissed', () => {
    dismissSidebarGuidance('first')
    const html = render(<SidebarChrome workspaceId="first" profile={profile} onProfileClick={change} promoKind="reminder" reminderDueCount={3} onPromoCta={change} />)
    expect(html).toContain('data-promo-slot="reminder"')
    expect(html).toContain('>Reminders</div>')
    expect(html).toContain('>3 due</p>')
    expect(html).toContain('>Review</button>')
    expect(html).not.toContain('aria-label="Dismiss"')
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
