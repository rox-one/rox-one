// Synthetic backend for browser acceptance; no provider call or user state.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
const repository = resolve(import.meta.dirname, '../../../../../../../../..')
const { SessionManager, createManagedSession } = await import(resolve(repository,'packages/server-core/src/sessions/SessionManager.ts'))
const { saveSession, loadSession, sessionPersistenceQueue } = await import(resolve(repository,'packages/shared/src/sessions/index.ts'))
const { storedToMessage } = await import(resolve(repository,'packages/core/src/types/index.ts'))
const { createFakeOmp, useFakeOmpEnv: installFakeOmpEnv, makeOmpConfig } = await import(resolve(repository,'packages/shared/src/agent/__tests__/omp-fake-cli.ts'))
const { OmpAgent } = await import(resolve(repository,'packages/shared/src/agent/omp-agent.ts'))
const { registerSessionsHandlers } = await import(resolve(repository,'packages/server-core/src/handlers/rpc/sessions.ts'))
const { RPC_CHANNELS } = await import(resolve(repository,'packages/shared/src/protocol/index.ts'))
const fake = createFakeOmp('healthy'); const restore=installFakeOmpEnv(fake)
const workspace={id:'message-workspace',name:'Synthetic message workspace',rootPath:fake.workspaceRoot,createdAt:Date.now()}
mkdirSync(process.env.ROX_CONFIG_DIR!,{recursive:true})
writeFileSync(join(process.env.ROX_CONFIG_DIR!,'config.json'),JSON.stringify({workspaces:[workspace],activeWorkspaceId:workspace.id,activeSessionId:null,memory:{enabled:false},defaultLlmConnection:'rox-test',llmConnections:[{slug:'rox-test',name:'Synthetic Rox',providerType:'omp',authType:'none',defaultModel:'kimi-k2',createdAt:Date.now()}]}))
const manager=new SessionManager(); (manager as any).waitForInit=async()=>{}
const stored:any={id:'parent',workspaceRootPath:fake.workspaceRoot,name:'Synthetic parent',createdAt:1,lastUsedAt:1,llmConnection:'rox-test',model:'kimi-k2',sdkSessionId:'sdk-parent',messages:[{id:'canonical-user',type:'user',content:'My synthetic question',timestamp:1},{id:'assistant',type:'assistant',content:'A synthetic reply for the same question.',timestamp:2}]}
await saveSession(stored)
const managed=createManagedSession(stored,workspace);managed.messages=stored.messages.map(storedToMessage);managed.messagesLoaded=true;(manager as any).sessions.set('parent',managed)
const nativeDir=join(fake.workspaceRoot,'sessions','parent','omp');mkdirSync(nativeDir,{recursive:true});writeFileSync(join(nativeDir,'2026_sdk-parent.jsonl'),[{type:'session',id:'sdk-parent',version:3,timestamp:new Date().toISOString(),cwd:fake.workspaceRoot},{type:'message',id:'user0001',parentId:null,message:{role:'user',content:[{type:'text',text:'My synthetic question'}]}},{type:'message',id:'asst0001',parentId:'user0001',message:{role:'assistant',content:[{type:'text',text:'A synthetic reply for the same question.'}]}}].map(entry=>JSON.stringify(entry)).join('\n')+'\n')
mkdirSync(join(fake.workspaceRoot,'sessions','parent','meta'),{recursive:true});writeFileSync(join(fake.workspaceRoot,'sessions','parent','meta','omp-turn-anchors.json'),JSON.stringify({version:1,anchors:{assistant:'asst0001'}}))
const agents:any[]=[]
;(manager as any).getOrCreateAgent=async(target:any)=>{if(target.agent)return target.agent;const cfg=makeOmpConfig(fake);cfg.session={...cfg.session,...target,id:target.id};target.agent=new OmpAgent(cfg);agents.push(target.agent);return target.agent}
;(manager as any).sendEvent=()=>{}
const handlers=new Map<string,any>()
registerSessionsHandlers({handle(channel:string,handler:any){handlers.set(channel,handler)},push(){},async invokeClient(){},hasClientCapability(){return false},findClientsWithCapability(){return []}} as any,{sessionManager:manager,platform:{logger:{error(){},warn(){},info(){},debug(){}}}} as any)
const ctx={workspaceId:workspace.id,clientId:'synthetic-message-browser'}
const server=Bun.serve({hostname:'127.0.0.1',port:5199,async fetch(request){
 const headers={'access-control-allow-origin':'http://127.0.0.1:5198','access-control-allow-headers':'content-type','content-type':'application/json'}
 if(request.method==='OPTIONS')return new Response(null,{headers})
 if(request.method==='GET')return Response.json({ready:true,fixtureId:'rox-message-actions'},{headers})
 try{const {method,args}=await request.json() as any;let result:any
 if(method==='parent'){result=await manager.getSession('parent')}else if(method==='reset'){for(const message of managed.messages)message.annotations=[];(manager as any).persistSession(managed);await sessionPersistenceQueue.flush('parent');result={ok:true}}else if(method==='addAnnotation'||method==='removeAnnotation'){
  // Match the native server's canonical author projection; caller aliases cannot own a reaction.
  if(method==='addAnnotation') args.annotation.createdBy={id:'native-message-user',type:'user',name:'Native Ada'}
  await handlers.get(RPC_CHANNELS.sessions.COMMAND)(ctx,'parent',{type:method,...args})
  await sessionPersistenceQueue.flush('parent');result={annotations:loadSession(fake.workspaceRoot,'parent')!.messages.find((message:any)=>message.id===args.messageId)?.annotations??[]}
 }else if(method==='branch'){
  result=await handlers.get(RPC_CHANNELS.sessions.CREATE)(ctx,workspace.id,{branchFromSessionId:'parent',branchFromMessageId:args.messageId,llmConnection:'rox-test',model:'kimi-k2',name:`Branch of ${args.messageId}`})
 }else if(method==='branchFollowUp'){
  await manager.sendMessage(args.sessionId,args.text)
  result=await manager.getSession(args.sessionId)
 }else throw new Error('Unknown synthetic fixture method')
 return Response.json(result,{headers})
 }catch(error){return Response.json({error:error instanceof Error?error.message:String(error)},{status:500,headers})}
}})
const cleanup=async()=>{server.stop(true);for(const agent of agents)agent.destroy();await sessionPersistenceQueue.flushAll();restore();fake.cleanup();process.exit(0)}
process.once('SIGTERM',()=>{void cleanup()});process.once('SIGINT',()=>{void cleanup()})
console.log('Synthetic message RPC fixture ready')
