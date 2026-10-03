import React from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { ActionRegistryProvider } from '@/actions'
import { DesktopAppMenu } from '@/components/app-menu/DesktopAppMenu'
import { MobileAppMenu } from '@/components/app-menu/MobileAppMenu'
import { DismissibleLayerProvider } from '../../../DismissibleLayerContext'
import { ThemeProvider, useTheme } from '../../../ThemeContext'
import type { AppMenuProps } from '@/components/app-menu/types'
import en from '../../../../../../../../packages/shared/src/i18n/locales/en.json'

await i18n.use(initReactI18next).init({
  lng: 'en', keySeparator: false, resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const mode = new URLSearchParams(location.search).get('mode') ?? 'deny'
const calls: string[] = []
const debugReplies: Array<(value: boolean) => void> = []
const themeReplies: Array<(value: boolean) => void> = []
let themeListener: ((value: boolean) => void) | undefined
const capturedThemeListeners: Array<(value: boolean) => void> = []
let themeCleanups = 0
let toggleMenus: (() => void) | undefined
let toggleTheme: (() => void) | undefined

// Frozen own properties reproduce contextBridge's exposed API shape.
Object.assign(window, {
  electronAPI: Object.freeze({
    isDebugMode: async () => {
      calls.push('isDebugMode')
      if (mode === 'deny') throw { code: 'AUTH_FAILED', message: 'Synthetic optional RPC denied' }
      return new Promise<boolean>(resolve => { debugReplies.push(resolve) })
    },
    getSystemTheme: async () => {
      calls.push('getSystemTheme')
      if (mode === 'deny') throw { code: 'AUTH_FAILED', message: 'Synthetic optional RPC denied' }
      return new Promise<boolean>(resolve => { themeReplies.push(resolve) })
    },
    onSystemThemeChange: (listener: (value: boolean) => void) => {
      calls.push('onSystemThemeChange')
      themeListener = listener
      capturedThemeListeners.push(listener)
      return () => {
        themeCleanups += 1
        if (themeListener === listener) themeListener = undefined
      }
    },
  }),
  __startupEffectsFixture: {
    calls,
    resolveDebug: (index: number, value: boolean) => debugReplies[index]?.(value),
    resolveTheme: (index: number, value: boolean) => themeReplies[index]?.(value),
    notifyTheme: (value: boolean) => themeListener?.(value),
    notifyCapturedTheme: (index: number, value: boolean) => capturedThemeListeners[index]?.(value),
    themeCleanups: () => themeCleanups,
    toggleMenus: () => toggleMenus?.(),
    toggleTheme: () => toggleTheme?.(),
  },
})

const menuProps: AppMenuProps = {
  onNewChat: () => {}, onOpenSettings: () => {}, onOpenSettingsSubpage: () => {},
  onOpenStoredUserPreferences: () => {},
}

function ThemeProbe() {
  const { systemPreference, resolvedMode } = useTheme()
  return <p data-testid="theme-state">{systemPreference}/{resolvedMode}</p>
}

function Fixture() {
  const [menusMounted, setMenusMounted] = React.useState(true)
  const [themeMounted, setThemeMounted] = React.useState(true)
  React.useEffect(() => {
    toggleMenus = () => setMenusMounted(value => !value)
    toggleTheme = () => setThemeMounted(value => !value)
    return () => { toggleMenus = undefined; toggleTheme = undefined }
  }, [])
  return <>
    <p data-testid="ready">Actual production menus and ThemeProvider, synthetic optional transport</p>
    {themeMounted && <ThemeProvider defaultMode="system" defaultColorTheme="default"><ThemeProbe /></ThemeProvider>}
    <ActionRegistryProvider><DismissibleLayerProvider>
      {menusMounted && <>
        {mode !== 'mobile-hold' && <div data-testid="desktop-menu"><DesktopAppMenu {...menuProps} /></div>}
        {mode !== 'desktop-hold' && <div data-testid="mobile-menu"><MobileAppMenu {...menuProps} /></div>}
      </>}
    </DismissibleLayerProvider></ActionRegistryProvider>
  </>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
