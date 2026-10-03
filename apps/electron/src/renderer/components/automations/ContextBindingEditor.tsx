import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { AutomationContextReference, AutomationContextPause, AutomationListItem, AutomationObjectKind } from './types'

export interface AutomationContextObjectChoice {
  reference: NonNullable<AutomationContextReference['object']>
  name: string
  projectId?: string
}

export interface ContextBindingEditorProps {
  workspaceId: string
  value?: AutomationContextReference
  paused?: AutomationContextPause
  projects: readonly { id: string; name: string }[]
  /** Actual canonical objects, not guessed names or identifiers typed by users. */
  objects?: readonly AutomationContextObjectChoice[]
  onSave(reference: AutomationContextReference | undefined): Promise<void>
  disabled?: boolean
}

/** The existing UPDATE RPC treats an explicit context field as validated relink.
 * Omitting context preserves the pause; null explicitly removes the association. */
export function contextBindingSavePayload(automation: Pick<AutomationListItem, 'event' | 'revision'>, reference?: AutomationContextReference) {
  return { event: automation.event, matcher: { context: reference ?? null }, expectedRevision: automation.revision }
}

export async function saveAutomationContextBinding(workspaceId: string, automation: AutomationListItem, reference?: AutomationContextReference,
  api: Pick<Window['electronAPI'], 'updateAutomation'> = window.electronAPI) {
  return api.updateAutomation(workspaceId, automation.event, automation.matcherIndex, contextBindingSavePayload(automation, reference))
}

export function ContextBindingEditor({ workspaceId, value, paused, projects, objects = [], onSave, disabled }: ContextBindingEditorProps) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const [projectId, setProjectId] = React.useState(value?.projectId ?? '')
  const [kind, setKind] = React.useState<AutomationObjectKind | ''>(value?.object?.kind ?? '')
  const [objectId, setObjectId] = React.useState(value?.object?.id ?? '')
  const [busy, setBusy] = React.useState(false)
  const [feedback, setFeedback] = React.useState<'saved' | 'failed' | null>(null)
  const id = React.useId()
  React.useEffect(() => {
    setProjectId(value?.projectId ?? ''); setKind(value?.object?.kind ?? ''); setObjectId(value?.object?.id ?? ''); setFeedback(null)
  }, [workspaceId, value?.projectId, value?.object?.kind, value?.object?.id])
  const eligibleObjects = objects.filter(object => !projectId || object.projectId === projectId)
  const kinds = [...new Set(eligibleObjects.map(object => object.reference.kind))]
  if (value?.object && !kinds.includes(value.object.kind)) kinds.push(value.object.kind)
  const choices = eligibleObjects.filter(object => object.reference.kind === kind)
  const selectedExisting = value?.object?.kind === kind && value.object.id === objectId && value.projectId === (projectId || undefined)
  const knownSelected = choices.some(choice => choice.reference.id === objectId)
  const invalidSelection = Boolean(kind && (!objectId || (!knownSelected && !selectedExisting)))
  const save = async (reference: AutomationContextReference | undefined) => {
    setBusy(true); setFeedback(null)
    try { await onSave(reference); setFeedback('saved') } catch { setFeedback('failed') } finally { setBusy(false) }
  }
  const controlClass = 'w-full rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
  return <section className="space-y-3 rounded-lg border border-foreground/10 p-3" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="text-sm font-medium">{t('automations.context.title')}</h3>
    <p className="text-xs text-muted-foreground">{t('automations.context.help')}</p>
    {paused && <p role="status" className="text-xs text-amber-600">{t(paused.reason === 'target-deleted' ? 'automations.context.pausedDeleted' : 'automations.context.pausedOutOfScope')}</p>}
    <form className="space-y-3" onSubmit={event => {
      event.preventDefault()
      if (!invalidSelection) void save({ workspaceId, ...(projectId ? { projectId } : {}), ...(kind && objectId ? { object: { kind, id: objectId } } : {}) })
    }}>
      <div className="space-y-1">
        <label htmlFor={`${id}-project`} className="text-xs font-medium">{t('automations.context.project')}</label>
        <select id={`${id}-project`} className={controlClass} value={projectId} disabled={disabled || busy} onChange={event => { setProjectId(event.target.value); setKind(''); setObjectId('') }}>
          <option value="">{t('automations.context.workspace')}</option>
          {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          {projectId && !projects.some(project => project.id === projectId) && <option value={projectId}>{t('automations.context.unavailableProject')}</option>}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-kind`} className="text-xs font-medium">{t('automations.context.objectKind')}</label>
        <select id={`${id}-kind`} className={controlClass} value={kind} disabled={disabled || busy} onChange={event => { setKind(event.target.value as AutomationObjectKind | ''); setObjectId('') }}>
          <option value="">{t('automations.context.noObject')}</option>
          {kinds.map(objectKind => <option key={objectKind} value={objectKind}>{t(`automations.context.kind.${objectKind}`)}</option>)}
        </select>
      </div>
      {kind && <div className="space-y-1">
        <label htmlFor={`${id}-object`} className="text-xs font-medium">{t('automations.context.object')}</label>
        <select id={`${id}-object`} className={controlClass} value={objectId} disabled={disabled || busy} onChange={event => setObjectId(event.target.value)}>
          <option value="">{t('automations.context.chooseObject')}</option>
          {choices.map(object => <option key={object.reference.id} value={object.reference.id}>{object.name}</option>)}
          {selectedExisting && !knownSelected && <option value={objectId}>{t('automations.context.currentObject')}</option>}
        </select>
      </div>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={disabled || busy || invalidSelection} className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-40">{t(busy ? 'automations.context.saving' : paused ? 'automations.context.relink' : 'automations.context.save')}</button>
        {value && <button type="button" disabled={disabled || busy} onClick={() => void save(undefined)} className="rounded-md border border-foreground/15 px-3 py-1.5 text-xs disabled:opacity-40">{t('automations.context.remove')}</button>}
      </div>
    </form>
    <AnimatePresence initial={false}>
      {feedback && <motion.p key={feedback} role={feedback === 'failed' ? 'alert' : 'status'} className="text-xs text-muted-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.15 }}>{t(feedback === 'saved' ? 'automations.context.saved' : 'automations.context.saveFailed')}</motion.p>}
    </AnimatePresence>
  </section>
}
