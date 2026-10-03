import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import BrowserPanelPage from '@/pages/BrowserPanelPage'
import { InspectorBrowserPane } from '@/components/session-inspector/InspectorBrowserPane'
import { RetainedSurface } from '@/platform/RetainedSurface'
import { INTERNAL_BROWSER_OPEN_EVENT } from '@rox/shared/browser/retained-pane'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '../../../../../index.css'

await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, keySeparator: false, interpolation: { escapeValue: false } })
const calls: Array<{ method: string; id?: string; rect?: unknown; args?: unknown }> = []
const pending: Array<{ resolve: (id: string) => void; reject: (error: Error) => void }> = []
const mode = new URLSearchParams(location.search).get('mode')
let created = 0
let deferNext = false
;(window as any).__nativeFixture = { calls, finishAttachment: () => pending.shift()?.resolve('late-inspector'), rejectAttachment: () => pending.shift()?.reject(new Error('Obsolete attachment failure')), openCurrent: () => window.dispatchEvent(new CustomEvent(INTERNAL_BROWSER_OPEN_EVENT)), openDeferred: () => { deferNext = true; window.dispatchEvent(new CustomEvent(INTERNAL_BROWSER_OPEN_EVENT)) } }
;(window as any).electronAPI = {
  browserCookieAutoStatus: async () => ({ consent: mode !== 'stale', domains: ['example.invalid'] }),
  browserPane: {
    syncBounds: async (id: string, rect: unknown) => { calls.push({ method: 'sync', id, rect }) },
    onRemoved: () => () => {}, onStateChanged: () => () => {}, list: async () => [],
    createEmbedded: async (args: unknown) => {
      calls.push({ method: 'create', args })
      if (mode === 'late' || deferNext) { deferNext = false; return await new Promise<string>((resolve, reject) => pending.push({ resolve, reject })) }
      return `fixture-inspector-${++created}`
    },
    destroy: async (id: string) => { calls.push({ method: 'destroy', id }) },
    navigate: async (id: string, url: string) => { calls.push({ method: 'navigate', id, args: url }) },
  },
}
function Draft(){const [value,setValue]=useState('');return <input aria-label="Retained draft" value={value} onChange={event=>setValue(event.target.value)}/>}
function App(){
  const [secondVisible,setSecondVisible]=useState(false)
  const [secondMounted,setSecondMounted]=useState(true)
  const [firstVisible,setFirstVisible]=useState(true)
  const [retained,setRetained]=useState(true)
  const [clipped,setClipped]=useState(false)
  const [inspector,setInspector]=useState(true)
  const [overlay,setOverlay]=useState(false)
  return <main style={{padding:20}}>
    <div className="mb-4 flex flex-wrap gap-3">
      <button onClick={()=>setSecondVisible(value=>!value)}>Toggle second</button>
      <button onClick={()=>setSecondMounted(false)}>Remove second</button>
      <button onClick={()=>setFirstVisible(value=>!value)}>Toggle first</button>
      <button onClick={()=>setRetained(value=>!value)}>Toggle retained</button>
      <button onClick={()=>setClipped(value=>!value)}>Toggle clip</button>
      <button onClick={()=>setInspector(false)}>Close inspector</button>
      <button onClick={()=>setOverlay(value=>!value)}>Toggle overlay</button>
    </div>
    <div style={{display:'flex',gap:20}}>
      <RetainedSurface visible={retained}>
        <div data-testid="first-host" style={{width:300,height:240,display:firstVisible?'block':'none'}}><Draft/><div style={{height:200,overflow:'hidden'}}><BrowserPanelPage instanceId="shared" persist/></div></div>
      </RetainedSurface>
      {secondMounted&&<div data-testid="second-host" style={{display:secondVisible?'block':'none',width:300,height:clipped?100:200,overflow:'hidden'}}><div style={{height:200,width:300}}><BrowserPanelPage instanceId="shared" persist/></div></div>}
      {mode&&inspector&&<div style={{width:300,height:240,display:'flex',flexDirection:'column'}}><InspectorBrowserPane/></div>}
    </div>
    {overlay&&<div role="dialog" data-state="open" style={{position:'fixed',inset:0,background:'#0008'}}><button onClick={()=>setOverlay(false)}>Dismiss overlay</button></div>}
  </main>
}
createRoot(document.getElementById('root')!).render(<App/>)
