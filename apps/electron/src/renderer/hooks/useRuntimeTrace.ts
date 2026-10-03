import { useCallback, useEffect, useMemo } from 'react'
import { useAtomValue, useStore } from 'jotai'
import type { Message } from '@rox/core'
import { reconstructLegacyRuntimeEvents, LEGACY_TRACE_COVERAGE } from '@rox/core/runtime-trace/legacy'
import type { RuntimePayloadQuery, RuntimeTraceQuery } from '@rox/core/runtime-trace'
import { buildRuntimeGraph, createRuntimeProjection, projectRuntimeEvents, runtimeProjectionCoverage, runtimeProjectionEvents } from '@rox/core/runtime-trace/projector'
import { isRuntimePayloadPage } from '@rox/core/runtime-trace/validation'
import { mergeTraceCoverage } from '@rox/core/runtime-trace/coverage'
import { runtimeTraceScopeKey, runtimeTraceSessionAtomFamily } from '../atoms/runtime-trace'
import { loadRuntimeTrace, recoverRuntimeTrace, type RuntimeTraceAPI } from '../event-processor/runtime-trace-ingress'

/** Reads App's canonical ingress atoms. Opening a map never establishes a second live subscription. */
export function useRuntimeTrace(query: RuntimeTraceQuery & { legacyMessages?: readonly Message[] }) {
  const store=useStore();const scopeKey=runtimeTraceScopeKey(query)
  const session=useAtomValue(runtimeTraceSessionAtomFamily(scopeKey))
  const api=window.electronAPI as unknown as RuntimeTraceAPI
  const legacyEvents=useMemo(()=>session.loaded && !Object.keys(session.projections).length && query.legacyMessages?.length ? reconstructLegacyRuntimeEvents(query.legacyMessages,query) : [],[session.loaded,session.projections,query.legacyMessages,query.workspaceId,query.sessionId])
  const rootRunId=query.rootRunId ?? session.activeRootRunId ?? session.runs.at(-1)?.rootRunId ?? legacyEvents.at(-1)?.rootRunId
  const state=useMemo(()=>rootRunId?session.projections[rootRunId] ?? (legacyEvents.length ? {...projectRuntimeEvents(legacyEvents,{...query,rootRunId}),coverage:LEGACY_TRACE_COVERAGE}:createRuntimeProjection({...query,rootRunId})):createRuntimeProjection(query),[session.projections,rootRunId,query.workspaceId,query.sessionId,legacyEvents])
  const graph=useMemo(()=>buildRuntimeGraph(state),[state])
  const events=useMemo(()=>runtimeProjectionEvents(state),[state.eventPages])
  const coverage=useMemo(()=>state.eventCount?mergeTraceCoverage(runtimeProjectionCoverage(state),session.coverage):session.loaded?session.coverage:{state:'unavailable' as const,source:'runtime' as const,missing:['not-loaded']},[state,session.coverage,session.loaded])
  const refresh=useCallback(()=>loadRuntimeTrace(store,{workspaceId:query.workspaceId,sessionId:query.sessionId,rootRunId:query.rootRunId},api),[store,query.workspaceId,query.sessionId,query.rootRunId,api])
  useEffect(()=>{void refresh()},[refresh])
  useEffect(()=>{if(rootRunId&&!rootRunId.startsWith('legacy:')&&state.contiguousSeq<state.highestSeq)void recoverRuntimeTrace(store,{workspaceId:query.workspaceId,sessionId:query.sessionId,rootRunId},api).catch(()=>{})},[store,query.workspaceId,query.sessionId,rootRunId,state.contiguousSeq,state.highestSeq,api])
  const readPayload=useCallback((payloadQuery:RuntimePayloadQuery)=>{
    if(payloadQuery.workspaceId!==query.workspaceId||payloadQuery.sessionId!==query.sessionId && payloadQuery.sessionId!==session.canonicalSessionId)throw new Error('runtimeMap.invalidResponse')
    return api.readRuntimeTracePayload(payloadQuery).then(page=>{if(!isRuntimePayloadPage(page)||page.offset !== (payloadQuery.offset ?? 0)||page.nextOffset !== undefined && page.nextOffset<=page.offset)throw new Error('runtimeMap.invalidResponse');return page})
  },[api,query.workspaceId,query.sessionId,session.canonicalSessionId])
  return {state,graph,events,runs:session.runs,coverage,rootRunId,loading:session.loading,error:session.error,refresh,reload:refresh,readPayload}
}
