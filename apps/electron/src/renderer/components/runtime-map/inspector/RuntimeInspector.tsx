import * as React from 'react'
import { ArrowLeft, ExternalLink, X, Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CapabilityRef, RuntimeNode, RuntimeContent, RuntimeContextSnapshot, RuntimeToolPayload, RuntimeTerminalPayload, Measurement } from '@rox/core/runtime-trace'
import { contextFill, durationText, measurementText, runtimeNodeDuration, safeDisplayText } from '../measurements'
import { nodeContent, nodeTitle } from '../nodes/node-content'
import { coverageMissingText } from '../coverage-text'
import { ContentViewer, type ReadRuntimePayload, type RuntimeContentScope } from './ContentViewer'

export interface RuntimeInspectorProps {
  node: RuntimeNode
  readPayload?: ReadRuntimePayload
  onClose: () => void
  onOpenMessage?: (messageId: string, toolUseId?: string) => void
  onOpenCapability?: (capability: CapabilityRef) => void
  onSelectEvent?: (eventId: string) => void
}

export function RuntimeInspector({ node, readPayload, onClose, onOpenMessage, onOpenCapability, onSelectEvent }: RuntimeInspectorProps) {
  const { t } = useTranslation()
  const scope = { workspaceId: node.event.workspaceId, sessionId: node.event.rootSessionId, rootRunId: node.event.rootRunId }
  const viewer = (label: string, content?: RuntimeContent) => <ContentViewer key={label} label={label} content={content} scope={scope} readPayload={readPayload} />
  const event = node.event
  const duration = runtimeNodeDuration(node)
  const messageId = node.messageId || event.messageId
  async function copyLink() {
    const query = new URLSearchParams({ workspace: scope.workspaceId, session: scope.sessionId, run: scope.rootRunId, event: node.id })
    try { await navigator.clipboard.writeText(`rox://runtime?${query}`) } catch { /* Clipboard may be restricted by platform. */ }
  }
  return <aside className="runtime-inspector" data-testid="runtime-inspector" aria-label={t('runtimeMap.inspector')}>
    <header className="runtime-inspector-header"><strong>{nodeTitle(node, t)}</strong><button type="button" className="runtime-icon-button" title={t('runtimeMap.closeInspector')} aria-label={t('runtimeMap.closeInspector')} onClick={onClose}><X size={15} /></button></header>
    <div className="runtime-inspector-actions">{(messageId || node.toolUseId) && onOpenMessage && <button type="button" onClick={() => onOpenMessage(messageId ?? '', node.toolUseId)}><ArrowLeft size={13} />{t('runtimeMap.showInChat')}</button>}<button type="button" onClick={copyLink}><Link2 size={13} />{t('runtimeMap.copyEventLink')}</button></div>
    <div className="runtime-inspector-scroll">
      <dl className="runtime-properties"><Property label={t('runtimeMap.eventType')} value={event.kind} /><Property label={t('runtimeMap.agent')} value={node.agentId} /><Property label={t('runtimeMap.sequence')} value={`#${node.seq}${node.endSeq !== node.seq ? `–${node.endSeq}` : ''}`} /><Property label={t('runtimeMap.duration')} value={durationText(duration) || t('runtimeMap.unknown')} title={duration.state === 'known' ? duration.source : undefined} />{node.status && <Property label={t('runtimeMap.state')} value={t(`runtimeMap.status.${node.status}`)} />}{node.attemptId && <Property label={t('runtimeMap.attempt')} value={node.attemptId} />}</dl>
      {(() => {
        switch (event.kind) {
          case 'context.captured': case 'context.changed': return <ContextDetails snapshot={event.payload.snapshot} scope={scope} readPayload={readPayload} onOpenCapability={onOpenCapability} />
          case 'tool.started': case 'tool.output': case 'tool.completed': {
            const payload: RuntimeToolPayload = node.tool ?? node.events.reduce<RuntimeToolPayload>((current, item) => item.kind === 'tool.started' || item.kind === 'tool.output' || item.kind === 'tool.completed' ? { ...current, ...item.payload } : current, { name: event.payload.name })
            return <><dl className="runtime-properties"><Property label={t('runtimeMap.toolName')} value={payload.name} />{payload.error && <Property label={t('runtimeMap.error')} value={payload.error} />}</dl><CapabilityButton capability={payload.capability} onOpen={onOpenCapability} />{viewer(t('runtimeMap.arguments'), payload.input)}{viewer(t('runtimeMap.toolResult'), payload.result || node.content)}{viewer(t('runtimeMap.modelContent'), payload.modelContent)}</>
          }
          case 'terminal.started': case 'terminal.output': case 'terminal.completed': {
            const payload = node.terminal ?? node.events.reduce<RuntimeTerminalPayload>((current, item) => item.kind === 'terminal.started' || item.kind === 'terminal.output' || item.kind === 'terminal.completed' ? { ...current, ...item.payload } : current, { command: event.payload.command })
            return <><p className="runtime-muted">{t('runtimeMap.inertTerminal')}</p>{viewer(t('runtimeMap.command'), { text: payload.command })}<dl className="runtime-properties"><Property label={t('runtimeMap.shell')} value={payload.shell || t('runtimeMap.unknown')} /><Property label={t('runtimeMap.workingDirectory')} value={payload.cwd || t('runtimeMap.unknown')} /><Property label={t('runtimeMap.exitCode')} value={measurementText(payload.exitCode) || t('runtimeMap.unknown')} /></dl>{viewer('stdout', payload.stdout)}{viewer('stderr', payload.stderr)}</>
          }
          case 'agent.assigned': case 'agent.started': case 'agent.completed': {
            const assignment = node.events.find(item => item.kind === 'agent.assigned')
            if (assignment?.kind !== 'agent.assigned') return viewer(t('runtimeMap.returnedResult'), event.kind === 'agent.completed' ? event.payload.result : node.content)
            const assigned = assignment.payload.assignment
            return <><dl className="runtime-properties"><Property label={t('runtimeMap.parentAgent')} value={assigned.parentAgentId || t('runtimeMap.mainAgent')} /><Property label={t('runtimeMap.workerKind')} value={assigned.nativeKind} />{assigned.permissionMode && <Property label={t('runtimeMap.permissions')} value={assigned.permissionMode} />}{assigned.model && <Property label={t('runtimeMap.confirmedModel')} value={measurementText(assigned.model.confirmed) || t('runtimeMap.unknown')} />}</dl>{viewer(t('runtimeMap.assignment'), assigned.task)}{viewer(t('runtimeMap.effectivePrompt'), assigned.prompt)}{viewer(t('runtimeMap.expectedResult'), assigned.expectedResult)}{assigned.tools && viewer(t('runtimeMap.allowedTools'), { text: assigned.tools.join('\n') })}{event.kind === 'agent.completed' && viewer(t('runtimeMap.returnedResult'), event.payload.result)}</>
          }
          case 'plan.published': case 'plan.revised': return <><p className="runtime-muted">{t('runtimeMap.planVersion', { version: event.payload.plan.version, count: event.payload.plan.tasks.length })}</p>{viewer(t('runtimeMap.kind.plan'), event.payload.plan.content)}{event.payload.plan.tasks.map(task => <section key={task.id} className="runtime-task-section"><h4>{safeDisplayText(task.title)}</h4><p className="runtime-muted">{t(`runtimeMap.status.${task.status}`)}</p>{task.description && viewer(t('runtimeMap.description'), task.description)}<Criteria criteria={task.criteria} />{task.dependsOn.length > 0 && <p className="runtime-muted">{t('runtimeMap.dependencies')}: {safeDisplayText(task.dependsOn.join(', '))}</p>}</section>)}</>
          case 'task.state-changed': return <>{viewer(t('runtimeMap.description'), event.payload.task.description)}<Criteria criteria={event.payload.task.criteria} />{event.payload.task.dependsOn.length > 0 && <p className="runtime-muted">{t('runtimeMap.dependencies')}: {safeDisplayText(event.payload.task.dependsOn.join(', '))}</p>}</>
          case 'acceptance.started': case 'acceptance.completed': return <><p className={`runtime-acceptance-${event.payload.acceptance.status}`}>{t(`runtimeMap.acceptance.${event.payload.acceptance.status}`)}</p><p>{safeDisplayText(event.payload.acceptance.criterion)}</p>{event.payload.acceptance.evidence.length ? event.payload.acceptance.evidence.map((item, index) => viewer(`${t('runtimeMap.evidence')} ${index + 1}`, item)) : <p className="runtime-muted">{t('runtimeMap.noEvidence')}</p>}</>
          case 'skill.selected': case 'skill.loaded': case 'skill.applied': return <><p className="runtime-muted">{t(`runtimeMap.skill.${event.kind.split('.')[1]}`)}</p><CapabilityButton capability={event.payload.capability} onOpen={onOpenCapability} />{viewer(t('runtimeMap.skillInstructions'), event.payload.content)}</>
          case 'reasoning.output': return <><p className="runtime-muted">{t(`runtimeMap.provenance.${event.payload.provenance}`)}</p>{viewer(t('runtimeMap.kind.reasoning'), node.content || event.payload.content)}</>
          case 'decision.recorded': return <><p className="runtime-muted">{t(`runtimeMap.provenance.${event.payload.provenance}`)}</p>{viewer(t('runtimeMap.kind.decision'), event.payload.content)}<EvidenceLinks ids={event.payload.evidenceEventIds} onSelect={onSelectEvent} /></>
          case 'artifact.created': return <><dl className="runtime-properties"><Property label={t('runtimeMap.artifactKind')} value={event.payload.artifact.kind || t('runtimeMap.unknown')} />{event.payload.artifact.uri && <Property label={t('runtimeMap.location')} value={event.payload.artifact.uri} />}</dl>{viewer(t('runtimeMap.kind.artifact'), event.payload.artifact.content)}<EvidenceLinks ids={event.payload.artifact.evidenceEventIds} onSelect={onSelectEvent} /></>
          case 'result.published': return <>{viewer(t('runtimeMap.kind.result'), event.payload.content)}<EvidenceLinks ids={event.payload.evidenceEventIds} onSelect={onSelectEvent} /></>
          case 'run.accepted': return <><dl className="runtime-properties"><Property label={t('runtimeMap.launchSource')} value={t(`runtimeMap.launch.${event.payload.launch.kind}`)} />{event.payload.launch.scheduleId && <Property label={t('runtimeMap.schedule')} value={event.payload.launch.scheduleId} />}{event.payload.launch.triggerId && <Property label={t('runtimeMap.trigger')} value={event.payload.launch.triggerId} />}</dl><CapabilityButton capability={event.payload.launch.channel} onOpen={onOpenCapability} />{viewer(t('runtimeMap.originalPrompt'), event.payload.prompt)}</>
          case 'run.completed': case 'run.interrupted': return event.payload.reason ? viewer(t('runtimeMap.description'), { text: event.payload.reason }) : <p className="runtime-muted">{t(`runtimeMap.status.${event.payload.status}`)}</p>
          case 'approval.requested': return viewer(t('runtimeMap.description'), { text: event.payload.description })
          case 'approval.resolved': return <p>{t(event.payload.approved ? 'runtimeMap.permissionGranted' : 'runtimeMap.permissionDenied')}</p>
          case 'operation.queued': return viewer(t('runtimeMap.description'), { text: event.payload.description })
          case 'attempt.started': case 'attempt.completed': return viewer(t('runtimeMap.description'), event.payload.description ? { text: event.payload.description } : undefined)
          case 'memory.retrieved': case 'memory.included': case 'memory.proposed': case 'memory.committed': return <><p className="runtime-muted">{t(`runtimeMap.memoryState.${event.kind.split('.')[1]}`)}</p>{viewer(t('runtimeMap.kind.memory'), event.payload.content)}</>
          case 'trace.gap': return <><p className="runtime-warning">{t('runtimeMap.gap', { from: event.payload.fromSeq, to: event.payload.toSeq ?? '…' })}</p>{viewer(t('runtimeMap.description'), { text: event.payload.reason })}</>
          case 'trace.coverage': return <><p className="runtime-muted">{t(`runtimeMap.coverage.${event.payload.coverage.state}`)}</p>{viewer(t('runtimeMap.description'), event.payload.coverage.reason ? { text: event.payload.coverage.reason } : undefined)}{viewer(t('runtimeMap.notRecorded'), { text: coverageMissingText(event.payload.coverage.missing, t, '\n') })}</>
          case 'usage.reported': return <><p className="runtime-muted">{t('runtimeMap.usageProvider')}</p><dl className="runtime-properties"><Property label={t('runtimeMap.usageScope')} value={event.payload.usage.scope} /><Property label={t('runtimeMap.inputTokens')} value={measurementText(event.payload.usage.inputTokens) || t('runtimeMap.unknown')} /><Property label={t('runtimeMap.outputTokens')} value={measurementText(event.payload.usage.outputTokens) || t('runtimeMap.unknown')} /><Property label={t('runtimeMap.cost')} value={measurementText(event.payload.usage.cost) ? `${measurementText(event.payload.usage.cost)} ${event.payload.usage.currency || ''}` : t('runtimeMap.unknown')} /><Property label={t('runtimeMap.source')} value={event.payload.usage.source} /></dl></>
          case 'model.confirmed': case 'model.changed': return <dl className="runtime-properties"><Property label={t('runtimeMap.requestedModel')} value={event.payload.model.requested || t('runtimeMap.unknown')} /><Property label={t('runtimeMap.confirmedModel')} value={measurementText(event.payload.model.confirmed) || t('runtimeMap.unknown')} /><Property label={t('runtimeMap.contextWindow')} value={measurementText(event.payload.model.contextWindow) || t('runtimeMap.unknown')} /></dl>
          default: return viewer(t('runtimeMap.content'), nodeContent(node))
        }
      })()}
      <details className="runtime-lifecycle"><summary>{t('runtimeMap.lifecycle', { count: node.events.length })}</summary>{node.events.map(item => <p key={item.eventId}><span>#{item.seq}</span> {item.kind}</p>)}</details>
    </div>
  </aside>
}

function Property({ label, value, title }: { label: string; value: string; title?: string }) { return <><dt>{label}</dt><dd title={title}>{safeDisplayText(value, 2048)}</dd></> }
function Criteria({ criteria }: { criteria: string[] }) { const { t } = useTranslation(); return <section className="runtime-criteria"><h4>{t('runtimeMap.criteria')}</h4>{criteria.length ? <ul>{criteria.map((criterion, index) => <li key={index}>{safeDisplayText(criterion)}</li>)}</ul> : <p className="runtime-muted">{t('runtimeMap.notRecorded')}</p>}</section> }
function CapabilityButton({ capability, onOpen }: { capability?: CapabilityRef; onOpen?: (ref: CapabilityRef) => void }) { const { t } = useTranslation(); return capability ? <div className="runtime-capability"><span>{safeDisplayText(capability.label)}{capability.version ? ` · ${safeDisplayText(capability.version)}` : ''}</span>{onOpen && <button type="button" onClick={() => onOpen(capability)}><ExternalLink size={13} />{t('runtimeMap.openCapability')}</button>}</div> : null }
function EvidenceLinks({ ids, onSelect }: { ids?: string[]; onSelect?: (eventId: string) => void }) { const { t } = useTranslation(); return ids?.length ? <section><h4>{t('runtimeMap.evidence')}</h4>{ids.map((id, index) => <button className="runtime-text-button" key={id} type="button" title={safeDisplayText(id, 256)} onClick={() => onSelect?.(id)} disabled={!onSelect}>{t('runtimeMap.evidence')} {index + 1}</button>)}</section> : null }

function ContextDetails({ snapshot, scope, readPayload, onOpenCapability }: { snapshot: RuntimeContextSnapshot; scope: RuntimeContentScope; readPayload?: ReadRuntimePayload; onOpenCapability?: (ref: CapabilityRef) => void }) {
  const { t } = useTranslation()
  const fill = measurementText(contextFill(snapshot.inputTokens, snapshot.model.contextWindow), value => `${value.toFixed(1)}%`)
  const value = (measurement: Measurement<number> | Measurement<string>) => measurementText(measurement as Measurement<string | number>) || t('runtimeMap.unknown')
  return <>
    <p className="runtime-muted">{t('runtimeMap.roxSystemInstructions')}</p>
    <dl className="runtime-properties"><Property label={t('runtimeMap.requestedModel')} value={snapshot.model.requested || t('runtimeMap.unknown')} /><Property label={t('runtimeMap.confirmedModel')} value={value(snapshot.model.confirmed)} /><Property label={t('runtimeMap.contextWindow')} value={value(snapshot.model.contextWindow)} /><Property label={t('runtimeMap.inputTokens')} value={value(snapshot.inputTokens)} /><Property label={t('runtimeMap.contextFill')} value={fill || t('runtimeMap.unknown')} /><Property label={t('runtimeMap.permissions')} value={snapshot.permissionMode || t('runtimeMap.unknown')} /><Property label={t('runtimeMap.workingDirectory')} value={snapshot.workingDirectory || t('runtimeMap.unknown')} /></dl>
    <ContentViewer label={t('runtimeMap.originalPrompt')} content={snapshot.originalPrompt} scope={scope} readPayload={readPayload} />
    <ContentViewer label={t('runtimeMap.effectivePrompt')} content={snapshot.effectivePrompt} scope={scope} readPayload={readPayload} />
    {[...snapshot.blocks].sort((a, b) => a.order - b.order).map(block => <details key={block.id} className="runtime-context-block"><summary><span>{block.order + 1}. {safeDisplayText(block.label)}</span><small>{t(block.included ? 'runtimeMap.included' : 'runtimeMap.notIncluded')}</small></summary><dl className="runtime-properties"><Property label={t('runtimeMap.source')} value={block.source} /><Property label={t('runtimeMap.blockKind')} value={block.kind} />{block.version && <Property label={t('runtimeMap.version')} value={block.version} />}{block.hash && <Property label={t('runtimeMap.hash')} value={block.hash} />}{block.reduction && <Property label={t('runtimeMap.reduction')} value={t(`runtimeMap.reductionKind.${block.reduction}`)} />}</dl><CapabilityButton capability={block.capability} onOpen={onOpenCapability} /><ContentViewer label={t('runtimeMap.content')} content={block.content} scope={scope} readPayload={readPayload} /></details>)}
    {snapshot.coverage.state !== 'complete' && <p className="runtime-warning">{t('runtimeMap.coveragePartial')} {coverageMissingText(snapshot.coverage.missing, t)}</p>}
  </>
}
