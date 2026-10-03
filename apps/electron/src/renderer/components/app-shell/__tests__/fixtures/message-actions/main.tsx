import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { MessageReactionActorProvider } from '../../../../../../../../../packages/ui/src/components/chat/message-reaction-actor'
import { useAuthenticatedReactionActor } from '@/hooks/useMessageReactionActor'
import { UserMessageBubble } from '../../../../../../../../../packages/ui/src/components/chat/UserMessageBubble'
import { ResponseCard } from '../../../../../../../../../packages/ui/src/components/chat/TurnCard'
import { TooltipProvider } from '../../../../../../../../../packages/ui/src/components/tooltip'
import { messageActionId } from '@/lib/message-action-id'
import { createMessageTts } from '@/lib/message-tts'
import { handleMessageAnnotationsUpdated, handleUserMessage } from '@/event-processor/handlers/session'
import { buildSideThreadPrompt } from '@rox/shared/side-threads'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '../../../../../index.css'

await i18n.use(initReactI18next).init({ lng:'en', fallbackLng:'en', resources:{ en:{translation:en}}, keySeparator:false, interpolation:{escapeValue:false} })
const calls: any[] = []
let identityReads = 0
;(window as any).electronAPI = {
 identityGetState: async () => {
  calls.push({ method: 'identityGetState', args: {} })
  if (new URLSearchParams(location.search).has('identity-failed') && identityReads++ === 0) throw new Error('Synthetic identity connection failure')
  return { annotationActorId: 'native-message-user', profile: { displayName: 'Native Ada' }, connections: [], entitlements: [] }
 },
 onIdentityChanged: () => () => {},
}
const initial = handleUserMessage({ session: { id:'parent', workspaceId:'workspace', messages:[{id:'optimistic-user',role:'user',content:'My synthetic question',timestamp:1,isPending:true}], lastMessageAt:1 } as any, streaming:null }, {type:'user_message',sessionId:'parent',message:{id:'canonical-user',role:'user',content:'My synthetic question',timestamp:1},status:'accepted',optimisticMessageId:'optimistic-user'}).state
initial.session.messages.push({id:'assistant',role:'assistant',content:'A synthetic reply for the same question.',timestamp:2})
const rpc = async (method: string, args: any) => { calls.push({method,args}); const response=await fetch('http://127.0.0.1:5199/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,args})}); const result=await response.json(); if(!response.ok)throw new Error(result.error); return result }
const tts = createMessageTts({speakVoice:async payload=>{calls.push({method:'speakVoice',args:payload});return{playback:'renderer'}},synth:{speak(){},cancel(){}},createUtterance:text=>text})
const persisted = await rpc('parent',{})
initial.session.messages = initial.session.messages.map(message=>({...message,annotations:persisted.messages.find((entry:any)=>entry.id===messageActionId(initial.session.messages,message.id))?.annotations}))
;(window as any).__messageFixture={calls}
function App(){
 const actor=useAuthenticatedReactionActor('workspace')
 const [state,setState]=useState(initial)
 const [draft,setDraft]=useState('')
 const [branch,setBranch]=useState<any>(null)
 const [listening,setListening]=useState<string|null>(null)
 const user=state.session.messages[0]!
 const assistant=state.session.messages[1]!
 const annotate=async (id:string,annotation:any)=>{const messageId=messageActionId(state.session.messages,id);const result=await rpc('addAnnotation',{messageId,annotation});setState(current=>handleMessageAnnotationsUpdated(current,{type:'message_annotations_updated',sessionId:'parent',messageId,annotations:result.annotations}).state)}
 const remove=async (id:string,annotationId:string)=>{const messageId=messageActionId(state.session.messages,id);const result=await rpc('removeAnnotation',{messageId,annotationId});setState(current=>handleMessageAnnotationsUpdated(current,{type:'message_annotations_updated',sessionId:'parent',messageId,annotations:result.annotations}).state)}
 const listen=async(text:string,id:string)=>{if(listening===id){tts.stop();setListening(null);return}setListening(id);await tts.speak(text,()=>setListening(null))}
 const createBranch=async(id:string)=>{const child=await rpc('branch',{messageId:messageActionId(state.session.messages,id)});setBranch(child)}
 const sideThread=(action:any,text:string,id:string)=>setDraft(buildSideThreadPrompt({action,sourceText:text,sourceMessageId:messageActionId(state.session.messages,id),sourceSessionId:'parent'}))
 return <MessageReactionActorProvider actor={actor}><TooltipProvider><main className="mx-auto max-w-3xl p-8"><h1 className="mb-6 text-xl">Synthetic message action acceptance</h1><div data-testid="user"><UserMessageBubble content={user.content} messageId={user.backendMessageId??user.id} sessionId="parent" annotations={user.annotations} onAddAnnotation={annotate} onRemoveAnnotation={remove} onQuote={setDraft} onListen={text=>{void listen(text,user.id)}} isListening={listening===user.id} onBranch={createBranch} onPickSideThread={sideThread}/></div><div data-testid="assistant" className="mt-8"><ResponseCard text={assistant.content} isStreaming={false} compactMode={new URLSearchParams(location.search).has('compact')} messageId={assistant.id} sessionId="parent" annotations={assistant.annotations} onAddAnnotation={annotate} onRemoveAnnotation={remove} onQuote={setDraft} onListen={()=>{void listen(assistant.content,assistant.id)}} isListening={listening===assistant.id} onBranch={()=>{void createBranch(assistant.id)}} onPickSideThread={sideThread}/></div><textarea aria-label="Draft" className="mt-6 w-full border p-3" value={draft} onChange={event=>setDraft(event.target.value)}/>{branch&&<section aria-label="Created branch" className="mt-4 rounded-xl border p-4"><h2>{branch.name}</h2>{branch.messages.map((message:any)=><p key={message.id}>{message.content}</p>)}<input aria-label="Branch follow-up"/><button onClick={()=>{void rpc('branchFollowUp',{sessionId:branch.id,text:(document.querySelector('[aria-label="Branch follow-up"]') as HTMLInputElement).value}).then(next=>setBranch(next))}}>Send follow-up</button></section>}</main></TooltipProvider></MessageReactionActorProvider>
}
createRoot(document.getElementById('root')!).render(<App/>)
