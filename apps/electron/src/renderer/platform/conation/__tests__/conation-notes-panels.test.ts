import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPanelRegistry } from '@craft-agent/core/platform'
import {
  CONATION_NOTES_PANEL_ID,
  registerNotesPanel,
  shouldRegisterNotesPanel,
} from '../conation-notes-panels.ts'
import { createConationNotesBridge } from '../ConationNotesPanel'

const notesPanelSource = readFileSync(join(__dirname, '../ConationNotesPanel.tsx'), 'utf8')

describe('registerNotesPanel', () => {
  it('is off unless shell, inspector, and notesBridge are all on', () => {
    expect(
      shouldRegisterNotesPanel({
        shellEnabled: false,
        inspectorEnabled: true,
        notesBridgeEnabled: true,
      }),
    ).toBe(false)
    expect(
      shouldRegisterNotesPanel({
        shellEnabled: true,
        inspectorEnabled: false,
        notesBridgeEnabled: true,
      }),
    ).toBe(false)
    expect(
      shouldRegisterNotesPanel({
        shellEnabled: true,
        inspectorEnabled: true,
        notesBridgeEnabled: false,
      }),
    ).toBe(false)
    expect(
      shouldRegisterNotesPanel({
        shellEnabled: true,
        inspectorEnabled: true,
        notesBridgeEnabled: true,
      }),
    ).toBe(true)
  })

  it('does not register when flags are off', () => {
    const registry = createPanelRegistry()
    registerNotesPanel(registry)
    registerNotesPanel(registry, () => null, {
      shellEnabled: true,
      inspectorEnabled: true,
      notesBridgeEnabled: false,
    })
    expect(registry.get(CONATION_NOTES_PANEL_ID)).toBeUndefined()
    expect(registry.list('inspector', {}).map((panel) => panel.id)).not.toContain(
      CONATION_NOTES_PANEL_ID,
    )
  })

  it('registers conation.notes once when all flags are on', () => {
    const registry = createPanelRegistry()
    const render = () => null
    const registration = registerNotesPanel(
      registry,
      render,
      {
        shellEnabled: true,
        inspectorEnabled: true,
        notesBridgeEnabled: true,
      },
      'Localized Notes',
    )
    const duplicate = registerNotesPanel(
      registry,
      render,
      {
        shellEnabled: true,
        inspectorEnabled: true,
        notesBridgeEnabled: true,
      },
      'Localized Notes',
    )

    expect(registry.get(CONATION_NOTES_PANEL_ID)?.title).toBe('Localized Notes')
    expect(registry.get(CONATION_NOTES_PANEL_ID)?.source.id).toBe('conation')
    expect(registry.get(CONATION_NOTES_PANEL_ID)?.defaultOrder).toBe(43)
    expect(
      registry.list('inspector', {}).filter((panel) => panel.id === CONATION_NOTES_PANEL_ID),
    ).toHaveLength(1)
    expect(registration).toBeDefined()
    expect(duplicate).toBeUndefined()
  })

  it('adapts the existing Notes API and scopes reads to one workspace', async () => {
    const calls: string[] = []
    const bridge = createConationNotesBridge(
      {
        listNotes: async (workspaceId) => {
          calls.push(`list:${workspaceId}`)
          return [{ id: 'folder/note', title: 'Note title' }]
        },
        readNote: async (workspaceId, noteId) => {
          calls.push(`read:${workspaceId}:${noteId}`)
          return { id: noteId, title: 'Note title', content: '# Body' }
        },
      },
      'workspace-1',
    )

    expect(bridge).not.toBeNull()
    if (!bridge) throw new Error('Expected Notes bridge')

    expect(await bridge.listNotes()).toEqual({
      items: [{ id: 'folder/note', title: 'Note title' }],
    })
    expect(await bridge.getNote('folder/note')).toEqual({
      id: 'folder/note',
      title: 'Note title',
      body: '# Body',
    })
    expect(calls).toEqual([
      'list:workspace-1',
      'read:workspace-1:folder/note',
    ])
  })

  it('does not create a Notes bridge without an API or active workspace', () => {
    const api = {
      listNotes: async () => [],
      readNote: async (_workspaceId: string, noteId: string) => ({
        id: noteId,
        title: '',
        content: '',
      }),
    }

    expect(createConationNotesBridge(api, null)).toBeNull()
    expect(createConationNotesBridge(null, 'workspace-1')).toBeNull()
  })

  it('guards note reads and maps technical failures to translated errors', () => {
    expect(notesPanelSource).toContain('const readGenerationRef = useRef(0)')
    expect(notesPanelSource).toContain('const generation = ++readGenerationRef.current')
    expect(notesPanelSource).toContain('if (generation !== readGenerationRef.current) return')
    expect(notesPanelSource.match(/readGenerationRef\.current \+= 1/g)).toHaveLength(2)
    expect(notesPanelSource).toContain("setErrorKey('conation.notes.loadError')")
    expect(notesPanelSource).toContain("setErrorKey('conation.notes.readError')")
    expect(notesPanelSource).toContain("console.error('[ConationNotesPanel] Failed to list notes:'")
    expect(notesPanelSource).toContain("console.error('[ConationNotesPanel] Failed to read note:'")
    expect(notesPanelSource).not.toContain('err.message')
  })
})
