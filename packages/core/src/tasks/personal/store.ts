import { parseQuickEntry, startOfLocalDay } from './dates.ts'
import { nextRepeatDate } from './quick-entry.ts'
import {
  emptyBundle,
  isOpenTask,
  PERSONAL_TASK_BUNDLE_VERSION,
  type ChecklistItem,
  type PersonalTask,
  type PersonalTaskBundle,
  type TaskArea,
  type TaskHeading,
  type TaskProject,
  type TaskLink,
  type TaskListId,
  type TaskPriority,
} from './types.ts'

export type PersonalTaskParseResult =
  | { status: 'ok'; store: PersonalTaskStore }
  | { status: 'quarantine'; reason: 'invalid-json' | 'invalid-shape' | 'unsupported-version'; preserved: string }

let seq = 0
function mint(prefix: string): string {
  seq += 1
  return `${prefix}-${seq.toString(16)}`
}

export function resetPersonalTaskIds(): void {
  seq = 0
}

export interface CreateTaskInput {
  title: string
  notes?: string
  list?: TaskListId
  projectId?: string
  areaId?: string
  headingId?: string
  parentId?: string
  tags?: string[]
  priority?: TaskPriority
  dueAt?: number
  startAt?: number
  evening?: boolean
  recurrence?: PersonalTask['recurrence']
  links?: TaskLink[]
  now?: number
  quickEntry?: boolean
  checklist?: ChecklistItem[]
  reminderAt?: number
  source?: TaskLink
  /** Insert right after this task in its list order (magic plus / inline new row). */
  afterId?: string
}

/** Things «Когда»: where a task lives in time. */
export type TaskWhen =
  | { kind: 'inbox' }
  | { kind: 'today' }
  | { kind: 'evening' }
  | { kind: 'anytime' }
  | { kind: 'someday' }
  | { kind: 'date'; at: number; evening?: boolean }

/** Move target for ⌘K / drag & drop. Omitted keys stay as they are. */
export interface TaskMoveTarget {
  list?: TaskListId
  projectId?: string | null
  areaId?: string | null
  headingId?: string | null
}

export class PersonalTaskStore {
  private bundle: PersonalTaskBundle

  constructor(bundle: PersonalTaskBundle = emptyBundle()) {
    this.bundle = structuredClone(bundle)
    this.bundle.version = 1
  }

  snapshot(): PersonalTaskBundle {
    return structuredClone(this.bundle)
  }

  exportJson(): string {
    return JSON.stringify(this.snapshot(), null, 2)
  }

  static tryFromJson(raw: string): PersonalTaskParseResult {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { status: 'quarantine', reason: 'invalid-json', preserved: raw }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 'quarantine', reason: 'invalid-shape', preserved: raw }
    }
    const record = parsed as Record<string, unknown>
    const version = record.version
    if (version === undefined) {
      if (!Array.isArray(record.tasks)) {
        return { status: 'quarantine', reason: 'invalid-shape', preserved: raw }
      }
    } else if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return { status: 'quarantine', reason: 'invalid-shape', preserved: raw }
    } else if (version > PERSONAL_TASK_BUNDLE_VERSION) {
      return { status: 'quarantine', reason: 'unsupported-version', preserved: raw }
    }
    for (const key of ['tasks', 'projects', 'areas', 'headings', 'audit'] as const) {
      if (record[key] !== undefined && !Array.isArray(record[key])) {
        return { status: 'quarantine', reason: 'invalid-shape', preserved: raw }
      }
    }
    return {
      status: 'ok',
      store: new PersonalTaskStore({
        version: 1,
        tasks: Array.isArray(record.tasks) ? (record.tasks as PersonalTaskBundle['tasks']) : [],
        projects: Array.isArray(record.projects) ? (record.projects as PersonalTaskBundle['projects']) : [],
        areas: Array.isArray(record.areas) ? (record.areas as PersonalTaskBundle['areas']) : [],
        headings: Array.isArray(record.headings) ? (record.headings as PersonalTaskBundle['headings']) : [],
        audit: Array.isArray(record.audit) ? (record.audit as PersonalTaskBundle['audit']) : [],
      }),
    }
  }

  static fromJson(raw: string): PersonalTaskStore {
    const parsed = PersonalTaskStore.tryFromJson(raw)
    if (parsed.status !== 'ok') {
      throw new Error(`personal-task bundle ${parsed.reason}`)
    }
    return parsed.store
  }

  importBundle(incoming: PersonalTaskBundle, mode: 'merge' | 'replace'): void {
    if (mode === 'replace') {
      this.bundle = structuredClone(incoming)
      this.audit('import.replace')
      return
    }
    const seen = new Set(this.bundle.tasks.map((task) => task.id))
    for (const task of incoming.tasks) {
      if (seen.has(task.id)) continue
      this.bundle.tasks.push(structuredClone(task))
    }
    this.audit('import.merge')
  }

  list(): PersonalTask[] {
    return [...this.bundle.tasks]
  }

  get(id: string): PersonalTask | undefined {
    return this.bundle.tasks.find((task) => task.id === id)
  }

  create(input: CreateTaskInput): PersonalTask {
    const now = input.now ?? Date.now()
    let title = input.title.trim()
    let list = input.list ?? 'inbox'
    let dueAt = input.dueAt
    let startAt = input.startAt
    let evening = input.evening ?? false
    if (input.quickEntry) {
      const parsed = parseQuickEntry(title, now)
      title = parsed.title
      if (parsed.parsed) {
        dueAt = parsed.parsed.dueAt ?? dueAt
        startAt = parsed.parsed.startAt ?? startAt
        evening = parsed.parsed.evening || evening
        if (parsed.parsed.list) list = parsed.parsed.list
      }
    }
    if (!title) throw new Error('Task title is required')
    const task: PersonalTask = {
      id: this.uniqueId('task'),
      title,
      notes: input.notes ?? '',
      list,
      projectId: input.projectId,
      areaId: input.areaId,
      headingId: input.headingId,
      parentId: input.parentId,
      tags: input.tags ?? [],
      priority: input.priority ?? 'none',
      dueAt,
      startAt,
      evening,
      recurrence: input.recurrence,
      links: input.links ?? [],
      order: this.nextOrder(list),
      createdAt: now,
      ...(input.checklist?.length ? { checklist: input.checklist } : {}),
      ...(input.reminderAt != null ? { reminderAt: input.reminderAt } : {}),
      ...(input.source ? { source: input.source } : {}),
    }
    if (input.source && !task.links.some((l) => l.kind === input.source!.kind && l.id === input.source!.id)) {
      task.links.push({ ...input.source })
    }
    this.bundle.tasks.push(task)
    if (input.afterId) this.placeAfter(task.id, input.afterId)
    this.audit('create', task.id, title)
    return task
  }

  update(id: string, patch: Partial<Omit<PersonalTask, 'id' | 'createdAt'>>): PersonalTask {
    const task = this.require(id)
    Object.assign(task, patch)
    for (const key of Object.keys(patch) as Array<keyof PersonalTask>) {
      if (patch[key as keyof typeof patch] === undefined) delete (task as unknown as Record<string, unknown>)[key]
    }
    this.audit('update', id)
    return task
  }

  complete(id: string, now = Date.now()): PersonalTask {
    const task = this.require(id)
    task.completedAt = now
    task.cancelledAt = undefined
    this.audit('complete', id)
    return task
  }

  reopen(id: string): PersonalTask {
    const task = this.require(id)
    task.completedAt = undefined
    task.cancelledAt = undefined
    this.audit('reopen', id)
    return task
  }

  cancel(id: string, now = Date.now()): PersonalTask {
    const task = this.require(id)
    task.cancelledAt = now
    this.audit('cancel', id)
    return task
  }

  move(id: string, list: TaskListId): PersonalTask {
    const task = this.require(id)
    task.list = list
    task.order = this.nextOrder(list)
    this.audit('move', id, list)
    return task
  }

  reorder(ids: string[]): void {
    ids.forEach((id, index) => {
      const task = this.bundle.tasks.find((item) => item.id === id)
      if (task) task.order = index
    })
    this.audit('reorder')
  }

  link(id: string, link: TaskLink): PersonalTask {
    const task = this.require(id)
    if (!task.links.some((item) => item.kind === link.kind && item.id === link.id)) {
      task.links.push(link)
    }
    this.audit('link', id, `${link.kind}:${link.id}`)
    return task
  }

  unlink(id: string, link: TaskLink): PersonalTask {
    const task = this.require(id)
    task.links = task.links.filter((item) => !(item.kind === link.kind && item.id === link.id))
    this.audit('unlink', id, `${link.kind}:${link.id}`)
    return task
  }

  addProject(name: string, areaId?: string): TaskProject {
    const project: TaskProject = { id: this.uniqueMetaId('proj'), name, areaId, order: this.bundle.projects.length, createdAt: Date.now() }
    this.bundle.projects.push(project)
    this.audit('project.add', undefined, name)
    return project
  }

  addArea(name: string): TaskArea {
    const area: TaskArea = { id: this.uniqueMetaId('area'), name, order: this.bundle.areas.length }
    this.bundle.areas.push(area)
    this.audit('area.add', undefined, name)
    return area
  }

  addHeading(title: string, projectId: string): TaskHeading {
    const heading: TaskHeading = {
      id: this.uniqueMetaId('head'),
      title,
      projectId,
      order: this.bundle.headings.filter((h) => h.projectId === projectId).length,
    }
    this.bundle.headings.push(heading)
    this.audit('heading.add', undefined, title)
    return heading
  }

  // ── Things-style operations (additive; the v1 API above is unchanged) ──

  projects(): TaskProject[] {
    return [...this.bundle.projects].sort((a, b) => a.order - b.order)
  }

  areas(): TaskArea[] {
    return [...this.bundle.areas].sort((a, b) => a.order - b.order)
  }

  headings(projectId?: string): TaskHeading[] {
    return this.bundle.headings.filter((h) => !projectId || h.projectId === projectId).sort((a, b) => a.order - b.order)
  }

  updateProject(id: string, patch: Partial<Omit<TaskProject, 'id'>>): TaskProject {
    const project = this.bundle.projects.find((p) => p.id === id)
    if (!project) throw new Error(`Unknown project ${id}`)
    Object.assign(project, patch)
    this.audit('project.update', undefined, id)
    return project
  }

  updateArea(id: string, patch: Partial<Omit<TaskArea, 'id'>>): TaskArea {
    const area = this.bundle.areas.find((a) => a.id === id)
    if (!area) throw new Error(`Unknown area ${id}`)
    Object.assign(area, patch)
    this.audit('area.update', undefined, id)
    return area
  }

  updateHeading(id: string, patch: Partial<Omit<TaskHeading, 'id'>>): TaskHeading {
    const heading = this.bundle.headings.find((h) => h.id === id)
    if (!heading) throw new Error(`Unknown heading ${id}`)
    Object.assign(heading, patch)
    this.audit('heading.update', undefined, id)
    return heading
  }

  /** Remove a heading; its tasks stay in the project without a heading. */
  removeHeading(id: string): void {
    this.bundle.headings = this.bundle.headings.filter((h) => h.id !== id)
    for (const task of this.bundle.tasks) if (task.headingId === id) task.headingId = undefined
    this.audit('heading.remove', undefined, id)
  }

  /** Remove an area; projects and tasks in it are kept (area cleared). */
  removeArea(id: string): void {
    this.bundle.areas = this.bundle.areas.filter((a) => a.id !== id)
    for (const project of this.bundle.projects) if (project.areaId === id) project.areaId = undefined
    for (const task of this.bundle.tasks) if (task.areaId === id) task.areaId = undefined
    this.audit('area.remove', undefined, id)
  }

  /** Move a project to Корзина together with its open tasks (restorable). */
  trashProject(id: string, now = Date.now()): void {
    const project = this.bundle.projects.find((p) => p.id === id)
    if (!project) return
    project.trashedAt = now
    for (const task of this.bundle.tasks) if (task.projectId === id && task.trashedAt == null) task.trashedAt = now
    this.audit('project.trash', undefined, id)
  }

  restoreProject(id: string): void {
    const project = this.bundle.projects.find((p) => p.id === id)
    if (!project) return
    const at = project.trashedAt
    project.trashedAt = undefined
    for (const task of this.bundle.tasks) if (task.projectId === id && at != null && task.trashedAt === at) task.trashedAt = undefined
    this.audit('project.restore', undefined, id)
  }

  /** Complete a project: remaining open tasks are marked done too (Things behaviour). */
  completeProject(id: string, now = Date.now()): void {
    const project = this.bundle.projects.find((p) => p.id === id)
    if (!project) return
    project.completedAt = now
    for (const task of this.bundle.tasks) {
      if (task.projectId === id && isOpenTask(task)) task.completedAt = now
    }
    this.audit('project.complete', undefined, id)
  }

  reopenProject(id: string): void {
    const project = this.bundle.projects.find((p) => p.id === id)
    if (!project) return
    project.completedAt = undefined
    this.audit('project.reopen', undefined, id)
  }

  reorderProjects(ids: string[]): void {
    ids.forEach((id, index) => {
      const project = this.bundle.projects.find((p) => p.id === id)
      if (project) project.order = index
    })
    this.audit('project.reorder')
  }

  /** Move a task (and its subtasks) to Корзина. Restorable until emptyTrash(). */
  trash(id: string, now = Date.now()): PersonalTask {
    const task = this.require(id)
    task.trashedAt = now
    for (const child of this.bundle.tasks) if (child.parentId === id && child.trashedAt == null) child.trashedAt = now
    this.audit('trash', id)
    return task
  }

  restore(id: string): PersonalTask {
    const task = this.require(id)
    const at = task.trashedAt
    task.trashedAt = undefined
    for (const child of this.bundle.tasks) if (child.parentId === id && at != null && child.trashedAt === at) child.trashedAt = undefined
    if (task.projectId) {
      const project = this.bundle.projects.find((p) => p.id === task.projectId)
      if (project?.trashedAt != null) project.trashedAt = undefined
    }
    this.audit('restore', id)
    return task
  }

  /** Permanently delete everything in Корзина. Returns removed task ids. */
  emptyTrash(): string[] {
    const removed = this.bundle.tasks.filter((task) => task.trashedAt != null).map((task) => task.id)
    const ids = new Set(removed)
    this.bundle.tasks = this.bundle.tasks.filter((task) => !ids.has(task.id))
    const trashedProjects = new Set(this.bundle.projects.filter((p) => p.trashedAt != null).map((p) => p.id))
    this.bundle.projects = this.bundle.projects.filter((p) => p.trashedAt == null)
    this.bundle.headings = this.bundle.headings.filter((h) => !trashedProjects.has(h.projectId))
    this.audit('trash.empty', undefined, String(removed.length))
    return removed
  }

  /**
   * Complete and, when the task repeats, spawn the next occurrence (a fresh
   * task with the same title/notes/checklist reset, scheduled on the next
   * date). Returns the completed task and the new one, if any.
   */
  completeTask(id: string, now = Date.now()): { task: PersonalTask; next: PersonalTask | null } {
    const task = this.complete(id, now)
    if (!task.recurrence) return { task, next: null }
    const anchor = task.startAt ?? task.dueAt ?? now
    const nextAt = nextRepeatDate(task.recurrence, anchor, now)
    if (nextAt == null) return { task, next: null }
    const deadlineShift = task.dueAt != null && task.startAt != null ? task.dueAt - startOfLocalDay(task.startAt) : null
    const next = this.create({
      title: task.title,
      notes: task.notes,
      list: 'upcoming',
      projectId: task.projectId,
      areaId: task.areaId,
      headingId: task.headingId,
      tags: [...task.tags],
      priority: task.priority,
      startAt: nextAt,
      dueAt: deadlineShift != null ? nextAt + deadlineShift : task.dueAt != null && task.startAt == null ? nextAt : undefined,
      evening: task.evening,
      recurrence: task.recurrence,
      links: task.links.map((l) => ({ ...l })),
      checklist: (task.checklist ?? []).map((item) => ({ ...item, id: this.uniqueChecklistId(), done: false })),
      reminderAt: task.reminderAt != null ? nextAt + (task.reminderAt - startOfLocalDay(task.reminderAt)) : undefined,
      source: task.source,
      now,
    })
    next.repeatOf = task.repeatOf ?? task.id
    // The finished occurrence stops repeating; the rule lives on the new one.
    task.recurrence = undefined
    return { task, next }
  }

  /** Set «Когда». */
  setWhen(id: string, when: TaskWhen): PersonalTask {
    const task = this.require(id)
    switch (when.kind) {
      case 'inbox':
        Object.assign(task, { list: 'inbox', startAt: undefined, evening: false })
        break
      case 'today':
        Object.assign(task, { list: 'today', startAt: undefined, evening: false })
        break
      case 'evening':
        Object.assign(task, { list: 'today', startAt: undefined, evening: true })
        break
      case 'anytime':
        Object.assign(task, { list: 'anytime', startAt: undefined, evening: false })
        break
      case 'someday':
        Object.assign(task, { list: 'someday', startAt: undefined, evening: false })
        break
      case 'date': {
        const at = startOfLocalDay(when.at)
        const isToday = at === startOfLocalDay(Date.now())
        Object.assign(task, isToday
          ? { list: 'today', startAt: undefined, evening: Boolean(when.evening) }
          : { list: 'upcoming', startAt: at, evening: Boolean(when.evening) })
        break
      }
    }
    task.order = this.nextOrder(task.list)
    this.audit('when', id, when.kind)
    return task
  }

  setDeadline(id: string, at: number | undefined): PersonalTask {
    const task = this.require(id)
    task.dueAt = at == null ? undefined : startOfLocalDay(at)
    this.audit('deadline', id, at == null ? 'clear' : String(task.dueAt))
    return task
  }

  /** ⌘K / drag target: list, project, area, heading. */
  moveTo(id: string, target: TaskMoveTarget): PersonalTask {
    const task = this.require(id)
    if (target.list) {
      task.list = target.list
      if (target.list !== 'upcoming') task.startAt = undefined
      if (target.list !== 'today') task.evening = false
    }
    if (target.projectId !== undefined) {
      task.projectId = target.projectId ?? undefined
      if (target.projectId) {
        task.areaId = undefined
        if (task.list === 'inbox') task.list = 'anytime'
      }
      if (target.headingId === undefined) task.headingId = undefined
    }
    if (target.areaId !== undefined) {
      task.areaId = target.areaId ?? undefined
      if (target.areaId) {
        task.projectId = undefined
        task.headingId = undefined
        if (task.list === 'inbox') task.list = 'anytime'
      }
    }
    if (target.headingId !== undefined) task.headingId = target.headingId ?? undefined
    task.order = this.nextOrder(task.list)
    for (const child of this.bundle.tasks) {
      if (child.parentId !== id) continue
      child.projectId = task.projectId
      child.areaId = task.areaId
      child.headingId = task.headingId
    }
    this.audit('move', id, JSON.stringify(target))
    return task
  }

  /** Place `id` right after `afterId` (same order space), shifting the rest. */
  placeAfter(id: string, afterId: string): void {
    const task = this.get(id)
    const anchor = this.get(afterId)
    if (!task || !anchor || task.id === anchor.id) return
    const peers = this.bundle.tasks
      .filter((t) => t.id !== id)
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
    const at = peers.findIndex((t) => t.id === afterId)
    peers.splice(at + 1, 0, task)
    peers.forEach((t, index) => { t.order = index })
  }

  duplicate(id: string, now = Date.now()): PersonalTask {
    const source = this.require(id)
    const copy = this.create({
      title: source.title,
      notes: source.notes,
      list: source.list,
      projectId: source.projectId,
      areaId: source.areaId,
      headingId: source.headingId,
      tags: [...source.tags],
      priority: source.priority,
      dueAt: source.dueAt,
      startAt: source.startAt,
      evening: source.evening,
      recurrence: source.recurrence,
      links: source.links.map((l) => ({ ...l })),
      checklist: (source.checklist ?? []).map((item) => ({ ...item, id: this.uniqueChecklistId() })),
      afterId: source.id,
      now,
    })
    return copy
  }

  addChecklistItem(id: string, title: string): ChecklistItem {
    const task = this.require(id)
    const item: ChecklistItem = { id: this.uniqueChecklistId(), title: title.trim(), done: false }
    task.checklist = [...(task.checklist ?? []), item]
    this.audit('checklist.add', id, item.title)
    return item
  }

  updateChecklistItem(id: string, itemId: string, patch: Partial<Omit<ChecklistItem, 'id'>>): void {
    const task = this.require(id)
    task.checklist = (task.checklist ?? []).map((item) => (item.id === itemId ? { ...item, ...patch } : item))
    this.audit('checklist.update', id, itemId)
  }

  removeChecklistItem(id: string, itemId: string): void {
    const task = this.require(id)
    task.checklist = (task.checklist ?? []).filter((item) => item.id !== itemId)
    this.audit('checklist.remove', id, itemId)
  }

  reorderChecklist(id: string, itemIds: string[]): void {
    const task = this.require(id)
    const byId = new Map((task.checklist ?? []).map((item) => [item.id, item]))
    const next = itemIds.map((itemId) => byId.get(itemId)).filter((item): item is ChecklistItem => Boolean(item))
    for (const item of task.checklist ?? []) if (!itemIds.includes(item.id)) next.push(item)
    task.checklist = next
    this.audit('checklist.reorder', id)
  }

  private uniqueChecklistId(): string {
    return `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  /** Project/area/heading ids: the per-process counter restarts, so check every collection. */
  private uniqueMetaId(prefix: string): string {
    const taken = new Set([
      ...this.bundle.projects.map((p) => p.id),
      ...this.bundle.areas.map((a) => a.id),
      ...this.bundle.headings.map((h) => h.id),
    ])
    let id = mint(prefix)
    while (taken.has(id)) id = mint(prefix)
    return id
  }

  addSubtask(parentId: string, title: string, now = Date.now()): PersonalTask {
    const parent = this.require(parentId)
    return this.create({
      title,
      parentId,
      list: parent.list,
      projectId: parent.projectId,
      areaId: parent.areaId,
      headingId: parent.headingId,
      now,
    })
  }

  openTasks(): PersonalTask[] {
    return this.bundle.tasks.filter(isOpenTask)
  }

  auditLog() {
    return [...this.bundle.audit]
  }

  /**
   * The mint counter restarts per process, so a reloaded store would hand out
   * `task-1` again. Skip ids already in the bundle — with one file per task
   * on disk, a duplicate id would overwrite an existing task.
   */
  private uniqueId(prefix: string): string {
    const taken = new Set(this.bundle.tasks.map((task) => task.id))
    let id = mint(prefix)
    while (taken.has(id)) id = mint(prefix)
    return id
  }

  /** Remove tasks (and their subtasks) from the bundle. */
  remove(id: string): string[] {
    const ids = new Set([id])
    let grew = true
    while (grew) {
      grew = false
      for (const task of this.bundle.tasks) {
        if (task.parentId && ids.has(task.parentId) && !ids.has(task.id)) {
          ids.add(task.id)
          grew = true
        }
      }
    }
    this.bundle.tasks = this.bundle.tasks.filter((task) => !ids.has(task.id))
    this.audit('delete', id)
    return [...ids]
  }

  private nextOrder(list: TaskListId): number {
    const max = this.bundle.tasks.filter((task) => task.list === list).reduce((acc, task) => Math.max(acc, task.order), -1)
    return max + 1
  }

  private require(id: string): PersonalTask {
    const task = this.get(id)
    if (!task) throw new Error(`Unknown task ${id}`)
    return task
  }

  private audit(action: string, taskId?: string, detail?: string): void {
    this.bundle.audit.push({ at: Date.now(), action, taskId, detail })
  }
}
