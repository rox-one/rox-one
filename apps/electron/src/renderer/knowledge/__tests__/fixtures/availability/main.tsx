import * as React from 'react'
import {createRoot} from 'react-dom/client'
import {flushSync} from 'react-dom'
import {Provider,createStore} from 'jotai'
import {I18nextProvider,initReactI18next} from 'react-i18next'
import i18n from 'i18next'
import en from '../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '@/index.css'
import {windowWorkspaceIdAtom} from '@/atoms/sessions'
import {KnowledgeNotebookTree} from '../../../KnowledgeNotebookTree'
import {KnowledgeHome} from '../../../KnowledgeHome'
const store=createStore();store.set(windowWorkspaceIdAtom,'A')
const callbacks=new Set<()=>void>(),pending:Array<{kind:string;workspaceId:string;resolve:(value:any)=>void}>=[]
const control={routes:[] as string[],calls:[] as Array<{kind:string;workspaceId:string;args?:unknown}>,running:false,label:'',hold:new Set<string>(),mounted:true,scope:(_id:string)=>{},mount:(_value:boolean)=>{}}
;(window as any).__knowledgeFixture={...control,emit:()=>{for(const cb of [...callbacks])cb()},resolve:(kind:string,id:string,value:any)=>{for(const item of pending.filter(p=>p.kind===kind&&p.workspaceId===id)){pending.splice(pending.indexOf(item),1);item.resolve(value)}}}
const fixture=(window as any).__knowledgeFixture
const scope=()=>store.get(windowWorkspaceIdAtom)??'unknown'
const record=(kind:string,args?:unknown)=>fixture.calls.push({kind,workspaceId:scope(),args})
const localView=(id:string)=>[{id:`view-${id}`,name:`Saved ${id}${fixture.label}`,domain:'knowledge'}]
const localEnvelope=(id:string)=>[{knowledgeRef:{scheme:'siyuan',kind:'document',id:`doc-${id}`},createdAt:1,updatedAt:1,flagged:true}]
const delayed=(kind:string,value:any)=>fixture.hold.has(kind)?new Promise(resolve=>pending.push({kind,workspaceId:scope(),resolve})):Promise.resolve(value)
const api={
 listConnections:async()=>{record('connections');return[{id:'one'}]},
 engineStatus:(args:any)=>{record('status',args);return delayed('status',{running:fixture.running,mode:'external-local'})},
 listNotebooks:(args:any)=>{record('notebooks',args);return delayed('notebooks',[{id:`nb-${scope()}`,name:`Notebook ${scope()}`,closed:false,icon:''}])},
 get:(args:any)=>{record('title',args);return delayed('title',{title:`Title ${scope()}`})},
 viewsList:()=>{record('views');return delayed('views',localView(scope()))},
 envelopeList:()=>{record('envelopes');return delayed('envelopes',localEnvelope(scope()))},
 viewRun:async()=>({items:[],view:{id:'none',name:'None'}}),
 viewSetAttribute:async()=>({proposalId:'none'}),
 listProposals:async()=>[],
 onChanged:(cb:()=>void)=>{callbacks.add(cb);return()=>callbacks.delete(cb)},
}
;(window as any).electronAPI={knowledge:api}
function App(){const [mounted,setMounted]=React.useState(true);fixture.scope=(id:string)=>flushSync(()=>store.set(windowWorkspaceIdAtom,id));fixture.mount=(value:boolean)=>flushSync(()=>setMounted(value));return <Provider store={store}>{mounted&&<div style={{display:'flex',width:1000,height:800}}><section data-testid="tree" style={{width:350}}><KnowledgeNotebookTree/></section><section data-testid="home" style={{width:650}}><KnowledgeHome/></section></div>}</Provider>}
await i18n.use(initReactI18next).init({lng:'en',fallbackLng:'en',resources:{en:{translation:en}},keySeparator:false,interpolation:{escapeValue:false}})
createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18n}><App/></I18nextProvider>)
