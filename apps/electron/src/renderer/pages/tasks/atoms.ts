import { atomWithStorage } from 'jotai/utils'
import type { TasksView } from './task-model'

/** Selected navigator entry of the Задачи screen (UI state only). */
export const tasksViewAtom = atomWithStorage<TasksView>('rox.tasks.view.v1', { kind: 'list', id: 'today' }, undefined, { getOnInit: true })
