import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createResizeController } from '../../components/app-shell/resize-controller'
import { solveSplit } from '../../components/app-shell/resize-math'
import { parseZenShellEnabled, parseZenShellPatch, resolveShellMaterial, ZEN_SHELL_FLAG } from '../../../shared/shell-appearance'
import {
  evidencePathFor,
  ZEN_SHELL_QA_CASES,
  ZEN_SHELL_QA_ENVIRONMENT,
  ZEN_SHELL_QA_RESULTS,
  ZEN_SHELL_REQUIREMENT_IDS,
  type ZenShellQaResult,
} from '../zen-shell-qa-catalog'
import { buildZenShellQaFixture } from '../zen-shell-qa-fixture'

const root = join(import.meta.dir, '../../../../../../')
const electronSrc = join(import.meta.dir, '../../../')

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8')
}

function readElectron(rel: string): string {
  return readFileSync(join(electronSrc, rel), 'utf8')
}

const RESULTS: ReadonlySet<string> = new Set(['passed', 'failed', 'blocked', 'not_run'])

describe('Zen Shell acceptance gate (ZS-08)', () => {
  it('maps all 28 requirements to cases with honest host results', () => {
    const evidence = JSON.parse(read('docs/qa/zen-shell-evidence.json')) as {
      cases: Array<{
        requirementId: string
        caseId: string
        environment: string
        result: ZenShellQaResult
        evidencePath: string
        measuredAt: string
      }>
    }
    const covered = new Set(ZEN_SHELL_QA_CASES.map((item) => item.requirementId))
    expect([...ZEN_SHELL_REQUIREMENT_IDS].every((id) => covered.has(id))).toBe(true)
    expect(evidence.cases).toHaveLength(ZEN_SHELL_QA_CASES.length)
    for (const def of ZEN_SHELL_QA_CASES) {
      const recorded = evidence.cases.find((item) => item.caseId === def.caseId)
      expect(recorded, def.caseId).toBeTruthy()
      expect(recorded?.requirementId).toBe(def.requirementId)
      expect(recorded?.environment).toBe(ZEN_SHELL_QA_ENVIRONMENT)
      expect(RESULTS.has(recorded?.result ?? '')).toBe(true)
      expect(recorded?.result).toBe(ZEN_SHELL_QA_RESULTS[def.caseId])
      expect(recorded?.evidencePath).toBe(evidencePathFor(def.caseId))
      expect(recorded?.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
    const blockedNative = ['macos-outer-shadow', 'macos-native-controls', 'native-webcontents-occlusion', 'native-zoom-fullscreen-os', 'native-no-reload-os']
    for (const caseId of blockedNative) {
      expect(ZEN_SHELL_QA_RESULTS[caseId]).toBe('blocked')
    }
  })

  it('keeps shell.zen.v1 default OFF with no remote force-on', () => {
    expect(parseZenShellEnabled(undefined)).toBe(false)
    expect(parseZenShellEnabled('true')).toBe(false)
    expect(ZEN_SHELL_FLAG).toBe('shell.zen.v1')
    const prefs = read('packages/shared/src/config/preferences.ts')
    expect(prefs).toContain("return loadPreferences().zenShellEnabled === true")
    const flags = read('packages/shared/src/feature-flags.ts')
    expect(flags).not.toContain('ZEN_SHELL')
    expect(flags).not.toContain('shell.zen.v1')
    const atoms = readElectron('renderer/atoms/unified-shell.ts')
    expect(atoms).toMatch(/atomWithStorage<boolean>\(\s*getKeyString\(KEYS\.featureUnifiedShell\),\s*false/)
    expect(atoms).toMatch(/atomWithStorage<boolean>\(\s*getKeyString\(KEYS\.workbenchEnabled\),\s*false/)
  })

  it('OFF delegates to the legacy window path instead of forcing solid Zen material', () => {
    const windowManager = readElectron('main/window-manager.ts')
    expect(windowManager).toMatch(/if \(zenEnabled\) \{\s*attachZenWindowPolicy\(window\)/)
    const material = readElectron('main/shell-material.ts')
    expect(material).toContain('OFF (`shell.zen.v1` false) never calls this path')
    expect(resolveShellMaterial({
      zenEnabled: true,
      preference: 'glass',
      platform: 'linux',
      reduceTransparency: false,
      highContrast: false,
      paintHealthy: true,
      windowDestroyed: false,
    }).fallbackReason).toBe('unsupported-platform')
  })

  it('rejects SET_ZEN_SHELL fields that are not enabled/materialPreference', () => {
    expect(parseZenShellPatch({ enabled: true })).toEqual({ enabled: true })
    expect(() => parseZenShellPatch({ vibrancy: 'under-window' })).toThrow(/Unexpected zen shell field/)
  })

  it('survives 100 resize/cancel cycles without a durable commit', () => {
    let commits = 0
    let cancels = 0
    const controller = createResizeController({
      onPreview: () => {},
      onCommit: () => { commits += 1 },
      onCancel: () => { cancels += 1 },
      requestFrame: (cb) => {
        cb()
        return 1
      },
      cancelFrame: () => {},
    })
    const bounds = {
      leftId: 'a',
      rightId: 'b',
      total: 1000,
      sizeA: 220,
      minA: 180,
      maxA: 360,
      minB: 440,
      maxB: Number.POSITIVE_INFINITY,
    }
    for (let i = 0; i < 100; i += 1) {
      expect(controller.start(bounds)).toBe(true)
      controller.moveTo(240)
      controller.cancel()
    }
    expect(cancels).toBe(100)
    expect(commits).toBe(0)
    expect(controller.commitCount).toBe(0)
    controller.dispose()
  })

  it('keeps 1000 solveSplit calls under the 50ms long-task budget on this host', () => {
    const started = performance.now()
    for (let i = 0; i < 1000; i += 1) {
      solveSplit({
        total: 1000,
        sizeA: 220 + (i % 80),
        minA: 180,
        maxA: 360,
        minB: 440,
        maxB: Number.POSITIVE_INFINITY,
        delta: (i % 9) - 4,
      })
    }
    expect(performance.now() - started).toBeLessThan(50)
  })

  it('does not reuse the VPS 390×720 viewport for the native browser host', () => {
    const browserPage = readElectron('renderer/pages/BrowserPanelPage.tsx')
    const vps = readElectron('renderer/components/browser/WebBrowserPanel.tsx')
    expect(browserPage).toContain('createNativeSurfaceTracker')
    expect(browserPage).not.toContain('390, height: 720')
    expect(vps).toContain('const MOBILE_VIEWPORT = { width: 390, height: 720 }')
  })

  it('registers the QA fixture in the playground and keeps reduced-motion at 0', () => {
    const registry = readElectron('renderer/playground/registry/index.ts')
    const story = readElectron('renderer/playground/registry/zen-shell-qa.tsx')
    const css = readElectron('renderer/index.css')
    expect(registry).toContain('zenShellQaComponents')
    expect(story).toContain('data-testid="zen-shell-qa-fixture"')
    expect(story).toContain('zen-shell-qa-draft')
    expect(story).toContain('zen-shell-qa-browser-scroll')
    expect(buildZenShellQaFixture().rows.length).toBeGreaterThanOrEqual(500)
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('html[data-shell-style="zen"] .sidebar-disclosure')
    expect(css).toContain('transition: none')
  })

  it('ships Zen QA labels in all 12 locale files', () => {
    const keys = [
      'settings.appearance.zenShellQaBrowser',
      'settings.appearance.zenShellQaClicks',
      'settings.appearance.zenShellQaDraft',
      'settings.appearance.zenShellQaScrolls',
      'settings.appearance.zenShellQaSidebar',
    ]
    const locales = ['ar', 'de', 'en', 'es', 'fr', 'hu', 'ja', 'ko', 'pl', 'ru', 'zh-Hans', 'zh-Hant']
    for (const locale of locales) {
      const json = read(`packages/shared/src/i18n/locales/${locale}.json`)
      for (const key of keys) {
        expect(json.includes(`"${key}"`), `${locale} ${key}`).toBe(true)
      }
    }
  })
})
