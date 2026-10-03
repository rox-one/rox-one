import { productTourCatalogue } from './product-tour-catalogue'

const TourIdValues = new Set(["OBT-01", "OBT-02", "OBT-03", "OBT-04", "OBT-05", "OBT-06", "OBT-07", "OBT-08", "OBT-09", "OBT-10", "OBT-11", "OBT-12", "OBT-13", "OBT-14", "OBT-15", "OBT-16", "OBT-17", "OBT-18", "OBT-19", "OBT-20", "OBT-21", "OBT-22", "OBT-23", "OBT-24", "OBT-25"])
const StepIdValues = new Set(["sources.ask", "agents.budget", "agents.overview", "approval.inspect", "approval.resolve", "attachments.add", "attachments.review", "automation.action", "automation.control", "automation.trigger", "connections.audit", "connections.services", "cwd.inspect", "feed.read", "feed.sources", "first.compose", "first.execution", "first.permissions", "first.result", "first.send", "first.session", "inbox.queue", "inbox.triage", "learning.controls", "learning.library", "meetings.list", "meetings.result", "memory.inspect", "memory.save", "memory.scope", "models.picker", "models.settings", "notes.create", "notes.save", "pages.open", "pages.state", "parallel.new", "parallel.return", "project.link", "project.open", "search.open", "search.query", "skills.explain", "skills.select", "sources.details", "sources.result", "sources.select", "sources.status", "tasks.create", "tasks.delegate", "voice.review", "voice.start", "workflow.board", "workflow.label", "workflow.status", "workspace.scope"])
const TargetIdValues = new Set(["agents.budget", "agents.summary", "automation.action", "automation.controls", "automation.trigger", "composer.attach", "composer.attachments", "composer.directory", "composer.input", "composer.model", "composer.permissions", "composer.send", "composer.skills", "composer.sources", "composer.voice", "connections.audit", "connections.services", "feed.reader", "feed.sources", "inbox.actions", "inbox.list", "learning.library", "learning.preferences", "meetings.artifacts", "meetings.list", "memory.editor", "memory.list", "memory.scope", "notes.create", "notes.editor", "pages.freshness", "pages.host", "permission.actions", "permission.request", "projects.list", "search.input", "search.results", "session.entry", "session.execution", "session.final-result", "session.labels", "session.list", "session.new", "session.project", "session.status", "session.tool-result", "sessions.view-switcher", "settings.ai", "skills.list", "source.status", "sources.list", "tasks.delegate", "tasks.quick-entry", "workspace.switcher"])
const SignalNameValues = new Set(["attachment.ready", "connections.audit-visible", "dictation.inserted", "draft.nonempty", "execution.state-visible", "feed.item-opened", "meeting.artifact-opened", "memory.persisted", "model-picker.opened", "note.created", "note.persisted", "page.rendered", "permission.resolved-by-user", "personal-task.delegated", "personal-task.persisted", "project.visible", "search.finished", "search.result-opened", "session.created", "session.labels-committed", "session.project-committed", "session.ready", "session.reopened", "session.sources-committed", "session.status-committed", "sessions.view-visible", "skill.selected", "source.details-visible", "source.tool-succeeded", "user-turn.accepted", "user-turn.final-delivered"])
const CapabilityIdValues = new Set(["agent-center.available", "attachments.available", "automation.entity-present", "automations.available", "connection-fabric.available", "feed.available", "filesystem.selector", "inbox.available", "labels.available", "meeting.artifact-present", "meetings.available", "memory.available", "memory.write-available", "notes.available", "pages.available", "pages.entity-present", "permissions.pending", "personal-tasks.available", "projects.available", "search.available", "sessions.available", "shell.ready", "skills.available", "sources.list", "sources.ready", "task.delegation-available", "voice.available"])
const TriggerIdValues = new Set(["agent-center-opened", "attachment-control-opened", "automation-editor-opened", "connections-opened", "feed-opened", "first-answer-delivered", "inbox-opened", "learning-manual-start", "material-persisted", "meetings-opened", "memory-opened", "model-picker-opened", "notes-opened", "page-opened", "permission-request-present", "project-opened", "ready-source-available", "second-session-created", "session-workflow-opened", "settings-ai-opened", "skills-opened", "sources-opened", "tasks-opened", "voice-control-opened", "welcome-created", "working-directory-opened", "workspace-menu-opened"])
const RouteKeyValues = new Set(["agents", "connections", "current-session", "feed", "inbox", "keep", "learning", "meetings", "memory", "notes", "projects", "search", "selected-automation", "selected-page", "selected-source", "settings-ai", "skills", "sources", "tasks"])

const tourFields = ['id', 'slug', 'version', 'title', 'goal', 'why', 'trigger', 'entryTriggers', 'titleKey', 'goalKey', 'whyKey', 'requires', 'owner', 'evidence', 'priority', 'steps']
const stepFields = ['id', 'version', 'target', 'routeKey', 'scope', 'copyKey', 'copy', 'completion', 'handoff', 'optional', 'requires', 'onUnavailable', 'missingTarget', 'notes', 'testId']
const completionFields = ['kind', 'signal', 'evidence', 'priorState', 'requireAcknowledgementAfterEvidence']
const verifiedSignals = new Set(['user-turn.accepted', 'user-turn.final-delivered', 'source.tool-succeeded', 'permission.resolved-by-user', 'personal-task.persisted', 'personal-task.delegated', 'note.created', 'note.persisted', 'memory.persisted', 'search.result-opened'])
type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const version = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const placeholders = (value: string): string => (value.match(/{{\w+}}/g) ?? []).sort().join(',')

/** Returns authoring diagnostics. It never executes supplied configuration. */
export function validateProductTourCatalogue(catalogue: unknown = productTourCatalogue): readonly string[] {
  const errors: string[] = []
  const error = (path: string, message: string): void => { errors.push(`${path}: ${message}`) }
  const seen = new Set<object>()
  const declarative = (value: unknown, path: string): boolean => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
    if (typeof value === 'number' && Number.isFinite(value)) return true
    if (typeof value !== 'object') { error(path, 'executable or non-JSON value'); return false }
    if (seen.has(value)) { error(path, 'cyclic or shared configuration'); return false }
    seen.add(value)
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      error(path, 'configuration must use plain records'); return false
    }
    let valid = true
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (Array.isArray(value) && key === 'length') continue
      if (!('value' in descriptor)) { error(`${path}.${key}`, 'executable accessor'); valid = false }
      else if (!declarative(descriptor.value, `${path}.${key}`)) valid = false
    }
    return valid
  }
  if (!declarative(catalogue, 'catalogue')) return errors
  if (!Array.isArray(catalogue)) return ['catalogue: expected an array']
  if (catalogue.length !== 25) error('catalogue', 'expected all 25 tours')
  const tourIds = new Set<string>(), slugs = new Set<string>(), stepIds = new Set<string>(), testIds = new Set<string>()
  const fields = (value: RecordValue, allowed: readonly string[], path: string): void => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) error(`${path}.${key}`, 'unknown configuration field')
    for (const key of allowed) if (!(key in value)) error(`${path}.${key}`, 'required field missing')
  }
  const member = (value: unknown, allowed: Set<string>, path: string): void => {
    if (typeof value !== 'string' || !allowed.has(value)) error(path, 'unknown identifier')
  }
  const identifiers = (value: unknown, allowed: Set<string>, path: string): void => {
    if (!Array.isArray(value)) { error(path, 'expected an array'); return }
    const unique = new Set<unknown>()
    for (const id of value) { member(id, allowed, path); if (unique.has(id)) error(path, 'duplicate identifier'); unique.add(id) }
  }
  const unique = (value: unknown, set: Set<string>, path: string): void => {
    if (typeof value !== 'string') return
    if (set.has(value)) error(path, 'duplicate identifier')
    set.add(value)
  }
  for (const [tourIndex, tour] of catalogue.entries()) {
    const path = `catalogue[${tourIndex}]`
    if (!record(tour)) { error(path, 'expected tour record'); continue }
    fields(tour, tourFields, path)
    member(tour.id, TourIdValues, `${path}.id`); unique(tour.id, tourIds, `${path}.id`)
    if (!text(tour.slug) || !/^[a-z]+(?:-[a-z]+)*$/.test(tour.slug)) error(`${path}.slug`, 'expected stable slug')
    unique(tour.slug, slugs, `${path}.slug`)
    if (!version(tour.version)) error(`${path}.version`, 'expected positive integer')
    for (const key of ['title', 'goal', 'why', 'trigger', 'owner']) if (!text(tour[key])) error(`${path}.${key}`, 'expected authoring text')
    for (const key of ['titleKey', 'goalKey', 'whyKey']) {
      const suffix = key === 'titleKey' ? 'name' : key === 'goalKey' ? 'goal' : 'why'
      if (tour[key] !== `productTour.${tour.slug}.${suffix}`) error(`${path}.${key}`, 'incorrect copy namespace')
    }
    identifiers(tour.requires, CapabilityIdValues, `${path}.requires`)
    identifiers(tour.entryTriggers, TriggerIdValues, `${path}.entryTriggers`)
    if (!Array.isArray(tour.entryTriggers) || !tour.entryTriggers.includes('learning-manual-start')) error(`${path}.entryTriggers`, 'manual start must remain available')
    if (!Array.isArray(tour.evidence) || !tour.evidence.length || tour.evidence.some(id => typeof id !== 'string' || !/^E\d+$/.test(id))) error(`${path}.evidence`, 'expected evidence references')
    if (!['P0', 'P1', 'P2'].includes(tour.priority as string)) error(`${path}.priority`, 'unknown priority')
    if (!Array.isArray(tour.steps) || !tour.steps.length) { error(`${path}.steps`, 'expected ordered steps'); continue }
    for (const [stepIndex, step] of tour.steps.entries()) {
      const sp = `${path}.steps[${stepIndex}]`
      if (!record(step)) { error(sp, 'expected step record'); continue }
      fields(step, stepFields, sp)
      member(step.id, StepIdValues, `${sp}.id`); unique(step.id, stepIds, `${sp}.id`)
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
      unique(step.testId, testIds, `${sp}.testId`)
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
        if (verifiedSignals.has(policy.signal as string) && policy.evidence !== 'verified') error(`${sp}.completion.evidence`, 'native outcome requires verified evidence')
      } else error(`${sp}.completion.kind`, 'unknown completion kind')
      if (!['after-activation', 'allow-current-state', 'same-attempt'].includes(policy.priorState as string)) error(`${sp}.completion.priorState`, 'unknown prior-state policy')
      if (typeof policy.requireAcknowledgementAfterEvidence !== 'boolean') error(`${sp}.completion`, 'acknowledgement flag must be boolean')
    }
  }
  if (stepIds.size !== 56) error('catalogue', 'expected all 56 unique steps')
  for (const id of TourIdValues) if (!tourIds.has(id)) error('catalogue', `missing tour ${id}`)
  for (const id of StepIdValues) if (!stepIds.has(id)) error('catalogue', `missing step ${id}`)
  return errors
}
