import * as React from 'react'
import {createRoot} from 'react-dom/client'
import {Provider,createStore,useAtomValue} from 'jotai'
import {I18nextProvider,initReactI18next} from 'react-i18next'
import i18n from 'i18next'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '@/index.css'
import {AppShellProvider} from './context'
import {PanelStackContainer} from '@/components/app-shell/PanelStackContainer'
import {PanelWorkspaceMenu} from '@/components/app-shell/PanelWorkspaceMenu'
import {panelStackAtom,focusedPanelIdAtom,closePanelAtom} from '@/atoms/panel-stack'
const store=createStore()
store.set(panelStackAtom,Array.from({length:4},(_,i)=>({id:'p'+(i+1),route:('allSessions/session/s'+(i+1)) as any,proportion:.25,panelType:'session',laneId:'main'})))
store.set(focusedPanelIdAtom,'p1')
const fixture={mounts:{} as Record<string,number>,unmounts:{} as Record<string,number>,emitFocus:(_direction:string)=>{},setFocused:(id:string)=>store.set(focusedPanelIdAtom,id),closeFocused:()=>{const id=store.get(focusedPanelIdAtom);if(id)store.set(closePanelAtom,id)}}
;(window as any).__panelFixture=fixture
;(window as any).electronAPI={onPanelFocusDirection:(handler:any)=>{fixture.emitFocus=handler;return()=>{fixture.emitFocus=()=>{}}}}
function App(){const [workspace,setWorkspace]=React.useState('workspace-a'),[compact,setCompact]=React.useState(false),[dialog,setDialog]=React.useState(false);const focused=useAtomValue(focusedPanelIdAtom);return <AppShellProvider value={{activeWorkspaceId:workspace,isFocusedPanel:true}}><div style={{height:'100vh',display:'flex',flexDirection:'column'}}><div style={{height:50,display:'flex',alignItems:'center',gap:12,padding:8}}><PanelWorkspaceMenu/><button onClick={()=>setCompact(!compact)}>Toggle compact</button><button onClick={()=>setWorkspace(workspace==='workspace-a'?'workspace-b':'workspace-a')}>Switch workspace</button><button onClick={()=>setDialog(!dialog)}>Toggle dialog</button><output data-testid="focused">{focused}</output></div><PanelStackContainer sidebarSlot={null} sidebarWidth={0} navigatorSlot={null} navigatorWidth={0} isSidebarAndNavigatorHidden={true} isCompact={compact}/>{dialog&&<div role="dialog">Protected modal</div>}</div></AppShellProvider>}
await i18n.use(initReactI18next).init({lng:'en',fallbackLng:'en',resources:{en:{translation:en}},keySeparator:false,interpolation:{escapeValue:false}})
createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18n}><Provider store={store}><App/></Provider></I18nextProvider>)
