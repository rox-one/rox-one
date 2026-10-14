/**
 * Self-contained task timeline for pages outside Задачи (project, workspace):
 * owns zoom/grouping UI state and renders the shared TaskTimeline.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { PersonalTask } from '@rox/core/tasks/personal'
import type { GanttZoom } from '@/components/gantt/gantt-engine'
import { TaskTimeline } from './TaskTimeline'
import { isoOf, type SchedulePatch, type TimelineGroup, type TimelineGroupBy } from './timeline-model'

export interface TimelinePanelProps {
  tasks: readonly PersonalTask[]
  onSchedule: (id: string, patch: SchedulePatch) => void
  groupTitle: (group: TimelineGroup) => string
  onSelect?: (id: string) => void
  selectedId?: string | null
  defaultGroupBy?: TimelineGroupBy
  testId?: string
}

export function TimelinePanel({ tasks, onSchedule, groupTitle, onSelect, selectedId = null, defaultGroupBy = 'none', testId }: TimelinePanelProps) {
  const { i18n } = useTranslation()
  const [zoom, setZoom] = React.useState<Exclude<GanttZoom, 'fit'>>('week')
  const [groupBy, setGroupBy] = React.useState<TimelineGroupBy>(defaultGroupBy)
  const [selected, setSelected] = React.useState<string | null>(selectedId)
  React.useEffect(() => setSelected(selectedId), [selectedId])
  return (
    <div className="h-[28rem] min-h-0" data-testid={testId}>
      <TaskTimeline
        tasks={tasks}
        today={isoOf(Date.now())}
        locale={i18n.language}
        selectedId={selected}
        zoom={zoom}
        groupBy={groupBy}
        onZoom={setZoom}
        onGroupBy={setGroupBy}
        onSelect={(id) => { setSelected(id); onSelect?.(id) }}
        onSchedule={onSchedule}
        groupTitle={groupTitle}
      />
    </div>
  )
}
