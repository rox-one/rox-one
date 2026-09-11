/** Keep id in sync with packages/core/src/conation/notes/flags.ts */
export const CONATION_NOTES_PANEL_ID = 'conation.notes' as const

export type NotesPanelFlags = {
  shellEnabled: boolean
  inspectorEnabled: boolean
  notesBridgeEnabled: boolean
}

export type NotesPanelContribution<C> = {
  id: typeof CONATION_NOTES_PANEL_ID
  title: 'Conation Notes'
  component: C
}

export type NotesPanelRegistry<C> = {
  register: (contribution: NotesPanelContribution<C>) => void
}

export function shouldRegisterNotesPanel(flags: NotesPanelFlags): boolean {
  return flags.shellEnabled === true && flags.inspectorEnabled === true && flags.notesBridgeEnabled === true
}

/** No-op unless shell + inspector + notesBridge are all on. */
export function registerNotesPanel<C>(
  registry: NotesPanelRegistry<C>,
  component: C,
  flags: NotesPanelFlags,
): void {
  if (!shouldRegisterNotesPanel(flags)) return
  registry.register({
    id: CONATION_NOTES_PANEL_ID,
    title: 'Conation Notes',
    component,
  })
}
