import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { NotesInspectorToggle, NotesResponsiveRail } from '../../../NotesWorkspaceChrome'
import { notesAuxiliaryFits } from '../../../notes-layout'
import { NoteInspector, type NoteInspectorProps } from '../../../NoteInspector'
import { RightSessionShell } from '../../../../../components/session-workbench/RightSessionShell'
const i18n=i18next.createInstance()
await i18n.init({lng:'en',fallbackLng:'en',resources:{en:{translation:{'notes.inspector.title':'Inspector','notes.inspector.tagsPlaceholder':'Tags draft','notes.inspector.collapse':'Collapse Inspector','notes.inspector.expand':'Expand Inspector','notes.sideSession.title':'Note chat','notes.sideSession.promptPlaceholder':'Chat draft','notes.sideSession.close':'Close chat','common.close':'Close'}}},interpolation:{escapeValue:false}})
const noop=()=>{}
function Fixture(){
 const [width,setWidth]=useState(620),[workspace,setWorkspace]=useState('a'),[note,setNote]=useState('one'),[hidden,setHidden]=useState(false)
 const [open,setOpen]=useState(false),[collapsed,setCollapsed]=useState(false),[session,setSession]=useState(false),[draft,setDraft]=useState('Retained document'),[tag,setTag]=useState('Unsent tags'),[prompt,setPrompt]=useState('Unsent chat'),[closes,setCloses]=useState(0)
 const inline=notesAuxiliaryFits(width,collapsed,session)
 const closeSession=()=>{setSession(false);setCloses(n=>n+1)}
 useEffect(()=>{setOpen(false);setSession(false)},[workspace,note])
 const toggle=()=>{if(!inline){setOpen(v=>!v);return}setCollapsed(v=>{localStorage.setItem('notes:inspector-collapsed',JSON.stringify(!v));return !v})}
 const props={activeNote:{id:note,title:'Fixture note',relativePath:'one.md',path:'/fixture/one.md',tags:[],backlinks:[],links:[],assetRefs:[],properties:{}},content:'Fixture',notes:[],allTasks:[],allAssets:[],selectedTag:null,tagDraft:tag,propertyEntries:[],propertyProjection:{status:'readOnly',properties:[],diagnostics:[]},propertiesWritable:false,onUpdateScalarProperty:async()=>false,newPropertyKey:'',newPropertyValue:'',currentNoteAssets:[],uncreatedLinks:[],activeNoteTasks:[],openTasks:[],onTagDraftChange:setTag,onApplyTags:noop,onTagClick:noop,onUpdateProperty:noop,onNewPropertyKeyChange:noop,onNewPropertyValueChange:noop,onAddProperty:noop,onOpenAssetDialog:noop,onOpenFile:noop,onToggleTask:noop,onOpenNote:noop,onMissingLink:noop,collapsed:inline&&collapsed,onToggleCollapsed:toggle} as unknown as NoteInspectorProps
 ;(window as any).auxiliary={wide:()=>setWidth(1500),narrow:()=>setWidth(620),scope:()=>setWorkspace('b'),note:()=>setNote('two'),hide:()=>setHidden(true),inert:()=>{(document.querySelector('.fixture-owner') as HTMLElement).inert=true},closes:()=>closes,inline:()=>inline}
 return <I18nextProvider i18n={i18n}><section className="fixture-owner" hidden={hidden}><textarea aria-label="Document draft" value={draft} onChange={e=>setDraft(e.target.value)}/><NotesInspectorToggle inline={inline} open={open} onToggle={toggle}/><button type="button" onClick={()=>setSession(true)}>Open note chat</button>
 <NotesResponsiveRail scopeKey={JSON.stringify([workspace,note])} inline={inline} open={!inline&&open} title="Inspector" onClose={()=>setOpen(false)}><NoteInspector {...props}/></NotesResponsiveRail>
 {session&&<NotesResponsiveRail scopeKey={JSON.stringify([workspace,'session-one'])} inline={inline} open={!inline} title="Note chat" onClose={closeSession}><RightSessionShell context={{workspaceId:workspace,sessionId:'session-one',surfaceId:'notes',entityRefs:['note-one'],permissionMode:'ask'}} prompt={prompt} onPromptChange={setPrompt} onSend={noop} onClose={closeSession}/></NotesResponsiveRail>}
 </section></I18nextProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
