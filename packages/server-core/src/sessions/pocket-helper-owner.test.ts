import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('actual draft helper selects the RPC caller before backend creation and rejects stale callers before query', async () => {
  const root = join(import.meta.dir, '../../../..')
  const fixture = mkdtempSync(join(tmpdir(), 'rox-pocket-helper-'))
  try {
    const config = join(fixture, 'tsconfig.json')
    writeFileSync(config, JSON.stringify({ compilerOptions: { baseUrl: root, paths: { '@rox/shared/*': [join(root, 'packages/shared/src/*')], '@rox/server-core/*': [join(root, 'packages/server-core/src/*')], '@rox/core/*': [join(root, 'packages/core/src/*')] } } }))
    const child = Bun.spawn([process.execPath, '--tsconfig-override', config, '-e', `
const {mock}=await import('bun:test');const {mkdirSync}=await import('node:fs');const {join}=await import('node:path');
const {saveConfig}=await import('./packages/shared/src/config/storage.ts');const workspace=join(process.env.ROX_CONFIG_DIR,'workspace');mkdirSync(workspace);saveConfig({workspaces:[{id:'own',name:'Own',rootPath:workspace,createdAt:1}],activeWorkspaceId:'own',activeSessionId:null});
const {createPocketFixture,pocketSnapshot}=await import('./packages/shared/src/auth/__tests__/pocket-test-fixture.ts');
const {setRoxAccountAuthority,LOCAL_ROX_CALLER}=await import('./packages/shared/src/auth/rox-account-authority.ts');
const f=createPocketFixture();setRoxAccountAuthority(f.authority);const ownerA={issuer:'https://native.example.test',subject:'a'};
const connect=async caller=>{await f.authority.start(caller);for(let i=0;i<100;i++){if((await f.authority.state(caller)).connected)return;await Bun.sleep(1)}throw Error('connect timeout')};
await connect(ownerA);const contextA=await f.authority.capture(ownerA);f.setSnapshot(pocketSnapshot('account-b'));await connect(LOCAL_ROX_CALLER);const contextB=await f.authority.capture(LOCAL_ROX_CALLER);
const real=await import('@rox/shared/agent/backend');let queries=0,creates=0,owners=[];
const connection={slug:'fixture',name:'Fixture',providerType:'omp',authType:'none',defaultModel:'rox/standard'};
mock.module('@rox/shared/agent/backend',()=>({...real,resolveOmpSessionContext:()=>({connection,resolvedModel:'rox/standard',provider:'omp'}),createOmpSessionBackendFromResolvedContext:options=>{creates++;const owner=options.coreConfig.roxExecutionContext?.cloudAccountId??'untrusted';owners.push(owner);return {postInit:async()=>({authInjected:true}),queryLlm:async()=>{queries++;return {text:owner}},destroy(){}}}}));
const {SessionManager,setSessionPlatform}=await import('./packages/server-core/src/sessions/SessionManager.ts');setSessionPlatform({appRootPath:workspace,resourcesPath:workspace,isPackaged:false,logger:{info(){},warn(){},error(){},debug(){}}});
const manager=Object.create(SessionManager.prototype);manager.sessions=new Map([['s1',{id:'s1',workspace:{id:'own',name:'Own',rootPath:workspace},model:'rox/standard',llmConnection:'fixture'}]]);manager.roxExecutions=new Map([['s1',contextA]]);
const previousOwner=await manager.improveDraft('s1','fixture',contextB);manager.roxExecutions.clear();const freshDraft=await manager.improveDraft('s1','fixture',contextB);
await f.authority.logout(LOCAL_ROX_CALLER);const before={queries,creates};const stale=await manager.improveDraft('s1','fixture',contextB);
console.log(JSON.stringify({previousOwner,freshDraft,stale,owners,queries,creates,before}));
`], { cwd: root, env: { ...process.env, ROX_CONFIG_DIR: fixture, CRAFT_CONFIG_DIR: fixture }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ exit, stdout, stderr }).toMatchObject({ exit: 0 })
    const result = JSON.parse(stdout)
    expect(result.previousOwner).toEqual({ success: true, text: 'account-b' })
    expect(result.freshDraft).toEqual({ success: true, text: 'account-b' })
    expect(result.stale).toMatchObject({ success: false, error: 'ROX_ACCOUNT_CHANGED' })
    expect(result.owners).toEqual(['account-b', 'account-b'])
    expect(result.queries).toBe(result.before.queries)
    expect(result.creates).toBe(result.before.creates)
  } finally { rmSync(fixture, { recursive: true, force: true }) }
}, 60_000)
