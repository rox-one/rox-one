import type { Message } from '@rox/core'
import type { RuntimeEvent } from '@rox/core/runtime-trace'
import { messageActionId } from './message-action-id'
export interface RuntimeChatAnchor { messageId?: string; toolUseId?: string; providerTurnId?: string }
/** Resolve optimistic/server IDs through the existing stable message identity, never row indices. */
export function resolveChatAnchor(event:RuntimeEvent,messages:Message[]):RuntimeChatAnchor{
  const canonical=event.messageId?messageActionId(messages,event.messageId):undefined
  const message=messages.find(item=>canonical&&(item.id===canonical||item.backendMessageId===canonical))
    ?? (event.toolUseId?messages.find(item=>item.toolUseId===event.toolUseId):undefined)
  return {messageId:message?.id ?? canonical,toolUseId:event.toolUseId,providerTurnId:event.providerTurnId}
}
export function resolveRuntimeEventForMessage(events:readonly RuntimeEvent[],messages:Message[],messageId:string):RuntimeEvent|undefined{
  const canonical=messageActionId(messages,messageId);const message=messages.find(item=>item.id===messageId||item.backendMessageId===canonical)
  return [...events].reverse().find(event=>event.messageId&&messageActionId(messages,event.messageId)===canonical || message?.toolUseId&&event.toolUseId===message.toolUseId)
}
export const RUNTIME_MAP_NAVIGATION_EVENT='rox:runtime-map-navigation'
export interface RuntimeMapNavigation {workspaceId:string;sessionId:string;rootRunId?:string;eventId?:string;messageId?:string;toolUseId?:string;panelId?:string;direction:'chat'|'map'}
export function dispatchRuntimeMapNavigation(detail:RuntimeMapNavigation):void{
  window.dispatchEvent(new CustomEvent<RuntimeMapNavigation>(RUNTIME_MAP_NAVIGATION_EVENT,{detail}))
}
