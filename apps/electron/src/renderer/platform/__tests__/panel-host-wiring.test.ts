import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * S-09/S-03 wiring guard: UnifiedShellLayout must mount PanelHost for the
 * shell's panel slots so registered panels (packages/core panel registry)
 * have a host. Ticket 11 registers knowledge.inspector; other slots stay
 * empty. Renderer harness has no jsdom — this slices the layout source.
 */

const layoutPath = join(__dirname, '..', 'index.tsx')
const hostPath = join(__dirname, '..', 'PanelHost.tsx')
const atomPath = join(__dirname, '..', '..', 'atoms', 'unified-shell.ts')

describe('UnifiedShellLayout PanelHost wiring', () => {
  const src = readFileSync(layoutPath, 'utf8')

  it('mounts PanelHost for the bottom slot inside the center column', () => {
    expect(src).toContain('<PanelHost slot="bottom"')
  })

  it('mounts PanelHost for the inspector slot at the right edge', () => {
    expect(src).toContain('<PanelHost slot="inspector"')
  })

  it('exports PanelHost from the platform barrel', () => {
    expect(src).toContain("export { PanelHost } from './PanelHost'")
  })

  it('PanelHost resolves panels through the registry + persisted overrides', () => {
    const host = readFileSync(hostPath, 'utf8')
    expect(host).toContain('resolveSlotPanels')
    expect(host).toContain('KEYS.panelState')
    expect(host).toContain('onDidChange')
  })

  it('bootstraps core panels with the real KnowledgeInspectorPanel render', () => {
    const host = readFileSync(hostPath, 'utf8')
    expect(host).toContain('registerCorePanels')
    expect(host).toContain('getAppPanelRegistry()')
    expect(host).toContain('KnowledgeInspectorPanel')
    expect(host).toContain('panelContextKeysFromRoute')
    expect(host).not.toContain('void contribution')
  })

  it('owns runtime-gated Conation registrations only from the inspector host', () => {
    const host = readFileSync(hostPath, 'utf8')
    expect(host).toContain('useAtomValue(featureWorkbenchConationShellAtom)')
    expect(host).toContain('useAtomValue(featureWorkbenchConationInspectorAtom)')
    expect(host).toContain('useAtomValue(featureWorkbenchConationCanvasAtom)')
    expect(host).toContain('useAtomValue(featureWorkbenchConationBoardAtom)')
    expect(host).toContain('useAtomValue(featureWorkbenchConationNotesBridgeAtom)')
    expect(host).toContain('createConationNotesBridge')
    expect(host).toContain('const notesRegistration = registerNotesPanel(')
    expect(host).not.toContain('const notesRegistration = notesBridge')
    expect(host).toContain('renderNotesPanel')
    expect(host).toContain("t('settings.appearance.conationShell')")
    expect(host).toContain("t('conation.fund.title')")
    expect(host).toContain("t('conation.board.title')")
    expect(host).toContain("t('knowledge.nav.filterNotes')")
    expect(host).toContain("if (slot !== 'inspector') return")
    expect(host).toContain('inspectorRegistration?.dispose()')
    expect(host).toContain('fundRegistration?.dispose()')
    expect(host).toContain('boardRegistration?.dispose()')
    expect(host).toContain('notesRegistration?.dispose()')
  })

  it('keeps featureUnifiedShellAtom defaulted to false', () => {
    const src = readFileSync(atomPath, 'utf8')
    expect(src).toMatch(
      /atomWithStorage<boolean>\(\s*getKeyString\(KEYS\.featureUnifiedShell\),\s*false/,
    )
  })

  it('keeps featureWorkbenchAtom defaulted to false', () => {
    const src = readFileSync(atomPath, 'utf8')
    expect(src).toMatch(
      /atomWithStorage<boolean>\(\s*getKeyString\(KEYS\.workbenchEnabled\),\s*false/,
    )
  })

  it('passes harnessInspector into resolveWorkbenchChrome so the dock works without unified-shell', () => {
    expect(src).toContain('harnessInspector: useAtomValue(featureWorkbenchHarnessInspectorV1Atom)')
  })

  it('keeps harness chrome atoms defaulted to false', () => {
    const src = readFileSync(atomPath, 'utf8')
    for (const key of [
      'featureWorkbenchHarnessInspectorV1',
      'featureWorkbenchHarnessChatChromeV1',
      'featureWorkbenchHarnessAgentIntelV1',
      'featureWorkbenchHarnessExtCenterV1',
      'featureWorkbenchHarnessAgentTeams',
    ]) {
      expect(src).toMatch(
        new RegExp(`atomWithStorage<boolean>\\(\\s*getKeyString\\(KEYS\\.${key}\\),\\s*false`),
      )
    }
  })
})
