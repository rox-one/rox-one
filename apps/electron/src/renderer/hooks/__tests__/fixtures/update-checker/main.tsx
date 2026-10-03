import React from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Toaster } from 'sonner'
import { useUpdateChecker } from '../../../useUpdateChecker'
import type { UpdateInfo } from '../../../../../shared/types'
import ru from '../../../../../../../../packages/shared/src/i18n/locales/ru.json'

await i18n.use(initReactI18next).init({lng:'ru',keySeparator:false,resources:{ru:{translation:ru}},interpolation:{escapeValue:false}})
const mode = new URLSearchParams(location.search).get('mode')
const ready = (version:string):UpdateInfo => ({available:true,currentVersion:'1.0.0',latestVersion:version,downloadState:'ready',downloadProgress:100})
const idle:UpdateInfo = {available:false,currentVersion:'1.0.0',latestVersion:null,downloadState:'idle',downloadProgress:0}
const calls:string[]=[]
let resolveInitial:((info:UpdateInfo)=>void)|undefined
let resolveDismissal:((version:string|null)=>void)|undefined
let available:((info:UpdateInfo)=>void)|undefined
let progress:((value:number)=>void)|undefined
let availabilityCleanup=0
let progressCleanup=0
Object.assign(window,{electronAPI:{
  getUpdateInfo:async()=>{calls.push('getUpdateInfo');if(mode==='deny')throw{code:'AUTH_FAILED'};if(mode==='deferred')return new Promise<UpdateInfo>(resolve=>{resolveInitial=resolve});return ready('2.0.0')},
  getDismissedUpdateVersion:async()=>{calls.push('getDismissedUpdateVersion');if(mode==='dismiss-deny')throw{code:'AUTH_FAILED'};if(mode==='dismiss-held')return new Promise<string|null>(resolve=>{resolveDismissal=resolve});return null},
  dismissUpdate:async()=>{calls.push('dismissUpdate');throw{code:'AUTH_FAILED'}},
  onUpdateAvailable:(listener:(info:UpdateInfo)=>void)=>{available=listener;return()=>{availabilityCleanup+=1;available=undefined}},
  onUpdateDownloadProgress:(listener:(value:number)=>void)=>{progress=listener;return()=>{progressCleanup+=1;progress=undefined}},
  installUpdate:async()=>{},checkForUpdates:async()=>idle,
},__updateFixture:{
  calls,initial:(version:string)=>resolveInitial?.(ready(version)),dismissal:()=>resolveDismissal?.(null),
  available:(version:string)=>available?.(ready(version)),idle:()=>available?.(idle),progress:(value:number)=>progress?.(value),
  cleanup:()=>({availabilityCleanup,progressCleanup}),
}})

function Checker(){const state=useUpdateChecker();return <p data-testid="state">{state.updateInfo?JSON.stringify(state.updateInfo):'Unavailable'}</p>}
function Fixture(){const[mounted,setMounted]=React.useState(true);return <><p data-testid="ready">Production update hook with synthetic denied/deferred transport</p><button onClick={()=>setMounted(false)}>Unmount</button>{mounted?<Checker/>:null}<Toaster closeButton duration={30000}/></>}
createRoot(document.getElementById('root')!).render(<Fixture/> )
