import * as React from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Database, FileSearch, Scale, Sparkles, Trophy, type LucideIcon } from 'lucide-react'
import { LEARNING_NODE_REGISTRY, type LearningMapNode, type LearningNodeKind } from '../learning-nodes'
import { kindLabel } from './node-content'

export interface LearningNodeData extends Record<string, unknown> { learning: LearningMapNode }
export type LearningFlowNode = Node<LearningNodeData, 'learning'>

/** Same icons the runtime card uses for the five learning kinds (PRD §30). */
const icons: Record<LearningNodeKind, LucideIcon> = { memory: Database, skill: Sparkles, policy: Scale, evidence: FileSearch, outcome: Trophy }

/**
 * Card for a PRD §30 learning chain node. Learning nodes have no `RuntimeEvent`,
 * so this card renders the derived view model only — it never touches
 * `node.event` and never offers selection (there is no runtime inspector for it).
 */
export const LearningNodeCard = React.memo(function LearningNodeCard({ data, selected }: NodeProps<LearningFlowNode>) {
  const { t } = useTranslation()
  const node = data.learning
  const Icon = icons[node.kind]
  const sourceId = node.provenance.candidateId ?? node.provenance.evidenceId ?? node.provenance.outcomeId
  return <article className={`runtime-node runtime-node-${node.kind} runtime-learning-node`} data-learning-kind={node.kind} data-learning-role={node.role} data-selected={selected} data-testid="runtime-learning-node" data-runtime-id={node.id} title={LEARNING_NODE_REGISTRY[node.kind].description}>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <header><span className="runtime-node-icon"><Icon size={15} /></span><strong>{node.label}</strong><span className="runtime-learning-kind">{kindLabel(node.kind, t)}</span></header>
    <div className="runtime-node-detail"><p>{node.subtitle || LEARNING_NODE_REGISTRY[node.kind].description}</p></div>
    <footer><span>{node.role}</span><span>{sourceId || t('runtimeMap.unknown')}</span></footer>
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </article>
}, (previous, next) => previous.data.learning === next.data.learning && previous.selected === next.selected)