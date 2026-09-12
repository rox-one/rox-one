import { parseQuickEntry } from './dates.ts'
import { emptyBundle, isOpenTask, type PersonalTask, type PersonalTaskBundle, type TaskLink, type TaskListId, type TaskPriority } from './types.ts'

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

  static fromJson(raw: string): PersonalTaskStore {
    const parsed = JSON.parse(raw) as Partial<PersonalTaskBundle>
    return new PersonalTaskStore({
      version: 1,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      areas: Array.isArray(parsed.areas) ? parsed.areas : [],
      headings: Array.isArray(parsed.headings) ? parsed.headings : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
    })
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
      id: mint('task'),
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
    }
    this.bundle.tasks.push(task)
    this.audit('create', task.id, title)
    return task
  }

  update(id: string, patch: Partial<Omit<PersonalTask, 'id' | 'createdAt'>>): PersonalTask {
    const task = this.require(id)
    Object.assign(task, patch)
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

  addProject(name: string, areaId?: string) {
    const project = { id: mint('proj'), name, areaId, order: this.bundle.projects.length }
    this.bundle.projects.push(project)
    this.audit('project.add', undefined, name)
    return project
  }

  addArea(name: string) {
    const area = { id: mint('area'), name, order: this.bundle.areas.length }
    this.bundle.areas.push(area)
    this.audit('area.add', undefined, name)
    return area
  }

  addHeading(title: string, projectId: string) {
    const heading = { id: mint('head'), title, projectId, order: this.bundle.headings.length }
    this.bundle.headings.push(heading)
    this.audit('heading.add', undefined, title)
    return heading
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
