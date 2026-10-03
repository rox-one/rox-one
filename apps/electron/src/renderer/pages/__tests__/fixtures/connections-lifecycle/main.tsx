import * as React from 'react'
import {createRoot} from 'react-dom/client'
import {Provider,createStore} from 'jotai'
import {I18nextProvider,initReactI18next} from 'react-i18next'
import i18n from 'i18next'
import en from '../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '@/index.css'
import {AppShellProvider} from './context'
import ConnectionsPage from '@/pages/ConnectionsPage'
import {ConnectionInfoSection} from '@/platform/ConnectionInfoSection'
import {selectedConnectionAtom} from '@/atoms/connections'
const store=createStore()
const calls:Array<{method:string,input:any,at:number}>=[]
const deferred:Array<{method:string,input:any,resolve:(value:any)=>void,reject:(error:any)=>void}>=[]
const options:any={}
const metadata=(workspaceId:string,id='c1')=>({id,workspaceId,integrationId:id==='c1'?'github':'github-alt',credentialRefId:id==='c1'?'cred_123e4567-e89b-12d3-a456-426614174000':'cred_123e4567-e89b-12d3-a456-426614174001',storageMode:'copy',scopes:['repo']})
const inspection=(id:string)=>({connectionId:id,credentialRefId:metadata('workspace-a',id).credentialRefId,health:'expired',expiry:'—',provenance:'public-metadata-'+id,fingerprint:'fingerprint-'+id,kind:'api_key',versionId:'version-'+id})
function call(method:string,input:any,value:any){calls.push({method,input,at:Date.now()});if(options['defer'+method])return new Promise((resolve,reject)=>deferred.push({method,input,resolve,reject}));if(options['reject'+method])return Promise.reject(Error('provider rejected PRIVATE_DO_NOT_RENDER'));return Promise.resolve(value)}
let flowIndex=0
const graph={
 listConnections:(workspaceId:string)=>call('List',{workspaceId},[metadata(workspaceId,'c1'),metadata(workspaceId,'c2')]),
 inspectConnection:(input:any)=>call('Inspect',input,{...inspection(input.connectionId),...(options.foreignInspect?{connectionId:'foreign'}:{}),...(options.inspectSecret?{token:'PRIVATE_DO_NOT_RENDER'}:{})}),
 listConnectionLeases:(input:any)=>call('Leases',input,[{id:'lease-1',consumerId:'consumer-1',purpose:'view',action:'github.api',status:'active'}]),
 testConnection:(input:any)=>call('Test',input,{login:'fixture-user'}),
 repairConnection:(input:any)=>call('Repair',input,{consumers:[{consumerId:'consumer-1',status:'repaired'}]}),
 rotateConnection:(input:any)=>call('Rotate',input,{consumers:[{consumerId:'consumer-1',status:'rotated'}]}),
 reconnectConnection:(input:any)=>call('Reconnect',input,{consumers:[{consumerId:'consumer-1',status:'revalidated'}],leases:[{consumerId:'consumer-1',status:'revoked'}],inspect:{...inspection(input.connectionId),health:'healthy',versionId:'reconnected'}}),
 moveConnection:(input:any)=>call('Move',input,{connectionId:input.connectionId,credentialRefId:metadata(input.workspaceId,input.connectionId).credentialRefId,from:'local',to:input.targetBackend,consumers:[],leases:[{consumerId:'consumer-1',status:'revoked'}],inspect:{...inspection(input.connectionId),versionId:'moved'}}),
 startGithubDeviceLogin:()=>call('Start',{}, {flowId:'flow-'+(++flowIndex),userCode:'ABCD-EFGH',verificationUri:options.badUri?'https://github.com.evil.test/login/device':'https://github.com/login/device',interval:1,...(options.startSecret?{accessToken:'PRIVATE_DO_NOT_RENDER'}:{})}),
 pollGithubDeviceLogin:(input:any)=>call('Poll',input,options.pollResult??{status:'pending',interval:1}),
 cancelGithubDeviceLogin:(input:any)=>call('Cancel',input,{cancelled:true}),
}
;(window as any).electronAPI={workgraph:graph}
;(window as any).__connectionFixture={calls,deferred,options,metadata,inspection,configure:(next:any)=>Object.assign(options,next),settle:(index:number,value:any,reject=false)=>{const item=deferred[index];reject?item.reject(Error('PRIVATE_DO_NOT_RENDER')):item.resolve(value)},select:(id:string,workspaceId='workspace-a')=>store.set(selectedConnectionAtom,metadata(workspaceId,id))}
function App(){const [workspaceId,setWorkspaceId]=React.useState('workspace-a'),[mounted,setMounted]=React.useState(true);return <AppShellProvider value={{activeWorkspaceId:workspaceId}}><button onClick={()=>setWorkspaceId(workspaceId==='workspace-a'?'workspace-b':'workspace-a')}>Switch workspace</button><button onClick={()=>setMounted(!mounted)}>Toggle consumers</button>{mounted&&<div style={{display:'flex',height:'calc(100vh - 40px)'}}><main style={{width:'70%'}}><ConnectionsPage/></main><aside data-testid="connection-inspector" style={{width:'30%',overflow:'auto'}}><ConnectionInfoSection/></aside></div>}</AppShellProvider>}
await i18n.use(initReactI18next).init({lng:'en',fallbackLng:'en',resources:{en:{translation:en}},keySeparator:false,interpolation:{escapeValue:false}})
createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18n}><Provider store={store}><App/></Provider></I18nextProvider>)
