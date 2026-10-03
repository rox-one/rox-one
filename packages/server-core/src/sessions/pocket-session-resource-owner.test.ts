import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('actual SessionManager rejects foreign concurrent and title owners, freezes queue and fences restored bindings', async () => {
 const root = join(import.meta.dir, '../../../..')
 const temp = mkdtempSync(join(tmpdir(), 'pocket-resource-owner-'))
 try {
  const config = join(temp, 'tsconfig.json')
  writeFileSync(config, JSON.stringify({ compilerOptions: { baseUrl: root, paths: { '@rox/shared/*': [join(root, 'packages/shared/src/*')], '@rox/server-core/*': [join(root, 'packages/server-core/src/*')], '@rox/core/*': [join(root, 'packages/core/src/*')] } } }))
  const child = Bun.spawn([process.execPath, '--tsconfig-override', config, '-e', `
const {SessionManager,createManagedSession}=await import(process.env.ROX_OWNER_NEGATIVE_CONTROL ? './packages/server-core/src/sessions/.pocket-owner-before.ts' : './packages/server-core/src/sessions/SessionManager.ts');
const {createPocketFixture,pocketSnapshot}=await import('./packages/shared/src/auth/__tests__/pocket-test-fixture.ts');
const {setRoxAccountAuthority}=await import('./packages/shared/src/auth/rox-account-authority.ts');
const {mkdirSync}=await import('node:fs');const {join}=await import('node:path');
const f=createPocketFixture();setRoxAccountAuthority(f.authority);
const a={issuer:'fixture',subject:'a'},b={issuer:'fixture',subject:'b'};
f.client.account=async token=>pocketSnapshot(token);f.client.credential=async(_token,s)=>({accountId:s.user.id,keyId:s.key.id,generation:1,apiKey:'synthetic-fixture',baseUrl:'https://api.rox.one/v1'});
for(const [caller,id]of [[a,'account-a'],[b,'account-b']])await f.store.write(caller,{accountId:id,authGeneration:'generation-'+id,accessToken:id,refreshToken:'fixture-refresh-'+id,expiresAt:Date.now()+900000});
const ca=await f.authority.capture(a),cb=await f.authority.capture(b);const workspace=join(process.env.ROX_CONFIG_DIR,'workspace');mkdirSync(workspace);
const sm=new SessionManager();const managed=createManagedSession({id:'s1',name:'probe'},{id:'ws',name:'Fixture',rootPath:workspace,createdAt:1},{messagesLoaded:true});sm.sessions.set('s1',managed);
sm.setLastMessageClientId=()=>{};sm.persistSession=()=>{};sm.flushSession=async()=>{};sm.sendEvent=()=>{};
let enteredResolve,release;const entered=new Promise(r=>enteredResolve=r),blocked=new Promise(r=>release=r);let count=0,selected;
sm.ensureMessagesLoaded=async()=>{if(++count===1){enteredResolve();await blocked}else throw Error('UNSAFE_B_REACHED_MESSAGES');};
sm.getOrCreateAgent=async m=>{selected=await sm.roxExecutionForSession(m);throw Error('STOP_BEFORE_BACKEND');};
const pa=sm.sendMessage('s1','A',undefined,undefined,undefined,undefined,undefined,undefined,{roxExecutionContext:ca}).catch(e=>e.message);await entered;
const pb=await sm.sendMessage('s1','B',undefined,undefined,undefined,undefined,undefined,undefined,{roxExecutionContext:cb}).catch(e=>e.message);
const title=await sm.refreshTitle('s1',cb).catch(e=>({error:e.message}));release();await pa;
f.authority.assertCurrent(ca);f.authority.assertCurrent(cb);
const binding=await f.store.readBinding('session:ws:s1');
// Same owner remains able to queue; replay must retain this context rather than resolving a new mutable map.
sm.ensureMessagesLoaded=async()=>{};managed.isProcessing=true;managed.agent=null;managed.messageQueue=[];
let nativeGrantCurrent=true;const nativeContext={owner:{issuer:'fixture-native',userId:'native-a',workspaceId:'ws'},assertAuthorized(){if(!nativeGrantCurrent)throw Error('NATIVE_GRANT_REVOKED')}};
await sm.sendMessage('s1','queued A',undefined,undefined,undefined,undefined,undefined,undefined,{callerClientId:'native-client-a',nativeMemoryContext:nativeContext,roxExecutionContext:ca});
const queuedContext=managed.messageQueue[0]?.roxExecutionContext;const queuedNativeOwner=managed.messageQueue[0]?.rpcContext?.nativeMemoryContext?.owner?.userId;const queueResource=managed.messageQueue[0]?.roxOwnerResource;let replayContext,replayNativeOwner,replayCaller;
sm.sendMessage=async(...args)=>{replayContext=args[8]?.roxExecutionContext;replayNativeOwner=args[8]?.nativeMemoryContext?.owner?.userId;replayCaller=args[8]?.callerClientId};sm.processNextQueuedMessage('s1');await Bun.sleep(10);
let revokedNativeQueueSends=0;sm.sendMessage=async()=>{revokedNativeQueueSends++};nativeGrantCurrent=false;managed.messageQueue=[{message:'revoked native A',rpcContext:{nativeMemoryContext:nativeContext},roxExecutionContext:ca}];sm.processNextQueuedMessage('s1');await Bun.sleep(10);
sm.sendMessage=async(...args)=>{replayContext=args[8]?.roxExecutionContext};

// A delayed sealed-owner lookup cannot replace an independently selected current owner.
sm.roxExecutions.delete('s1');let resumeBound;const originalBound=f.authority.bound.bind(f.authority);f.authority.bound=()=>new Promise(r=>resumeBound=r);
const restore=sm.roxExecutionForSession(managed).catch(e=>e.message);await Bun.sleep(1);sm.roxExecutions.set('s1',cb);resumeBound(ca);const restored=await restore;f.authority.bound=originalBound;
const restoredOwner=sm.roxExecutions.get('s1')?.cloudAccountId;
let rejectedLateTitle,lateCallbackError,callbackWrites,heldSwitchError,recoveredQueueOwner,staleQueueSends,queueFailure,missingAuthorityQueueSends,missingAuthorityFailure,runtimeEventError,runtimeEventText,runtimeCompleteError,runtimeCompleteAdded,nativeEventError,nativeEventText;
if(!process.env.ROX_OWNER_NEGATIVE_CONTROL){
// Actual title completion from an otherwise-current A must not publish into a B resource.
sm.roxExecutions.set('s1',ca);let titleEntered,finishTitle;const titleStarted=new Promise(r=>titleEntered=r),titlePending=new Promise(r=>finishTitle=r);
managed.name='original';managed.agent={generateTitle:async()=>{titleEntered();await titlePending;return 'late A title'}};
const lateTitle=sm.generateTitle(managed,'title A').catch(e=>e.message);await titleStarted;sm.roxExecutions.set('s1',cb);finishTitle();await lateTitle;rejectedLateTitle=managed.name==='original';
// A simulated crash drops the in-memory context; sealed per-message binding restores the exact A generation.
sm.roxExecutions.set('s1',ca);managed.messageQueue=[{message:'recovered A',roxOwnerResource:queueResource}];replayContext=undefined;sm.processNextQueuedMessage('s1');await Bun.sleep(10);recoveredQueueOwner=replayContext?.cloudAccountId;
// Registry callbacks also retain A even when both account contexts are current.
sm.roxExecutions.set('s1',ca);callbackWrites=0;
const callback=sm.fenceRoxSessionCallback('s1',ca,()=>{callbackWrites++;return 'accepted'});callback();sm.roxExecutions.set('s1',cb);try{callback()}catch(e){lateCallbackError=e.message}
// A passive collector await must not let an obsolete account event mutate the current turn.
const originalAgentEvent=sm.runtimeTrace.agentEvent.bind(sm.runtimeTrace);let collectorEntered,releaseCollector;
const collectorStarted=new Promise(r=>collectorEntered=r),collectorPending=new Promise(r=>releaseCollector=r);
sm.runtimeTrace.agentEvent=async()=>{collectorEntered();await collectorPending};sm.queueDelta=()=>{};managed.streamingText='';sm.roxExecutions.set('s1',ca);
const lateEvent=sm.processEvent(managed,{type:'text_delta',text:'obsolete account A output',turnId:'held-trace'}).catch(e=>e.message);await collectorStarted;
sm.roxExecutions.set('s1',cb);releaseCollector();runtimeEventError=await lateEvent;runtimeEventText=managed.streamingText;sm.runtimeTrace.agentEvent=originalAgentEvent;
// Completed transcript publication has its own collector await before the message is committed.
const originalPublish=sm.runtimeTrace.publishMessage.bind(sm.runtimeTrace);let publishEntered,releasePublish;
const publishStarted=new Promise(r=>publishEntered=r),publishPending=new Promise(r=>releasePublish=r);
sm.runtimeTrace.publishMessage=async()=>{publishEntered();await publishPending};sm.roxExecutions.set('s1',ca);const beforeComplete=managed.messages.length;
const lateComplete=sm.processEvent(managed,{type:'text_complete',text:'obsolete account A completion',turnId:'held-publication',isIntermediate:false}).catch(e=>e.message);await publishStarted;
sm.roxExecutions.set('s1',cb);releasePublish();runtimeCompleteError=await lateComplete;runtimeCompleteAdded=managed.messages.length-beforeComplete;sm.runtimeTrace.publishMessage=originalPublish;
// The current native-memory grant must also survive the passive collector await.
let nativeEventCurrent=true,nativeCollectorEntered,releaseNativeCollector;
const nativeCollectorStarted=new Promise(r=>nativeCollectorEntered=r),nativeCollectorPending=new Promise(r=>releaseNativeCollector=r);
sm.nativeMemoryContexts.set('s1',{owner:{issuer:'fixture-native',subject:'native-a'},assertAuthorized(){if(!nativeEventCurrent)throw Error('NATIVE_GRANT_REVOKED')}});
sm.roxExecutions.set('s1',ca);sm.runtimeTrace.agentEvent=async()=>{nativeCollectorEntered();await nativeCollectorPending};managed.streamingText='';
const nativeEvent=sm.processEvent(managed,{type:'text_delta',text:'obsolete native memory reply',turnId:'held-native'}).catch(e=>e.message);await nativeCollectorStarted;
nativeEventCurrent=false;releaseNativeCollector();nativeEventError=await nativeEvent;nativeEventText=managed.streamingText;sm.runtimeTrace.agentEvent=originalAgentEvent;sm.nativeMemoryContexts.delete('s1');
sm.roxExecutions.set('s1',ca);managed.agent=null;
const hold=sm.acquireRoxSessionLease('s1',ca);await f.authority.logout(a);
f.client.wait=async()=>({status:'approved',accessToken:'account-a2',refreshToken:'refresh-a2',tokenType:'Bearer',expiresIn:900,user:{id:'account-a2',email:'same@example.test',name:'Cloud'}});
await f.authority.start(a);await f.authority.state(a);const ca2=await f.authority.capture(a);
try{sm.acquireRoxSessionLease('s1',ca2)}catch(e){heldSwitchError=e.message}hold();const allow=sm.acquireRoxSessionLease('s1',ca2);sm.selectRoxSessionExecution('s1',ca2);allow();
// A new same-caller account does not acquire the old sealed queue owner after restart.
staleQueueSends=0;sm.sendMessage=async()=>{staleQueueSends++};sm.onProcessingStopped=async()=>{};sm.sendEvent=e=>{if(e.type==='typed_error')queueFailure=e.error.originalError};
managed.messageQueue=[{message:'old recovered A',roxOwnerResource:queueResource}];sm.processNextQueuedMessage('s1');await Bun.sleep(10);
// A sealed queue entry cannot run without the authority that resolves its immutable owner.
missingAuthorityQueueSends=0;sm.sendMessage=async()=>{missingAuthorityQueueSends++};sm.sendEvent=e=>{if(e.type==='typed_error')missingAuthorityFailure=e.error.originalError};
setRoxAccountAuthority(undefined);managed.messageQueue=[{message:'authority unavailable',roxOwnerResource:queueResource}];sm.processNextQueuedMessage('s1');await Bun.sleep(10);setRoxAccountAuthority(f.authority);
}
console.log(JSON.stringify({pb,queuedNativeOwner,replayNativeOwner,replayCaller,revokedNativeQueueSends,titleError:title.error,selected:selected?.cloudAccountId,bindingAccount:binding?.accountId,bothCurrent:true,count,queuedAccount:queuedContext?.cloudAccountId,replayAccount:replayContext?.cloudAccountId,restoreError:typeof restored==='string'?restored:null,currentOwner:restoredOwner,rejectedLateTitle,lateCallbackError,callbackWrites,heldSwitchError,switchedOwner:sm.roxExecutions.get('s1')?.cloudAccountId,recoveredQueueOwner,staleQueueSends,queueFailure,missingAuthorityQueueSends,missingAuthorityFailure,runtimeEventError,runtimeEventText,runtimeCompleteError,runtimeCompleteAdded,nativeEventError,nativeEventText}));
`], { cwd: root, env: { ...process.env, NODE_ENV: 'test', ROX_CONFIG_DIR: temp, CRAFT_CONFIG_DIR: temp }, stdout: 'pipe', stderr: 'pipe' })
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect({ exit, stdout, stderr }).toMatchObject({ exit: 0 })
  const r = JSON.parse(stdout.trim().split(/\r?\n/).at(-1)!)
  expect(r.pb).toBe('ROX_SESSION_OWNER_CONFLICT')
  expect(r.titleError).toBe('ROX_SESSION_OWNER_CONFLICT')
  expect(r.selected).toBe('account-a')
  expect(r.bindingAccount).toBe('account-a')
  expect(r.bothCurrent).toBe(true)
  expect(r.count).toBe(1)
  expect(r.queuedAccount).toBe('account-a')
  expect(r.queuedNativeOwner).toBe('native-a')
  expect(r.replayNativeOwner).toBe('native-a')
  expect(r.replayCaller).toBe('native-client-a')
  expect(r.revokedNativeQueueSends).toBe(0)
  expect(r.replayAccount).toBe('account-a')
  expect(r.restoreError).toBe('ROX_SESSION_OWNER_CONFLICT')
  expect(r.currentOwner).toBe('account-b')
  expect(r.rejectedLateTitle).toBe(true)
  expect(r.lateCallbackError).toBe('ROX_SESSION_OWNER_CONFLICT')
  expect(r.callbackWrites).toBe(1)
  expect(r.heldSwitchError).toBe('ROX_SESSION_OWNER_CONFLICT')
  expect(r.switchedOwner).toBe('account-a2')
  expect(r.recoveredQueueOwner).toBe('account-a')
  expect(r.staleQueueSends).toBe(0)
  expect(r.queueFailure).toBe('ROX_ACCOUNT_CHANGED')
  expect(r.missingAuthorityQueueSends).toBe(0)
  expect(r.missingAuthorityFailure).toBe('ROX_TRUSTED_ACCOUNT_REQUIRED')
  expect(r.runtimeEventText).toBe('')
  expect(r.runtimeEventError).toBe('ROX_SESSION_OWNER_CONFLICT')
  expect(r.runtimeCompleteError).toBe('ROX_SESSION_OWNER_CONFLICT')
  expect(r.runtimeCompleteAdded).toBe(0)
  expect(r.nativeEventError).toBe('NATIVE_GRANT_REVOKED')
  expect(r.nativeEventText).toBe('')
 } finally { rmSync(temp, { recursive: true, force: true }) }
}, 90_000)
