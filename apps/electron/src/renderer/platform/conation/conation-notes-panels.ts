import type { PanelContribution, PanelRegistry, PanelRenderer } from '@craft-agent/core/platform'

/** Keep id in sync with packages/core/src/conation/notes/flags.ts */
export const CONATION_NOTES_PANEL_ID = 'conation.notes' as const

export type NotesPanelFlags = {
  shellEnabled: boolean
  inspectorEnabled: boolean
  notesBridgeEnabled: boolean
}

export function shouldRegisterNotesPanel(flags: NotesPanelFlags): boolean {
  return flags.shellEnabled === true && flags.inspectorEnabled === true && flags.notesBridgeEnabled === true
}

export function notesPanelContribution(
  render: PanelRenderer,
  title = 'Conation Notes',
): PanelContribution {
  return {
    id: CONATION_NOTES_PANEL_ID,
    title,
    icon: 'layers',
    slot: 'inspector',
    defaultOrder: 43,
    defaultVisible: true,
    resizable: true,
    source: { type: 'core', id: 'conation' },
    render,
  }
}

/** No-op unless shell + inspector + notesBridge are all on. */
export function registerNotesPanel(
  registry: PanelRegistry,
  render: PanelRenderer = () => null,
  flags: NotesPanelFlags = {
    shellEnabled: false,
    inspectorEnabled: false,
    notesBridgeEnabled: false,
  },
  title = 'Conation Notes',
): ReturnType<PanelRegistry['register']> | undefined {
  if (!shouldRegisterNotesPanel(flags)) return
  if (registry.get(CONATION_NOTES_PANEL_ID)) return
  return registry.register(notesPanelContribution(render, title))
}
