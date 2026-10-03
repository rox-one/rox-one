import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { saveConfig } from '@rox/shared/config'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { setRoxAccountAuthority } from '@rox/shared/auth'
import { createPocketFixture } from '../../../../../shared/src/auth/__tests__/pocket-test-fixture.ts'
import { registerCoreRpcHandlers } from '../index.ts'
import { WsRpcServer, WsRpcClient } from '@rox/server-core/transport'
import { createLocalClientBindingRegistry } from '../../../../../../apps/electron/src/main/local-client-binding.ts'
import type { HandlerDeps } from '../../handler-deps.ts'
const root = process.env.ROX_CONFIG_DIR!, ws = join(root, 'workspace')
mkdirSync(ws,{recursive:true}); saveConfig({ workspaces:[{id:'workspace',slug:'workspace',name:'Fixture',rootPath:ws,createdAt:1}],activeWorkspaceId:'workspace',activeSessionId:null })
const fixture = createPocketFixture(); setRoxAccountAuthority(fixture.authority)
const registry = createLocalClientBindingRegistry(), renderer = {}
const proof = registry.issue(renderer)
let window = { webContentsId:41,renderer,workspaceId:'workspace' }
const server = new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,validateToken:async token => token==='fixture-transport-proof',resolveLocalClientBinding:candidate => registry.resolve(candidate,id => id===41?window:null)})
const welcome: string[] = []
let messageContext: any, automationContext: any
registerCoreRpcHandlers(server,{
 sessionManager:{ sendMessage: async (_sid: string,_text: string,_files: unknown,_stored: unknown,_options: unknown,_existing: unknown,_retry: unknown,onAck: (id:string)=>void,context: unknown) => { messageContext=context; onAck('accepted-fixture') }, executePromptAutomation: async (input:any) => { automationContext=input.roxExecutionContext;return { sessionId:'automation-fixture' } }, ensureFirstSessionWelcome:async (id:string) => { welcome.push(id); return {id:'welcome'} } },
 platform:{appRootPath:'',resourcesPath:'',isPackaged:false,appVersion:'fixture',isDebugMode:false,logger:{info(){},error(){},warn(){},debug(){}},imageProcessor:{getMetadata:async()=>null,process:async()=>Buffer.alloc(0)}},
 oauthFlowStore:{ store(){},getByState(){return null},remove(){},cleanup(){},dispose(){},size:0 },
} as unknown as HandlerDeps,{ } as never,{browserPane:false})
await server.listen()
const clients: WsRpcClient[] = []
const client = (bound=true) => { const c: any = new WsRpcClient(`ws://127.0.0.1:${server.port}`,{token:'fixture-transport-proof',workspaceId:'workspace',webContentsId:41,localClientProof:bound?proof:undefined,mode:'local',autoReconnect:false,connectTimeout:2000,requestTimeout:2000}); clients.push(c);c.connect();return c }
const checks:string[]=[]
const check=(name:string,value:unknown)=>{if(!value)throw Error(name);checks.push(name)}
const denied=async(fn:()=>Promise<unknown>)=>{try{await fn();return false}catch{return true}}
try {
 const c=client()
 const before=await c.invoke(RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE)
 check('fresh cloud disconnected',before.connected===false)
 const started=await c.invoke(RPC_CHANNELS.onboarding.START_ROX_CONNECT)
 check('active core registered Connect',started.success&&started.userCode==='USER-CODE')
 check('proof and tokens absent renderer',!JSON.stringify(started).includes('proof-main-only')&&!JSON.stringify(started).includes('device-proof'))
 let state:any
 for(let i=0;i<30;i++){state=await c.invoke(RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE);if(state.connected)break;await Bun.sleep(5)}
 check('bootstrap snapshot ready',state.connected&&state.account?.user.id==='account-a'&&state.account.organization.role==='owner')
 check('snapshot no raw secrets',!JSON.stringify(state).includes('account-key-fixture')&&!JSON.stringify(state).includes('access-fixture')&&!JSON.stringify(state).includes('refresh-fixture'))
 check('canonical wallet', (await c.invoke(RPC_CHANNELS.onboarding.GET_ROX_BALANCE)).balance===500)
 check('preserved welcome',(await c.invoke(RPC_CHANNELS.onboarding.ENSURE_FIRST_SESSION,'workspace')).id==='welcome'&&welcome.length===1)
 await c.invoke(RPC_CHANNELS.sessions.SEND_MESSAGE,'fixture-session','fixture input',undefined,undefined,{roxExecutionContext:{cloudAccountId:'forged-renderer-account'}})
 check('message trusted account ignores renderer identity',messageContext.roxExecutionContext.cloudAccountId==='account-a'&&messageContext.roxExecutionContext.caller.issuer==='rox:local-electron')
 const owned=await c.invoke(RPC_CHANNELS.automations.CREATE,'workspace',{event:'SchedulerTick',matcher:{name:'owned fixture',cron:'0 9 * * *',actions:[{type:'prompt',prompt:'fixture only'}]}})
 check('owned automation durable binding',(await fixture.authority.bound(`automation:workspace:${owned.id}`))?.cloudAccountId==='account-a')
 const tested=await c.invoke(RPC_CHANNELS.automations.TEST,{workspaceId:'workspace',actions:[{type:'prompt',prompt:'fixture input',roxExecutionContext:{cloudAccountId:'forged'}}]})
 check('automation trusted account ignores payload identity',automationContext.cloudAccountId==='account-a'&&tested.actions[0].success)
 check('unbound caller cannot start',await denied(()=>client(false).invoke(RPC_CHANNELS.onboarding.START_ROX_CONNECT)))
 await c.invoke(RPC_CHANNELS.onboarding.CLEAR_ROX_CLOUD)
 check('device logout revokes only current account',fixture.logouts===1&&(await c.invoke(RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE)).connected===false)
 console.log(JSON.stringify(checks))
}finally{for(const c of clients)c.destroy();server.close()}
