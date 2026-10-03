import type { Message } from '../types/message'
import type { RuntimeEvent, TraceCoverage } from './types'
import { known, unknown } from './types'
export const LEGACY_TRACE_COVERAGE:TraceCoverage={state:'partial',source:'reconstructed-from-transcript',missing:['initial-context','internal-agents','durations','provider-reasoning','plan-and-acceptance'],reason:'Only persisted message and tool identities are available'}
/** Reconstruct ONLY persisted messages/tool IDs; never infer skills, children or thought from prose. */
export function reconstructLegacyRuntimeEvents(messages:readonly Message[],scope:{workspaceId:string;sessionId:string}):RuntimeEvent[]{
  const events:RuntimeEvent[]=[];let rootRunId:string|undefined;let seq=0
  for(const message of messages){
    if(message.role==='user'){rootRunId=`legacy:${message.backendMessageId ?? message.id}`;seq=0}
    if(!rootRunId)continue
    const common={schemaVersion:1 as const,eventId:`legacy:${message.id}`,sourceEventId:message.backendMessageId ?? message.id,sourceId:`transcript:${scope.sessionId}`,sourceSeq:++seq,workspaceId:scope.workspaceId,rootSessionId:scope.sessionId,sessionId:scope.sessionId,rootRunId,runId:rootRunId,agentId:`legacy-agent:${scope.sessionId}`,seq,occurredAt:Number.isFinite(message.timestamp)?known(message.timestamp,'persisted message timestamp','derived'):unknown('not-recorded'),receivedAt:Number.isFinite(message.timestamp)?message.timestamp:0,clockDomain:'transcript-message-timestamps',origin:'derived' as const,messageId:message.backendMessageId ?? message.id}
    let event:RuntimeEvent|undefined
    if(message.role==='user')event={...common,kind:'run.accepted',payload:{prompt:{text:message.content},launch:{kind:'unknown'}}}
    else if(message.role==='tool' && message.toolUseId && message.toolName)event={...common,toolUseId:message.toolUseId,kind:'tool.completed',payload:{name:message.toolName,result:{text:message.content},status:message.isError?'failed':'succeeded'}}
    else if(message.role==='assistant' && !message.isIntermediate)event={...common,kind:'result.published',payload:{content:{text:message.content}}}
    if(event)events.push(event);else seq--
  }
  return events
}
