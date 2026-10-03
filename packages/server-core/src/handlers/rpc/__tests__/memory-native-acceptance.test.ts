import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Run production imports in a fresh process: no global module mocks or user's config.
const runtime = `
const {mkdirSync,realpathSync,readFileSync}=await import('node:fs');
const {join}=await import('node:path');
const {NativeAuthority}=await import('./packages/server-core/src/authority/native-authority.ts');
const {WsRpcServer}=await import('./packages/server-core/src/transport/server.ts');
const {WsRpcClient}=await import('./packages/server-core/src/transport/client.ts');
const {registerMemoryHandlers}=await import('./packages/server-core/src/handlers/rpc/memory.ts');
const {RPC_CHANNELS}=await import('./packages/shared/src/protocol/index.ts');
const {saveConfig}=await import('./packages/shared/src/config/storage.ts');
const {MemoryFileStore}=await import('./packages/server-core/src/memory/MemoryFileStore.ts');
const root=realpathSync(process.env.ROX_CONFIG_DIR),aRoot=join(root,'a'),bRoot=join(root,'b');mkdirSync(aRoot);mkdirSync(bRoot);
saveConfig({workspaces:[{id:'a',name:'A',rootPath:aRoot,createdAt:1},{id:'b',name:'B',rootPath:bRoot,createdAt:1}],activeWorkspaceId:'a',activeSessionId:null});
new MemoryFileStore('global').writePreferences('SYNTHETIC HOST PRIVATE PREFERENCES');
new MemoryFileStore('workspace',aRoot).writeContext('Authorized workspace context');
new MemoryFileStore('workspace',bRoot).writeContext('FOREIGN WORKSPACE CONTEXT');
const stateDir=join(root,'authority');let authority=new NativeAuthority({stateDir});
const descriptor=Object.getOwnPropertyDescriptor(process.stdin,'isTTY');let admin;
try{Object.defineProperty(process.stdin,'isTTY',{value:true,configurable:true});admin=authority.bootstrapLocalAdministrator('fixture operator')}
finally{if(descriptor)Object.defineProperty(process.stdin,'isTTY',descriptor);else Reflect.deleteProperty(process.stdin,'isTTY')}
authority.registerWorkspace(admin.credential,'a',aRoot);authority.registerWorkspace(admin.credential,'b',bRoot);
const enroll=name=>authority.redeemEnrollment(authority.issueEnrollment(admin.credential,name,Date.now()+60000),name);
const alice=enroll('Alice'),bob=enroll('Bob'),reader=enroll('Reader');
for(const actor of [alice,bob])authority.grantWorkspace(admin.credential,actor.principal.subject,'a',['read','write','delete']);
authority.grantWorkspace(admin.credential,reader.principal.subject,'a',['read']);
const clients=[];let server;
const assert=(condition,name)=>{if(!condition)throw Error(name)};
const denied=async run=>{let rejected=false;try{await run()}catch{rejected=true}assert(rejected,'expected permission denial')};
const start=async()=>{server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,nativeAuthority:authority,validateToken:async token=>token==='legacy-fixture'});registerMemoryHandlers(server,{sessionManager:{},nativeData:{authority},platform:{logger:{info(){},warn(){},error(){},debug(){}}}});await server.listen()};
const connect=issued=>{const c=new WsRpcClient('ws://127.0.0.1:'+server.port,{token:issued.credential,workspaceId:'a',autoReconnect:false,requestTimeout:1000,connectTimeout:1000});clients.push(c);c.connect();return c};
const stop=async()=>{for(const c of clients.splice(0))c.destroy();await new Promise(r=>setTimeout(r,20));server.close()};
const M=RPC_CHANNELS.memory;
try{
 await start();let a=connect(alice),b=connect(bob),r=connect(reader);
 if(process.env.MEMORY_ACCEPTANCE_CASE==='context'){
  const context=await a.invoke(M.GET_CONTEXT,'a');
  assert(context.preferences==='','top-level host preferences leaked');
  assert(context.context==='Authorized workspace context','own workspace context absent');
  assert(context.workspaceMemory?.preferences==='','nested workspaceMemory leaked machine-private preferences');
  assert(!JSON.stringify(context).includes('SYNTHETIC HOST PRIVATE'),'host canary present at another depth');
  assert(!JSON.stringify(await b.invoke(M.GET_CONTEXT,'a','missing-search-term')).includes('SYNTHETIC HOST PRIVATE'),'query fallback leaked host preferences');
  const legacyServer=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,validateToken:async token=>token==='legacy-fixture'});
  registerMemoryHandlers(legacyServer,{sessionManager:{},platform:{logger:{info(){},warn(){},error(){},debug(){}}}});await legacyServer.listen();
  const legacy=new WsRpcClient('ws://127.0.0.1:'+legacyServer.port,{token:'legacy-fixture',workspaceId:'a',autoReconnect:false,requestTimeout:1000,connectTimeout:1000});legacy.connect();
  try{const legacyContext=await legacy.invoke(M.GET_CONTEXT,'a');
   assert(legacyContext.preferences==='SYNTHETIC HOST PRIVATE PREFERENCES'&&legacyContext.workspaceMemory.preferences===legacyContext.preferences,'authorized legacy semantics changed');
  }finally{legacy.destroy();await new Promise(r=>setTimeout(r,20));legacyServer.close()}
  await stop();authority.close();authority=new NativeAuthority({stateDir});await start();a=connect(alice);
  assert(!JSON.stringify(await a.invoke(M.GET_CONTEXT,'a')).includes('SYNTHETIC HOST PRIVATE'),'restart exposed host preferences');
  authority.revokeWorkspaceGrant(admin.credential,alice.principal.subject,'a');await denied(()=>a.invoke(M.GET_CONTEXT,'a'));
  console.log('native context host privacy passed');
 }else{
  const result=await a.invoke(M.ADD_LESSON,'a',{rule:'Alice private rule',category:'knowledge',scope:'workspace',owner:{issuer:bob.principal.issuer,subject:bob.principal.subject},source:{trigger:'distillation'}});
  assert(result.lesson.owner.subject===alice.principal.subject&&result.lesson.owner.issuer===alice.principal.issuer,'forged owner accepted');
  assert(result.lesson.source.trigger==='explicit','forged source trigger accepted');
  assert((await b.invoke(M.LIST_LESSONS,'workspace','a')).length===0,'foreign personal lesson leaked');
  assert(await b.invoke(M.UPDATE_LESSON,'a','workspace','Alice private rule',{rule:'overwritten'})===null,'other owner updated lesson');
  assert(await b.invoke(M.DELETE_LESSON,'a','workspace','Alice private rule')===false,'other owner deleted lesson');
  await denied(()=>r.invoke(M.ADD_LESSON,'a',{rule:'forbidden',category:'knowledge',scope:'workspace'}));
  await denied(()=>a.invoke(M.LIST_LESSONS,'workspace','b'));
  await denied(()=>a.invoke(M.UPDATE_CONTEXT,'a','global','forbidden global rewrite'));
  const patched=await a.invoke(M.UPDATE_LESSON,'a','workspace','Alice private rule',{pinned:true,disabled:true,owner:bob.principal});
  assert(patched.owner.subject===alice.principal.subject&&patched.pinned&&patched.disabled,'patch changed owner/state');
  await stop();authority.close();authority=new NativeAuthority({stateDir});await start();a=connect(alice);b=connect(bob);
  const retained=await a.invoke(M.LIST_LESSONS,'workspace','a');assert(retained.length===1&&retained[0].source.trigger==='explicit'&&retained[0].disabled,'lesson provenance/state lost restart');
  assert((await b.invoke(M.LIST_LESSONS,'workspace','a')).length===0,'restart lost owner isolation');
  authority.revokeWorkspaceGrant(admin.credential,alice.principal.subject,'a');
  await denied(()=>a.invoke(M.LIST_LESSONS,'workspace','a'));
  const stored=readFileSync(join(aRoot,'memory','lessons.jsonl'),'utf8');assert(stored.includes('Alice private rule')&&!stored.includes('overwritten'),'denied writes changed source');
  console.log('native memory owner/workspace/provenance/restart/revoke passed');
 }
}finally{await stop();authority.close()}
process.exit(0);
`

async function runFixture(kind: string, code = runtime) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-native-acceptance-'))
  try {
    const child = Bun.spawn([process.execPath, '-e', code], { cwd: join(import.meta.dir, '../../../../../..'),
      env: { ...process.env, ROX_CONFIG_DIR: dir, CRAFT_CONFIG_DIR: dir, MEMORY_ACCEPTANCE_CASE: kind }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { exit, stdout, stderr }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('actual native WS preserves personal owner and source, denies foreign workspace/read-only/revoked actions across restart', async () => {
  expect(await runFixture('owners')).toEqual({ exit: 0, stdout: 'native memory owner/workspace/provenance/restart/revoke passed\n', stderr: '' })
}, 15000)

test('production LessonStore backup failure preserves source; interrupted archive replay retains provenance and owner isolation', async () => {
  const result = await runFixture('recovery', `
const {mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync}=await import('node:fs');
const {join}=await import('node:path');
const {LessonStore}=await import('./packages/server-core/src/memory/LessonStore.ts');
const dir=join(process.env.ROX_CONFIG_DIR,'memory');mkdirSync(dir);
const path=join(dir,'lessons.jsonl'),alice={issuer:'fixture-issuer',subject:'alice'},bob={issuer:'fixture-issuer',subject:'bob'};
const lesson=(rule,owner)=>({ts:'2026-09-30T00:00:00.000Z',rule,category:'knowledge',scope:'workspace',owner,source:{trigger:'explicit',sessionId:'source-session'}});
const assert=(value,message)=>{if(!value)throw Error(message)};
let store=new LessonStore(path,'workspace');store.add(lesson('private original',alice));
const original=readFileSync(path,'utf8');writeFileSync(join(dir,'backups'),'blocked backup directory');
let failed=false;try{store.update('private original',{disabled:true},'rpc',alice)}catch{failed=true}
assert(failed&&readFileSync(path,'utf8')===original,'failed backup changed source');
rmSync(join(dir,'backups'));store.update('private original',{disabled:true},'rpc',alice);
const backups=readdirSync(join(dir,'backups')).filter(p=>p.endsWith('.jsonl'));
assert(backups.length===1&&readFileSync(join(dir,'backups',backups[0]),'utf8')===original,'retry lost exact original backup');
store=new LessonStore(path,'workspace');assert(store.forContext(alice).length===0,'disabled context included after reopen');
// Model the exact durable state after active rename and before archive delivery.
// This fixture is restart recovery evidence, not an actual SIGKILL receipt.
const active=JSON.stringify(lesson('Bob retained',bob))+'\\n';writeFileSync(path,active);
writeFileSync(path+'.archive.pending',JSON.stringify({id:'interrupted-transaction',active,archived:[lesson('Alice archived',alice)]}));
store=new LessonStore(path,'workspace');const archived=store.listArchivedForOwner(alice);
assert(archived.length===1&&archived[0].lesson.source.sessionId==='source-session','archive provenance lost');
assert(store.listArchivedForOwner(bob).length===0,'foreign archive disclosed');
assert(store.restoreArchivedForOwner(bob,archived[0].id)===null,'foreign owner restored archive');
const archivePath=join(dir,'lessons.archive.jsonl'),before=readFileSync(archivePath,'utf8');
store=new LessonStore(path,'workspace');assert(store.listArchivedForOwner(alice).length===1&&readFileSync(archivePath,'utf8')===before,'replay duplicated archive');
assert(!existsSync(path+'.archive.pending'),'completed recovery journal retained');
const restored=store.restoreArchivedForOwner(alice,archived[0].id);assert(restored.owner.subject==='alice'&&restored.source.sessionId==='source-session','restore lost owner/source');
store=new LessonStore(path,'workspace');assert(store.listForOwner(alice).length===1&&store.listForOwner(bob).length===1,'restore changed another owner');
console.log('memory backup failure and archive recovery passed');
`)
  expect(result).toEqual({ exit: 0, stdout: 'memory backup failure and archive recovery passed\n', stderr: '' })
}, 15000)

test('actual native GET_CONTEXT excludes machine-private preferences at every response depth', async () => {
  expect(await runFixture('context')).toEqual({ exit: 0, stdout: 'native context host privacy passed\n', stderr: '' })
}, 15000)
