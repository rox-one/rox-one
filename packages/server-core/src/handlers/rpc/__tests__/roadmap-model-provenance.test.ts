import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('actual workspace query preserves unknown and known backend model without fabricating requested provenance', async () => {
 const root = process.env.ROADMAP_IMPLEMENTATION_CHECKOUT ?? join(import.meta.dir, '../../../../../..')
 const fixture = mkdtempSync(join(tmpdir(), 'roadmap-model-runtime-'))
 try {
  const config = join(fixture, 'tsconfig.json')
  writeFileSync(config, JSON.stringify({compilerOptions:{baseUrl:root,paths:{'@rox/shared/*':[join(root,'packages/shared/src/*')],'@rox/server-core/*':[join(root,'packages/server-core/src/*')],'@rox/core/*':[join(root,'packages/core/src/*')]}}}))
  const child = Bun.spawn([process.execPath, '--tsconfig-override', config, '-e', `
const {mock}=await import('bun:test');const {mkdirSync}=await import('node:fs');const {join}=await import('node:path');
const {saveConfig}=await import('./packages/shared/src/config/storage.ts');const workspace=join(process.env.ROX_CONFIG_DIR,'workspace');mkdirSync(workspace);saveConfig({workspaces:[{id:'own',name:'Own',rootPath:workspace,createdAt:1}],activeWorkspaceId:'own',activeSessionId:null});
const real=await import('@rox/shared/agent/backend');let known=false,destroys=0,queries=[];
const connection={slug:'fixture',name:'Fixture',providerType:'omp',authType:'none',defaultModel:'requested-fixture'};
mock.module('@rox/shared/agent/backend',()=>({...real,resolveOmpSessionContext:()=>({connection,resolvedModel:'requested-fixture',provider:'omp'}),createOmpSessionBackendFromResolvedContext:()=>({postInit:async()=>({authInjected:true}),queryLlm:async request=>{queries.push(request.model);return {text:'Controlled backend response',...(known?{model:'actual-fixture'}:{warning:'Fallback model unknown'})}},destroy:()=>{destroys++}})}));
const {SessionManager,setSessionPlatform}=await import('./packages/server-core/src/sessions/SessionManager.ts');setSessionPlatform({appRootPath:workspace,resourcesPath:workspace,isPackaged:false,logger:{info(){},warn(){},error(){},debug(){}}});const instance=Object.create(SessionManager.prototype);
const unknown=await instance.queryWorkspaceLlm('own',{prompt:'owned fixture'});known=true;const resolved=await instance.queryWorkspaceLlm('own',{prompt:'owned fixture'});
console.log(JSON.stringify({unknown,resolved,destroys,queries}));
`], { cwd: root, env: { ...process.env, ROX_CONFIG_DIR: fixture, CRAFT_CONFIG_DIR: fixture }, stdout: 'pipe', stderr: 'pipe' })
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect(exit).toBe(0)
  expect(stderr.replace(/Internal error: directory mismatch[^\n]*\n/g, '')).toBe('')
  const result = JSON.parse(stdout)
  expect(result.unknown).toEqual({text:'Controlled backend response',requestedModel:'requested-fixture',effectiveModel:null,warning:'Fallback model unknown'})
  expect(result.resolved).toEqual({text:'Controlled backend response',requestedModel:'requested-fixture',effectiveModel:'actual-fixture',model:'actual-fixture'})
  expect(result.queries).toEqual(['requested-fixture','requested-fixture'])
  expect(result.destroys).toBe(2)
 } finally { rmSync(fixture, {recursive:true,force:true}) }
}, 30000)

test('actual workspace one-shot respects selected durable budget and never releases unknown dispatched usage', async () => {
 const root = join(import.meta.dir, '../../../../../..')
 const fixture = mkdtempSync(join(tmpdir(), 'roadmap-budget-runtime-'))
 try {
  const config = join(fixture, 'tsconfig.json')
  writeFileSync(config, JSON.stringify({compilerOptions:{baseUrl:root,paths:{'@rox/shared/*':[join(root,'packages/shared/src/*')],'@rox/server-core/*':[join(root,'packages/server-core/src/*')],'@rox/core/*':[join(root,'packages/core/src/*')]}}}))
  const child = Bun.spawn([process.execPath, '--tsconfig-override', config, '-e', `
const {mock}=await import('bun:test');const {mkdirSync}=await import('node:fs');const {join}=await import('node:path');const {DatabaseSync}=await import('@rox/shared/utils/sqlite-runtime');
const {saveConfig}=await import('./packages/shared/src/config/storage.ts');const {saveWorkspaceConfig}=await import('./packages/shared/src/workspaces/storage.ts');
const workspace=join(process.env.ROX_CONFIG_DIR,'workspace');mkdirSync(workspace);saveConfig({workspaces:[{id:'own',name:'Own',rootPath:workspace,createdAt:1}],activeWorkspaceId:'own',activeSessionId:null});saveWorkspaceConfig(workspace,{id:'own',name:'Own',slug:'own',defaults:{dailyAgentBudgetUsd:1}});
const {setupI18n}=await import('@rox/shared/i18n');setupI18n();
const real=await import('@rox/shared/agent/backend');let mode='auth-error',created=0,queries=0,destroys=0;
const connection={slug:'fixture',name:'Fixture',providerType:'omp',authType:'none',defaultModel:'requested-fixture'};
mock.module('@rox/shared/agent/backend',()=>({...real,resolveOmpSessionContext:()=>({connection,resolvedModel:'requested-fixture',provider:'omp'}),createOmpSessionBackendFromResolvedContext:()=>{created++;return {postInit:async()=>mode==='auth-error'?{authInjected:false,authWarningLevel:'error',authWarning:'Controlled signed-out'}:{authInjected:true},queryLlm:async()=>{queries++;if(mode==='query-error')throw Error('Controlled dispatch error');return {text:'Controlled response',model:'actual-fixture'}},destroy:()=>{destroys++}}}}));
const {SessionManager,setSessionPlatform}=await import('./packages/server-core/src/sessions/SessionManager.ts');setSessionPlatform({appRootPath:workspace,resourcesPath:workspace,isPackaged:false,logger:{info(){},warn(){},error(){},debug(){}}});const instance=Object.create(SessionManager.prototype);
const checks=[];const check=(name,value)=>{if(!value)throw Error(name);checks.push(name)};const denied=async()=>{try{await instance.queryWorkspaceLlm('own',{prompt:'owned fixture'});return false}catch{return true}};
check('auth refusal',await denied());check('auth refusal zero dispatch',queries===0);check('pre-dispatch releases',instance.getAgentBudget('own').remainingUsd===1);
mode='success';const result=await instance.queryWorkspaceLlm('own',{prompt:'owned fixture'});check('success actual query',queries===1);check('unknown usage held',instance.getAgentBudget('own').unresolvedUsd===1);check('unknown warning visible',Boolean(result.warning));
const createdBefore=created;check('unknown repeat denies',await denied());check('denied zero backend or query',created===createdBefore&&queries===1);
const db=new DatabaseSync(join(process.env.ROX_CONFIG_DIR,'agent-budget.sqlite'));const run=db.prepare("SELECT run_id FROM agent_budget_runs WHERE state='unresolved'").get().run_id;
instance.reconcileAgentBudgetRun('own',run,'exact-owned-receipt',0.25);instance.reconcileAgentBudgetRun('own',run,'exact-owned-receipt',0.25);check('exact receipt idempotent',instance.getAgentBudget('own').spentUsd===0.25&&instance.getAgentBudget('own').remainingUsd===0.75);
let conflict=false;try{instance.reconcileAgentBudgetRun('own',run,'exact-owned-receipt',0.5)}catch{conflict=true}check('receipt conflict denies',conflict);
mode='query-error';check('dispatched error',await denied());check('error conservatively held',instance.getAgentBudget('own').unresolvedUsd===0.75&&queries===2);
const errorRun=db.prepare("SELECT run_id FROM agent_budget_runs WHERE state='unresolved'").get().run_id;instance.reconcileAgentBudgetRun('own',errorRun,'exact-owned-error-receipt',0.75);const beforeExhausted=created;check('spent limit denies',await denied());check('exhaustion zero dispatch',queries===2&&created===beforeExhausted);
instance.getAgentBudgetLedger().close();db.close();console.log(JSON.stringify({checks,created,queries,destroys}));
`], {cwd:root,env:{...process.env,ROX_CONFIG_DIR:fixture,CRAFT_CONFIG_DIR:fixture},stdout:'pipe',stderr:'pipe'})
  const [exit, stdout, stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()])
  expect({exit,stdout,stderr}).toMatchObject({exit:0})
  expect(stderr.replace(/Internal error: directory mismatch[^\n]*\n/g, '')).toBe('')
  const result=JSON.parse(stdout)
  expect(result.checks).toHaveLength(14)
  expect(result.queries).toBe(2)
  expect(result.destroys).toBe(result.created)
 } finally {rmSync(fixture,{recursive:true,force:true})}
}, 30000)
