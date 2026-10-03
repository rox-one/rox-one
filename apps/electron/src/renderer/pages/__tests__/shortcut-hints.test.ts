import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { createInstance } from 'i18next'
import { LOCALE_REGISTRY } from '@rox/shared/i18n/registry'
import { formatHotkeyDisplay } from '../../lib/platform'

// Separate processes keep navigator/module mocks out of unrelated tests.
const root = join(import.meta.dir, '../../../../../..')
function render(platform: string, locale: string) {
  const result = Bun.spawnSync([
    process.execPath,
    '--preload', join(root, 'scripts/test-config-isolation.ts'),
    '--preload', join(root, 'packages/shared/src/test-preload-pdfjs-url.ts'),
    '--preload', join(root, 'scripts/test-vite-url-shim.ts'),
    join(import.meta.dir, 'fixtures/shortcut-hints.tsx'), platform, locale,
  ], { cwd: root, env: process.env })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return JSON.parse(result.stdout.toString()) as Record<'tasks' | 'detail' | 'quickEntry' | 'memory' | 'meetings' | 'selection' | 'registry', string>
}

describe('ROX-004 rendered shortcut hints', () => {
  for (const platform of ['Win32', 'Linux x86_64', 'MacIntel']) {
    for (const locale of ['en', 'ru']) {
      it(`${platform} / ${locale} renders native keys in Tasks, Memory and Meetings`, () => {
        const html = render(platform, locale)
        const mac = platform === 'MacIntel'
        for (const surface of Object.values(html)) {
          expect(surface).not.toMatch(/\{\{|\}\}/)
          if (!mac) expect(surface).not.toMatch(/[⌘⇧⌥⌫]/)
        }
        for (const chord of mac ? ['⌘N', '⌘K', '⇧⌘D', '⌥↑', '⌘⌫'] : ['Ctrl+N', 'Ctrl+K', 'Shift+Ctrl+D', 'Alt+↑', 'Ctrl+Backspace']) {
          expect(html.tasks).toContain(chord)
        }
        for (const chord of mac ? ['⌘S', '⌘T', '⌘E', '⇧⌘D', '⌘K', '⌘↵', '⌘⌫'] : ['Ctrl+S', 'Ctrl+T', 'Ctrl+E', 'Shift+Ctrl+D', 'Ctrl+K', 'Ctrl+Enter', 'Ctrl+Backspace']) {
          expect(html.detail).toContain(chord)
        }
        expect(html.detail).not.toContain('Ctrl+Delete')
        expect(html.quickEntry).toContain(mac ? '⌘↵' : 'Ctrl+Enter')
        // Current main is list-first: unselected details (and their hint) are
        // deliberately not mounted. Catalog interpolation is covered below.
        expect(html.memory).toContain('data-testid="memory-search"')
        expect(html.memory).not.toContain('data-testid="memory-detail-empty"')
        expect(html.meetings).toContain(mac ? '⌘F' : 'Ctrl+F')
        expect(html.selection).toContain(mac ? '⇧' : 'Shift')
        expect(html.selection).toContain(mac ? '⌘' : 'Ctrl')
        expect(html.registry).toContain(mac ? '⌘N / ⌘K' : 'Ctrl+N / Ctrl+K')
        expect(html.quickEntry).toContain(locale === 'ru' ? 'сохранить и открыть' : 'save and open')
      }, 30_000)
    }
  }
})

describe('localized shortcut interpolation', () => {
  for (const [locale, { messages }] of Object.entries(LOCALE_REGISTRY)) {
    it(`${locale} interpolates every affected hint without a fallback or leftover glyph`, async () => {
      const i18n = createInstance()
      await i18n.init({ lng: locale, fallbackLng: false, resources: { [locale]: { translation: messages } } })
      const selectAll = i18n.t('memory.screen.keysHint', { selectAll: formatHotkeyDisplay('mod+a', false) })
      const saveAndOpen = i18n.t('tasks.quickEntry.keys', { saveAndOpen: formatHotkeyDisplay('mod+enter', false) })
      const status = i18n.t('tasks.status.hint', { new: formatHotkeyDisplay('mod+n', false), move: formatHotkeyDisplay('mod+k', false) })
      expect(selectAll).toContain('Ctrl+A')
      expect(saveAndOpen).toContain('Ctrl+Enter')
      expect(status).toContain('Ctrl+N')
      expect(status).toContain('Ctrl+K')
      for (const hint of [selectAll, saveAndOpen, status]) expect(hint).not.toMatch(/[⌘⇧⌥]|\{\{|\}\}/)
    })
  }
})
