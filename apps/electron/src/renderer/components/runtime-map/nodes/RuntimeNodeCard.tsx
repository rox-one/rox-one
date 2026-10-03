import * as React from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Bot, Terminal, Wrench, Sparkles, Brain, ListChecks, Database, FileText, CheckCircle2, Circle, Clock3, XCircle, ShieldCheck, GitBranch, Cpu, type LucideIcon } from 'lucide-react'
import type { RuntimeNode } from '@rox/core/runtime-trace'
import { durationText, measurementText } from '../measurements'
import { nodeTitle, nodeSubtitle } from './node-content'

export interface RuntimeNodeData extends Record<string, unknown> { runtime: RuntimeNode }
export type RuntimeFlowNode = Node<RuntimeNodeData, 'runtime'>
const icons: Record<string, LucideIcon> = { run: GitBranch, context: FileText, model: Cpu, plan: ListChecks, task: ListChecks, agent: Bot, skill: Sparkles, tool: Wrench, terminal: Terminal, reasoning: Brain, decision: GitBranch, acceptance: ShieldCheck, memory: Database, artifact: FileText, result: CheckCircle2 }

export const RuntimeNodeCard = React.memo(function RuntimeNodeCard({ data, selected }: NodeProps<RuntimeFlowNode>) {
  const { t } = useTranslation()
  const node = data.runtime
  const Icon = icons[node.kind] || Circle
  const StatusIcon = node.status === 'succeeded' ? CheckCircle2 : node.status === 'failed' || node.status === 'interrupted' ? XCircle : node.status === 'waiting-approval' || node.status === 'queued' || node.status === 'blocked' ? Clock3 : Circle
  const duration = durationText(node.durationMs)
  const tokens = measurementText(nodeContentTokens(node), value => value.toLocaleString())
  return <article className={`runtime-node runtime-node-${node.kind}`} data-status={node.status} data-selected={selected} data-testid="runtime-node" data-runtime-id={node.id}>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <header><span className="runtime-node-icon"><Icon size={15} /></span><strong>{nodeTitle(node, t)}</strong><span className="runtime-status-icon" title={node.status ? t(`runtimeMap.status.${node.status}`) : t('runtimeMap.unknown')}><StatusIcon size={13} /></span></header>
    <div className="runtime-node-detail"><p>{nodeSubtitle(node, t) || t('runtimeMap.contentInInspector')}</p></div>
    <footer><span>{node.status ? t(`runtimeMap.status.${node.status}`) : `#${node.seq}`}</span><span title={node.durationMs.state === 'known' ? node.durationMs.source : t('runtimeMap.unknown')}>{duration || t('runtimeMap.unknown')}</span>{tokens && <span title={t('runtimeMap.contentTokens')}>{t('runtimeMap.tokens', { value: tokens })}</span>}</footer>
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </article>
}, (previous, next) => previous.data.runtime === next.data.runtime && previous.selected === next.selected)

function nodeContentTokens(node: RuntimeNode) { return node.content?.tokens }
