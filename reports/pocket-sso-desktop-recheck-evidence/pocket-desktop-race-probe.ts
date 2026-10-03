import { mkdtempSync, rmSync } from 'node:fs'; import { join } from 'node:path'; import { tmpdir } from 'node:os';
import { SessionManager, createManagedSession } from '/Users/t/.codex/worktrees/pocket-id-sso/rox-release-20261003/packages/server-core/src/sessions/SessionManager.ts';
import { createPocketFixture, pocketSnapshot } from '/Users/t/.codex/worktrees/pocket-id-sso/rox-release-20261003/packages/shared/src/auth/__tests__/pocket-test-fixture.ts';
import { setRoxAccountAuthority } from '/Users/t/.codex/worktrees/pocket-id-sso/rox-release-20261003/packages/shared/src/auth/rox-account-authority.ts';
const temp=mkdtempSync(join(tmpdir(),'pocket-review-race-')); const f=createPocketFixture(); setRoxAccountAuthority(f.authority);
const a={issuer:'fixture',subject:'caller-a'}, b={issuer:'fixture',subject:'caller-b'};
f.client.account=async token=>pocketSnapshot(token); f.client.credential=async (_token,s)=>({accountId:s.user.id,keyId:s.key!.id,generation:1,apiKey:'synthetic-fixture',baseUrl:'https://api.rox.one/v1'});
for (const [caller,id] of [[a,'account-a'],[b,'account-b']] as const) await f.store.write(caller,{accountId:id,authGeneration:'generation-'+id,accessToken:id,refreshToken:'fixture-refresh-'+id,expiresAt:Date.now()+900_000});
const contextA=await f.authority.capture(a),contextB=await f.authority.capture(b);
const sm:any=new SessionManager(); const managed=createManagedSession({id:'s1',name:'probe'}, {id:'ws',name:'fixture',rootPath:temp,createdAt:Date.now()} as any,{messagesLoaded:true}); sm.sessions.set('s1',managed);
sm.setLastMessageClientId=()=>{}; sm.persistSession=()=>{}; sm.flushSession=async()=>{}; sm.sendEvent=()=>{};
let signal!:()=>void,release!:()=>void; const entered=new Promise<void>(r=>signal=r),blocked=new Promise<void>(r=>release=r); let entries=0,observed:any;
sm.ensureMessagesLoaded=async()=>{if(++entries===1){signal();await blocked;}else throw Error('STOP_B_AFTER_OWNER_WRITE');};
sm.getOrCreateAgent=async(m:any)=>{observed=await sm.roxExecutionForSession(m);throw Error('STOP_A_BEFORE_BACKEND');};
try {
 const runA=sm.sendMessage('s1','A request',undefined,undefined,undefined,undefined,undefined,undefined,{roxExecutionContext:contextA}).catch((e:Error)=>e.message);
 await entered; const resultB=await sm.sendMessage('s1','B request',undefined,undefined,undefined,undefined,undefined,undefined,{roxExecutionContext:contextB}).catch((e:Error)=>e.message); release(); const resultA=await runA;
 f.authority.assertCurrent(contextA);f.authority.assertCurrent(contextB);
 console.log(JSON.stringify({requestAccount:contextA.cloudAccountId,backendSelectedAccount:observed?.cloudAccountId,bothCallerContextsStillCurrent:true,resultA,resultB}));
} finally {rmSync(temp,{recursive:true,force:true});}
