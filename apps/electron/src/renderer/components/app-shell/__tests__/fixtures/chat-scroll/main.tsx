import * as React from 'react'
import {createRoot} from 'react-dom/client'
import {flushSync} from 'react-dom'
import i18n from 'i18next'
import {initReactI18next} from 'react-i18next'
import {ChatDisplay} from '../../../ChatDisplay'
import {FocusContext} from './context'
import {ModalProvider} from '@/context/ModalContext'
import {DismissibleLayerProvider} from '@/context/DismissibleLayerContext'
import {TooltipProvider} from '../../../../../../../../../packages/ui/src/components/tooltip'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '../../../../../index.css'
await i18n.use(initReactI18next).init({lng:'en',fallbackLng:'en',resources:{en:{translation:en}},keySeparator:false,interpolation:{escapeValue:false}})
;(window as any).electronAPI={getSendMessageKey:async()=> 'enter',readPreferences:async()=>({content:'{}'}),openUrl:()=>{},sessionCommand:async()=>{}}
document.documentElement.style.overflow='auto';document.body.style.overflow='auto';document.body.style.minHeight='1800px'
const scrolls:any[]=[],jumps:any[]=[],sends:string[]=[]
const originalScroll=Element.prototype.scrollTo,originalJump=Element.prototype.scrollIntoView
Element.prototype.scrollTo=function(...args:any[]){scrolls.push({element:this,options:args[0]});return originalScroll.apply(this,args as any)}
Element.prototype.scrollIntoView=function(...args:any[]){jumps.push(this);return originalJump.apply(this,args as any)}
const resizeRecords:any[]=[]
const NativeResizeObserver=window.ResizeObserver
window.ResizeObserver=class extends NativeResizeObserver {
 record:any
 constructor(callback:ResizeObserverCallback){super((entries,observer)=>callback(entries,observer));this.record={callback,observer:this,targets:[]};resizeRecords.push(this.record)}
 observe(target:Element,options?:ResizeObserverOptions){this.record.targets.push(target);super.observe(target,options)}
}
const messages=(id:string)=>Array.from({length:80},(_,index)=>({id:`${id}-m-${index}`,role:index%2===0?'user':'assistant',content:`Synthetic row ${index}\n\n${'content '.repeat(45)}`,timestamp:index+1}))
const initial=(id:string)=>({id,workspaceId:'fixture',messages:messages(id),isProcessing:false,sessionStatus:'in_progress'})
let api:any
function App(){const [session,setSession]=React.useState<any>(initial('A')), [focused,setFocused]=React.useState(true),[mounted,setMounted]=React.useState(true);const ref=React.useRef<any>(null)
 api={grow:()=>flushSync(()=>setSession((s:any)=>({...s,messages:s.messages.map((m:any,i:number)=>i===s.messages.length-1?{...m,content:m.content+'\n\n'+('stream content '.repeat(100))}:m)}))),commitUser:()=>flushSync(()=>setSession((s:any)=>({...s,messages:[...s.messages,{id:`${s.id}-user-${s.messages.length}`,role:'user',content:'Committed synthetic user message',timestamp:99}]}))),scope:(id:string)=>flushSync(()=>setSession(initial(id))),focus:(value:boolean)=>flushSync(()=>setFocused(value)),mount:(value:boolean)=>flushSync(()=>setMounted(value)),jump:()=>ref.current?.scrollToMessage(`${session.id}-m-0`),submit:()=>document.getElementById('submit')?.click()}
 return <div id="outer" style={{height:260,width:800,overflow:'auto',margin:60,border:'1px solid'}}><div style={{height:120}}/><div style={{height:320}}>{mounted&&<ModalProvider><DismissibleLayerProvider><TooltipProvider><FocusContext.Provider value={focused}><ChatDisplay ref={ref} session={session} onSendMessage={(text:string)=>sends.push(text)} onOpenFile={()=>{}} onOpenUrl={()=>{}} onModelChange={()=>{}} currentModel="fixture" workspaceId="fixture" compactMode/></FocusContext.Provider></TooltipProvider></DismissibleLayerProvider></ModalProvider>}</div><div style={{height:700}}/></div>}
let held:Array<FrameRequestCallback>=[],hold=false
const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window)
window.requestAnimationFrame=callback=>hold?(held.push(callback),100000+held.length):request(callback)
window.cancelAnimationFrame=id=>{if(id<100000)cancel(id)}
;(window as any).__scrollFixture={get api(){return api},scrolls,jumps,sends,clear:()=>{scrolls.length=0;jumps.length=0},hold:()=>{hold=true},release:()=>{hold=false;const callbacks=held;held=[];callbacks.forEach(callback=>callback(performance.now()));return callbacks.length},captureResize:()=>resizeRecords.map((record,index)=>({record,index})).filter(({record})=>record.targets.some((target:Element)=>target.parentElement?.hasAttribute('data-radix-scroll-area-viewport'))).map(({index})=>index),fireResize:(indices:number[])=>indices.forEach(index=>resizeRecords[index].callback([],resizeRecords[index].observer)),hidden:(value:boolean)=>Object.defineProperty(document,'visibilityState',{configurable:true,value:value?'hidden':'visible'})}
createRoot(document.getElementById('root')!).render(<App/> )
