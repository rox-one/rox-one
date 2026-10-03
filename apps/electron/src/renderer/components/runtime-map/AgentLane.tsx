import * as React from 'react'
import { type Node, type NodeProps } from '@xyflow/react'
import { Bot, ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RuntimeAgentLane } from '@rox/core/runtime-trace'
import { safePreview } from './measurements'

export interface AgentLaneData extends Record<string, unknown> { lane: RuntimeAgentLane; collapsed: boolean; onToggle: (agentId: string) => void }
export type AgentLaneNode = Node<AgentLaneData, 'lane'>
export const AgentLane = React.memo(function AgentLane({ data }: NodeProps<AgentLaneNode>) {
  const { t } = useTranslation()
  return <div className="runtime-agent-lane" data-depth={data.lane.depth}>
    <button type="button" className="nodrag nopan" aria-expanded={!data.collapsed} onClick={() => data.onToggle(data.lane.agentId)}><Bot size={15} /><strong>{safePreview(data.lane.name, 72) || t('runtimeMap.kind.agent')}</strong>{data.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
    <p>{data.lane.assignment ? safePreview(data.lane.assignment.task.text, 112) : t('runtimeMap.mainAgent')}</p>
    <footer><span>{t('runtimeMap.eventCount', { count: data.lane.nodeIds.length })}</span>{data.lane.parentAgentId && <span>{t('runtimeMap.childAgent')}</span>}</footer>
    {data.lane.orphan && <p className="runtime-warning">{t('runtimeMap.parentMissing')}</p>}
  </div>
})
