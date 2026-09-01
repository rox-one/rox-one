import * as React from 'react'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { PLAYGROUND_VIEWPORT_PRESETS, type PlaygroundViewportPresetId } from '@/playground/registry/types'
import { KanbanBoard } from './KanbanBoard'
import { KANBAN_COLUMNS } from './status-column'
import {
  DEFAULT_EXPANDED_TASK_IDS,
  mockProjectsById,
  mockStatuses,
  mockStatusesById,
  mockTasks,
} from '@/playground/demos/kanban/mock-kanban-data'

function PlannerKanbanScreenStory() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Planner board</h2>
          <p className="text-[11px] text-muted-foreground">Production KanbanBoard with deterministic fixture data.</p>
        </div>
        <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
          Visual CI
        </span>
      </header>
      <KanbanBoard
        columns={KANBAN_COLUMNS}
        tasks={mockTasks}
        projectsById={mockProjectsById}
        statusesById={mockStatusesById}
        statuses={mockStatuses}
        expandedTaskIds={new Set(DEFAULT_EXPANDED_TASK_IDS)}
        treatment="stripe-tint"
        groupByProject
        noProjectLabel="No project"
      />
    </div>
  )
}

const viewportIds: PlaygroundViewportPresetId[] = ['desktop', 'tablet', 'mobile']

export default viewportIds.map((viewportId) => definePlaygroundStory({
  id: `screen-planner-kanban-${viewportId}`,
  name: `Planner Kanban Screen (${PLAYGROUND_VIEWPORT_PRESETS[viewportId].name})`,
  category: 'Planner',
  level: 'Screens',
  description: 'Deterministic Planner/Kanban screen using pure KanbanBoard props with no live container IPC, polling, or mutation.',
  component: PlannerKanbanScreenStory,
  props: [],
  layout: 'full',
  viewport: PLAYGROUND_VIEWPORT_PRESETS[viewportId],
}))
