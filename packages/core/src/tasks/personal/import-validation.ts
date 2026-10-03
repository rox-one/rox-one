/** Current bundle row validation, adapted from Golden's consumed task import guard. */
type Row = Record<string, unknown>
const row = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string'
const named = (value: unknown): value is string => text(value) && value.trim().length > 0
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const optional = (value: unknown, check: (value: unknown) => boolean) => value == null || check(value)
const oneOf = (value: unknown, values: readonly string[]) => text(value) && values.includes(value)
const strings = (value: unknown) => Array.isArray(value) && value.every(text)
const optionalFields = (value: Row, keys: readonly string[], check: (value: unknown) => boolean) => keys.every(key => optional(value[key], check))

function link(value: unknown): boolean {
  return row(value) && named(value.id)
    && oneOf(value.kind, ['note', 'session', 'message', 'workflowRun', 'meeting', 'feed', 'mail', 'decision'])
    && optional(value.label, text)
}
function recurrence(value: unknown): boolean {
  return row(value) && oneOf(value.rule, ['daily', 'weekly', 'monthly', 'yearly'])
    && number(value.interval) && Number.isSafeInteger(value.interval) && value.interval > 0
    && optional(value.weekdays, weekdays => Array.isArray(weekdays) && weekdays.every(day => number(day) && Number.isInteger(day) && day >= 0 && day <= 6))
    && optional(value.mode, mode => oneOf(mode, ['fixed', 'after']))
    && optional(value.until, number) && optional(value.timeZone, text)
}
function checklist(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => row(item) && named(item.id) && text(item.title) && typeof item.done === 'boolean')
    && new Set(value.map(item => item.id)).size === value.length
}
function task(value: unknown): boolean {
  return row(value) && named(value.id) && named(value.title) && text(value.notes)
    && strings(value.tags) && Array.isArray(value.links) && value.links.every(link)
    && oneOf(value.list, ['inbox', 'today', 'upcoming', 'anytime', 'someday'])
    && oneOf(value.priority, ['none', 'low', 'medium', 'high']) && typeof value.evening === 'boolean'
    && number(value.order) && number(value.createdAt)
    && optionalFields(value, ['dueAt', 'startAt', 'completedAt', 'cancelledAt', 'reminderAt', 'reminderDeliveredFor', 'reminderRetryAt', 'trashedAt', 'repeatOccurrenceAt', 'updatedAt'], number)
    && optionalFields(value, ['projectId', 'areaId', 'headingId', 'parentId', 'repeatOf', 'repeatNextId', 'reminderTimeZone'], text)
    && optional(value.recurrence, recurrence) && optional(value.checklist, checklist) && optional(value.source, link)
    && optional(value.reminderError, error => oneOf(error, ['permission-denied', 'permission-required', 'presentation-failed']))
}
function project(value: unknown): boolean {
  return row(value) && named(value.id) && text(value.name) && number(value.order)
    && optionalFields(value, ['areaId', 'notes'], text)
    && optionalFields(value, ['deadlineAt', 'completedAt', 'trashedAt', 'createdAt'], number)
}
function area(value: unknown): boolean {
  return row(value) && named(value.id) && text(value.name) && number(value.order)
    && optional(value.collapsed, v => typeof v === 'boolean') && optional(value.trashedAt, number)
}
function heading(value: unknown): boolean {
  return row(value) && named(value.id) && text(value.title) && text(value.projectId) && number(value.order)
}
function audit(value: unknown): boolean {
  return row(value) && number(value.at) && text(value.action) && optionalFields(value, ['taskId', 'detail'], text)
}
function rows(value: unknown, check: (value: unknown) => boolean, unique: boolean): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value) || !value.every(check)) return false
  return !unique || new Set(value.map(item => item.id)).size === value.length
}
/** Preserve existing v1/missing-list compatibility and unknown fields, reject unusable rows. */
export function personalTaskBundleRowsAreValid(value: Row): boolean {
  return rows(value.tasks, task, true) && rows(value.projects, project, true) && rows(value.areas, area, true)
    && rows(value.headings, heading, true) && rows(value.audit, audit, false)
}
