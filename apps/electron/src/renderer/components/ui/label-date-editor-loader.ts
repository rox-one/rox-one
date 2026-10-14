/**
 * Loader for the lazy label date editor, shared by LabelValuePopover's
 * React.lazy and the idle startup preload (lib/idle-preload.ts) so both reuse
 * one module promise.
 */
let pending: Promise<typeof import('./label-date-editor')> | null = null

export function loadLabelDateEditor(): Promise<typeof import('./label-date-editor')> {
  pending ??= import('./label-date-editor').catch((error) => {
    pending = null
    throw error
  })
  return pending
}
