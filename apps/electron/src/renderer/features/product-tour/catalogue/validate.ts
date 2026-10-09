import { productTourCatalogue } from './product-tour-catalogue'
import { DYNAMIC_STEP_ID_PATTERN, DYNAMIC_TOUR_ID_PATTERN } from '../contracts'

const TourIdValues: Record<string, true> = { "OBT-01": true, "OBT-02": true, "OBT-03": true, "OBT-04": true, "OBT-05": true, "OBT-06": true, "OBT-07": true, "OBT-08": true, "OBT-09": true, "OBT-10": true, "OBT-11": true, "OBT-12": true, "OBT-13": true, "OBT-14": true, "OBT-15": true, "OBT-16": true, "OBT-17": true, "OBT-18": true, "OBT-19": true, "OBT-20": true, "OBT-21": true, "OBT-22": true, "OBT-23": true, "OBT-24": true, "OBT-25": true }
const StepIdValues: Record<string, true> = { "sources.ask": true, "agents.budget": true, "agents.overview": true, "approval.inspect": true, "approval.resolve": true, "attachments.add": true, "attachments.review": true, "automation.action": true, "automation.control": true, "automation.trigger": true, "connections.audit": true, "connections.services": true, "cwd.inspect": true, "feed.read": true, "feed.sources": true, "first.compose": true, "first.execution": true, "first.permissions": true, "first.result": true, "first.send": true, "first.session": true, "inbox.queue": true, "inbox.triage": true, "learning.controls": true, "learning.library": true, "meetings.list": true, "meetings.result": true, "memory.inspect": true, "memory.repo": true, "memory.save": true, "memory.scope": true, "models.picker": true, "models.settings": true, "notes.create": true, "notes.save": true, "pages.open": true, "pages.state": true, "parallel.new": true, "parallel.return": true, "project.link": true, "project.open": true, "search.open": true, "search.query": true, "skills.explain": true, "skills.select": true, "sources.details": true, "sources.result": true, "sources.select": true, "sources.status": true, "tasks.create": true, "tasks.delegate": true, "voice.review": true, "voice.start": true, "workflow.board": true, "workflow.label": true, "workflow.status": true, "workspace.scope": true }
const TargetIdValues: Record<string, true> = { "agents.budget": true, "agents.summary": true, "automation.action": true, "automation.controls": true, "automation.trigger": true, "composer.attach": true, "composer.attachments": true, "composer.directory": true, "composer.input": true, "composer.model": true, "composer.permissions": true, "composer.send": true, "composer.skills": true, "composer.sources": true, "composer.voice": true, "connections.audit": true, "connections.services": true, "feed.reader": true, "feed.sources": true, "inbox.actions": true, "inbox.list": true, "learning.library": true, "learning.preferences": true, "meetings.artifacts": true, "meetings.list": true, "memory.editor": true, "memory.list": true, "memory.repo": true, "memory.scope": true, "notes.create": true, "notes.editor": true, "pages.freshness": true, "pages.host": true, "permission.actions": true, "permission.request": true, "projects.list": true, "search.input": true, "search.results": true, "session.entry": true, "session.execution": true, "session.final-result": true, "session.labels": true, "session.list": true, "session.new": true, "session.project": true, "session.status": true, "session.tool-result": true, "sessions.view-switcher": true, "settings.ai": true, "skills.list": true, "source.status": true, "sources.list": true, "tasks.delegate": true, "tasks.quick-entry": true, "workspace.switcher": true,
  // Dev Space / Playbooks surfaces (D9): allowed for dynamic tours, unused by the static catalogue.
  "devspace.repo.overview": true, "devspace.wiki.reader": true, "devspace.wiki.plan": true, "devspace.understand.graph": true, "devspace.codegraph.search": true, "devspace.diagram.canvas": true, "devspace.kg.graph": true, "devspace.c4.viewer": true, "devspace.questions.block1": true, "devspace.questions.block2": true, "devspace.questions.block3": true, "devspace.chat.composer": true, "playbooks.sources.list": true, "playbooks.questions.presets": true, "playbooks.podcast.player": true, "playbooks.codebook.cells": true }
const SignalNameValues: Record<string, true> = { "attachment.ready": true, "connections.audit-visible": true, "dictation.inserted": true, "draft.nonempty": true, "execution.state-visible": true, "feed.item-opened": true, "meeting.artifact-opened": true, "memory.persisted": true, "model-picker.opened": true, "note.created": true, "note.persisted": true, "page.rendered": true, "permission.resolved-by-user": true, "personal-task.delegated": true, "personal-task.persisted": true, "project.visible": true, "search.finished": true, "search.result-opened": true, "session.created": true, "session.labels-committed": true, "session.project-committed": true, "session.ready": true, "session.reopened": true, "session.sources-committed": true, "session.status-committed": true, "sessions.view-visible": true, "skill.selected": true, "source.details-visible": true, "source.tool-succeeded": true, "user-turn.accepted": true, "user-turn.final-delivered": true }
const CapabilityIdValues: Record<string, true> = { "agent-center.available": true, "attachments.available": true, "automation.entity-present": true, "automations.available": true, "connection-fabric.available": true, "feed.available": true, "filesystem.selector": true, "inbox.available": true, "labels.available": true, "meeting.artifact-present": true, "meetings.available": true, "memory.available": true, "memory.write-available": true, "notes.available": true, "pages.available": true, "pages.entity-present": true, "permissions.pending": true, "personal-tasks.available": true, "projects.available": true, "search.available": true, "sessions.available": true, "shell.ready": true, "skills.available": true, "sources.list": true, "sources.ready": true, "task.delegation-available": true, "voice.available": true,
  // Dev Space / Playbooks capabilities (D9).
  "devspace.available": true, "devspace.artifacts.ready": true, "openwiki.available": true, "understand.available": true, "codegraph.available": true, "archify.available": true, "graphify.available": true, "groma.available": true, "playbooks.available": true, "podcast.tts-available": true, "podcast.ffmpeg-available": true }
const TriggerIdValues: Record<string, true> = { "agent-center-opened": true, "attachment-control-opened": true, "automation-editor-opened": true, "connections-opened": true, "feed-opened": true, "first-answer-delivered": true, "inbox-opened": true, "learning-manual-start": true, "material-persisted": true, "meetings-opened": true, "memory-opened": true, "model-picker-opened": true, "notes-opened": true, "page-opened": true, "permission-request-present": true, "project-opened": true, "ready-source-available": true, "second-session-created": true, "session-workflow-opened": true, "settings-ai-opened": true, "skills-opened": true, "sources-opened": true, "tasks-opened": true, "voice-control-opened": true, "welcome-created": true, "working-directory-opened": true, "workspace-menu-opened": true,
  // Dev Space / Playbooks triggers (D9).
  "devspace-opened": true, "repo-analyzed": true, "wiki-ready": true, "questions-ready": true, "playbooks-opened": true, "podcast-generated": true }
const RouteKeyValues: Record<string, true> = { "agents": true, "connections": true, "current-session": true, "feed": true, "inbox": true, "keep": true, "learning": true, "meetings": true, "memory": true, "memory-repo": true, "notes": true, "projects": true, "search": true, "selected-automation": true, "selected-page": true, "selected-source": true, "settings-ai": true, "skills": true, "sources": true, "tasks": true,
  // Dev Space / Playbooks routes (D9).
  "devspace": true, "devspace-repo": true, "playbooks": true, "playbooks-source": true, "playbooks-codebook": true }

/** Dynamic tour id space (D9): `DS-<slug>-<n>` for dev space, `PB-<slug>-<n>` for Playbooks. */
export const DynamicTourIdPattern = DYNAMIC_TOUR_ID_PATTERN
/** Dynamic step id space: `<surface>.<slug>` on the `devspace`/`playbooks` surfaces. */
export const DynamicStepIdPattern = DYNAMIC_STEP_ID_PATTERN

const tourFields = ['id', 'slug', 'version', 'title', 'goal', 'why', 'trigger', 'entryTriggers', 'titleKey', 'goalKey', 'whyKey', 'requires', 'owner', 'evidence', 'priority', 'steps']
const stepFields = ['id', 'version', 'target', 'routeKey', 'scope', 'copyKey', 'copy', 'completion', 'handoff', 'optional', 'requires', 'onUnavailable', 'missingTarget', 'notes', 'testId']
const completionFields = ['kind', 'signal', 'evidence', 'priorState', 'requireAcknowledgementAfterEvidence']
const verifiedSignals: Record<string, true> = { 'user-turn.accepted': true, 'user-turn.final-delivered': true, 'source.tool-succeeded': true, 'permission.resolved-by-user': true, 'personal-task.persisted': true, 'personal-task.delegated': true, 'note.created': true, 'note.persisted': true, 'memory.persisted': true, 'search.result-opened': true }
type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const version = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const placeholders = (value: string): string => (value.match(/{{\w+}}/g) ?? []).sort().join(',')

interface TourUniqueness {
  readonly tourIds: Set<string>
  readonly slugs: Set<string>
  readonly stepIds: Set<string>
  readonly testIds: Set<string>
}

interface TourValidationRules {
  /** Static tours pin a closed union; dynamic tours accept the generated id space. */
  readonly tourId: (value: unknown) => boolean
  readonly stepId: (value: unknown) => boolean
  /** Static tours must stay manually startable; generated tours are surface-triggered. */
  readonly requireManualStart: boolean
  /** Static evidence references are `E<n>`; generated tours cite artifact ids. */
  readonly evidence: RegExp
}

const staticRules: TourValidationRules = {
  tourId: value => typeof value === 'string' && TourIdValues[value] === true,
  stepId: value => typeof value === 'string' && StepIdValues[value] === true,
  requireManualStart: true,
  evidence: /^E\d+$/,
}
const dynamicRules: TourValidationRules = {
  tourId: value => typeof value === 'string' && DynamicTourIdPattern.test(value),
  stepId: value => typeof value === 'string' && DynamicStepIdPattern.test(value),
  requireManualStart: false,
  evidence: /^[A-Za-z0-9._:-]+$/,
}

/** Per-tour schema validation shared by the static catalogue and the dynamic source. */
function validateTour(tour: unknown, path: string, errors: string[], rules: TourValidationRules, unique: TourUniqueness): void {
  const error = (at: string, message: string): void => { errors.push(`${at}: ${message}`) }
  const fields = (value: RecordValue, allowed: readonly string[], at: string): void => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) error(`${at}.${key}`, 'unknown configuration field')
    for (const key of allowed) if (!(key in value)) error(`${at}.${key}`, 'required field missing')
  }
  const member = (value: unknown, allowed: Record<string, true>, at: string): void => {
    if (typeof value !== 'string' || allowed[value] !== true) error(at, 'unknown identifier')
  }
  const identifiers = (value: unknown, allowed: Record<string, true>, at: string): void => {
    if (!Array.isArray(value)) { error(at, 'expected an array'); return }
    const seen = new Set<unknown>()
    for (const id of value) { member(id, allowed, at); if (seen.has(id)) error(at, 'duplicate identifier'); seen.add(id) }
  }
  const uniqueId = (value: unknown, set: Set<string>, at: string): void => {
    if (typeof value !== 'string') return
    if (set.has(value)) error(at, 'duplicate identifier')
    set.add(value)
  }
  if (!record(tour)) { error(path, 'expected tour record'); return }
  fields(tour, tourFields, path)
  if (!rules.tourId(tour.id)) error(`${path}.id`, 'unknown identifier')
  uniqueId(tour.id, unique.tourIds, `${path}.id`)
  if (!text(tour.slug) || !/^[a-z]+(?:-[a-z]+)*$/.test(tour.slug)) error(`${path}.slug`, 'expected stable slug')
  uniqueId(tour.slug, unique.slugs, `${path}.slug`)
  if (!version(tour.version)) error(`${path}.version`, 'expected positive integer')
  for (const key of ['title', 'goal', 'why', 'trigger', 'owner']) if (!text(tour[key])) error(`${path}.${key}`, 'expected authoring text')
  for (const key of ['titleKey', 'goalKey', 'whyKey']) {
    const suffix = key === 'titleKey' ? 'name' : key === 'goalKey' ? 'goal' : 'why'
    if (tour[key] !== `productTour.${tour.slug}.${suffix}`) error(`${path}.${key}`, 'incorrect copy namespace')
  }
  identifiers(tour.requires, CapabilityIdValues, `${path}.requires`)
  identifiers(tour.entryTriggers, TriggerIdValues, `${path}.entryTriggers`)
  if (!Array.isArray(tour.entryTriggers) || tour.entryTriggers.length === 0) error(`${path}.entryTriggers`, 'expected at least one trigger')
  if (rules.requireManualStart && (!Array.isArray(tour.entryTriggers) || !tour.entryTriggers.includes('learning-manual-start'))) error(`${path}.entryTriggers`, 'manual start must remain available')
  if (!Array.isArray(tour.evidence) || !tour.evidence.length || tour.evidence.some(id => typeof id !== 'string' || !rules.evidence.test(id))) error(`${path}.evidence`, 'expected evidence references')
  if (!['P0', 'P1', 'P2'].includes(tour.priority as string)) error(`${path}.priority`, 'unknown priority')
  if (!Array.isArray(tour.steps) || !tour.steps.length) { error(`${path}.steps`, 'expected ordered steps'); return }
  for (const [stepIndex, step] of tour.steps.entries()) {
    const sp = `${path}.steps[${stepIndex}]`
    if (!record(step)) { error(sp, 'expected step record'); continue }
    fields(step, stepFields, sp)
    if (!rules.stepId(step.id)) error(`${sp}.id`, 'unknown identifier')
    uniqueId(step.id, unique.stepIds, `${sp}.id`)
    member(step.target, TargetIdValues, `${sp}.target`)
    member(step.routeKey, RouteKeyValues, `${sp}.routeKey`)
    if (!version(step.version)) error(`${sp}.version`, 'expected positive integer')
    if (step.scope !== 'shell' && step.scope !== 'bound-panel') error(`${sp}.scope`, 'unknown target scope')
    if ((step.target === 'workspace.switcher') !== (step.scope === 'shell')) error(`${sp}.scope`, 'target scope mismatch')
    if (step.copyKey !== `productTour.${tour.slug}.${step.id}.`) error(`${sp}.copyKey`, 'incorrect copy namespace')
    identifiers(step.requires, CapabilityIdValues, `${sp}.requires`)
    if (typeof step.handoff !== 'boolean' || typeof step.optional !== 'boolean') error(sp, 'handoff and optional must be booleans')
    if (step.onUnavailable !== 'block' && step.onUnavailable !== 'not-applicable') error(`${sp}.onUnavailable`, 'unknown unavailable policy')
    if (step.onUnavailable === 'not-applicable' && step.optional !== true) error(`${sp}.onUnavailable`, 'required steps cannot become not applicable')
    if (step.missingTarget !== 'block-and-offer-retry-or-pause') error(`${sp}.missingTarget`, 'missing targets must block')
    if (typeof step.notes !== 'string') error(`${sp}.notes`, 'expected authoring text')
    if (!text(step.testId) || !/^T-[A-Z0-9-]+$/.test(step.testId)) error(`${sp}.testId`, 'missing stable test ID')
    uniqueId(step.testId, unique.testIds, `${sp}.testId`)
    if (!record(step.copy)) error(`${sp}.copy`, 'expected locale copy')
    else {
      fields(step.copy, ['ru', 'en'], `${sp}.copy`)
      for (const lang of ['ru', 'en']) {
        const copy = step.copy[lang]
        if (!record(copy)) { error(`${sp}.copy.${lang}`, 'expected title and body'); continue }
        fields(copy, ['title', 'body'], `${sp}.copy.${lang}`)
        for (const key of ['title', 'body']) if (!text(copy[key])) error(`${sp}.copy.${lang}.${key}`, 'missing copy')
      }
      if (record(step.copy.ru) && record(step.copy.en)) for (const key of ['title', 'body']) {
        if (text(step.copy.ru[key]) && text(step.copy.en[key]) && placeholders(step.copy.ru[key]) !== placeholders(step.copy.en[key])) error(`${sp}.copy.${key}`, 'placeholder mismatch')
      }
    }
    const policy = step.completion
    if (!record(policy)) { error(`${sp}.completion`, 'expected completion policy'); continue }
    fields(policy, completionFields, `${sp}.completion`)
    if (policy.kind === 'ack') {
      if (policy.signal !== null || policy.evidence !== 'acknowledged') error(`${sp}.completion`, 'acknowledgement is not action evidence')
    } else if (policy.kind === 'signal') {
      member(policy.signal, SignalNameValues, `${sp}.completion.signal`)
      if (policy.evidence !== 'observed' && policy.evidence !== 'verified') error(`${sp}.completion.evidence`, 'signals require action evidence')
      if (verifiedSignals[policy.signal as string] === true && policy.evidence !== 'verified') error(`${sp}.completion.evidence`, 'native outcome requires verified evidence')
    } else error(`${sp}.completion.kind`, 'unknown completion kind')
    if (!['after-activation', 'allow-current-state', 'same-attempt'].includes(policy.priorState as string)) error(`${sp}.completion.priorState`, 'unknown prior-state policy')
    if (typeof policy.requireAcknowledgementAfterEvidence !== 'boolean') error(`${sp}.completion`, 'acknowledgement flag must be boolean')
  }
}

/** Returns authoring diagnostics for the static catalogue. It never executes supplied configuration. */
export function validateProductTourCatalogue(catalogue: unknown = productTourCatalogue): readonly string[] {
  const errors: string[] = []
  const seen = new Set<object>()
  const declarative = (value: unknown, path: string): boolean => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
    if (typeof value === 'number' && Number.isFinite(value)) return true
    if (typeof value !== 'object') { errors.push(`${path}: executable or non-JSON value`); return false }
    if (seen.has(value)) { errors.push(`${path}: cyclic or shared configuration`); return false }
    seen.add(value)
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      errors.push(`${path}: configuration must use plain records`); return false
    }
    let valid = true
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (Array.isArray(value) && key === 'length') continue
      if (!('value' in descriptor)) { errors.push(`${path}.${key}: executable accessor`); valid = false }
      else if (!declarative(descriptor.value, `${path}.${key}`)) valid = false
    }
    return valid
  }
  if (!declarative(catalogue, 'catalogue')) return errors
  if (!Array.isArray(catalogue)) return ['catalogue: expected an array']
  if (catalogue.length !== 25) errors.push('catalogue: expected all 25 tours')
  const unique: TourUniqueness = { tourIds: new Set(), slugs: new Set(), stepIds: new Set(), testIds: new Set() }
  for (const [tourIndex, tour] of catalogue.entries()) validateTour(tour, `catalogue[${tourIndex}]`, errors, staticRules, unique)
  if (unique.stepIds.size !== 57) errors.push('catalogue: expected all 57 unique steps')
  for (const id of Object.keys(TourIdValues)) if (!unique.tourIds.has(id)) errors.push(`catalogue: missing tour ${id}`)
  for (const id of Object.keys(StepIdValues)) if (!unique.stepIds.has(id)) errors.push(`catalogue: missing step ${id}`)
  return errors
}

/**
 * Returns authoring diagnostics for a generated (dynamic) tour array. The caller supplies the
 * definitions; this never reads artifacts and never executes supplied configuration.
 */
export function validateDynamicTourCatalogue(catalogue: unknown): readonly string[] {
  if (!Array.isArray(catalogue)) return ['catalogue: expected an array']
  const errors: string[] = []
  const unique: TourUniqueness = { tourIds: new Set(), slugs: new Set(), stepIds: new Set(), testIds: new Set() }
  for (const [tourIndex, tour] of catalogue.entries()) validateTour(tour, `catalogue[${tourIndex}]`, errors, dynamicRules, unique)
  return errors
}