import { atomWithStorage } from 'jotai/utils'
import type { TasksView } from './task-model'

/** Selected navigator entry of the Задачи screen (UI state only). */
export const tasksViewAtom = atomWithStorage<TasksView>('rox.tasks.view.v1', { kind: 'list', id: 'today' }, undefined, { getOnInit: true })

/** Задачи list layout: Things list or the task timeline (UI state only). */
export const tasksLayoutAtom = atomWithStorage<'list' | 'timeline'>('rox.tasks.layout.v1', 'list', undefined, { getOnInit: true })
export const tasksTimelineZoomAtom = atomWithStorage<'day' | 'week' | 'month' | 'quarter'>('rox.tasks.timeline.zoom.v1', 'week', undefined, { getOnInit: true })
export const tasksTimelineGroupAtom = atomWithStorage<'none' | 'project' | 'area' | 'list'>('rox.tasks.timeline.group.v1', 'none', undefined, { getOnInit: true })
export const tasksTimelineWeekAtom = atomWithStorage<boolean>('rox.tasks.timeline.week.v1', false, undefined, { getOnInit: true })
