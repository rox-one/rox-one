import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('roadmap RPCs fence workspace/local callers and preserve unknown effective model warnings', async () => {
 const root = process.env.ROADMAP_IMPLEMENTATION_CHECKOUT ?? join(import.meta.dir, '../../../../../..')
 const transport = process.env.ROADMAP_TRANSPORT_CHECKOUT ?? root
 const fixture = mkdtempSync(join(tmpdir(), 'roadmap-boundary-runtime-'))
 try {
  const protocol = join(root, 'packages/shared/src/protocol/index.ts')
  const config = join(fixture, 'tsconfig.json')
  writeFileSync(config, JSON.stringify({compilerOptions:{baseUrl:fixture,paths:{'@craft-agent/shared/protocol':[protocol],'@craft-agent/shared/*':[join(root,'packages/shared/src/*')],'@craft-agent/core/*':[join(transport,'packages/core/src/*')],'@craft-agent/server-core/*':[join(transport,'packages/server-core/src/*')]}}}))
  const child = Bun.spawn([process.execPath, '--tsconfig-override', config, '-e', `
const {mkdirSync,readFileSync}=await import('node:fs');const {join}=await import('node:path');const root=process.env.ROX_CONFIG_DIR;
const {saveConfig}=await import(${JSON.stringify(join(root,'packages/shared/src/config/storage.ts'))});
const {createProject}=await import(${JSON.stringify(join(root,'packages/shared/src/projects/storage.ts'))});
const {saveProjectRoadmap,loadProjectRoadmap}=await import(${JSON.stringify(join(root,'packages/shared/src/projects/roadmap-storage.ts'))});
const {registerProjectsHandlers}=await import(${JSON.stringify(join(root,'packages/server-core/src/handlers/rpc/projects.ts'))});
const {WsRpcServer}=await import(${JSON.stringify(join(transport,'packages/server-core/src/transport/server.ts'))});const {WsRpcClient}=await import(${JSON.stringify(join(transport,'packages/server-core/src/transport/client.ts'))});
const {createLocalClientBindingRegistry}=await import(${JSON.stringify(join(transport,'apps/electron/src/main/local-client-binding.ts'))});
const own=join(root,'own'),foreign=join(root,'foreign');mkdirSync(own);mkdirSync(foreign);saveConfig({workspaces:[{id:'own',name:'Own',rootPath:own,createdAt:1},{id:'foreign',name:'Foreign',rootPath:foreign,createdAt:1}],activeWorkspaceId:'own',activeSessionId:null});
const ownProject=createProject(own,{name:'Own fixture'}),foreignProject=createProject(foreign,{name:'Foreign fixture'});saveProjectRoadmap(foreign,foreignProject.slug,{goal:'FOREIGN PRIVATE FIXTURE'});const foreignBefore=readFileSync(join(foreign,'projects',foreignProject.slug,'roadmap.json'),'utf8');
const registry=createLocalClientBindingRegistry(),renderer={};let window={webContentsId:41,renderer,workspaceId:'own'};const proof=registry.issue(renderer);let queries=0;
const server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,validateToken:async token=>token==='owned-fixture',resolveLocalClientBinding:candidate=>registry.resolve(candidate,id=>id===41?window:null)});
registerProjectsHandlers(server,{platform:{logger:{info(){},warn(){},error(){},debug(){}}},sessionManager:{describeWorkspaceLlm:id=>({available:true,connectionName:id+'-configuration',model:'requested-fixture'}),queryWorkspaceLlm:async(id)=>{if(id!=='own')throw Error('foreign dispatch');queries++;return {text:'Improved fixture',requestedModel:'requested-fixture',effectiveModel:null,warning:'Fallback model unknown'};}}});await server.listen();
const clients=[],checks=[];function client(bound=true){const c=new WsRpcClient('ws://127.0.0.1:'+server.port,{token:'owned-fixture',workspaceId:'own',webContentsId:41,localClientProof:bound?proof:undefined,mode:'local',autoReconnect:false,requestTimeout:1000,connectTimeout:1000});clients.push(c);c.connect();return c;}const check=(name,value)=>{if(!value)throw Error(name);checks.push(name)};const denied=async fn=>{try{await fn();return false}catch{return true}};
try{
 const c=client();const read=await c.invoke('projects:getRoadmap','own',ownProject.slug);check('own read',read.exists===false);const saved=await c.invoke('projects:saveRoadmap','own',ownProject.slug,{...read.roadmap,goal:'OWN UPDATED'});check('own save',saved.goal==='OWN UPDATED');check('own status',(await c.invoke('projects:aiStatus','own')).available===true);
 for(const [channel,args] of [['projects:getRoadmap',['foreign',foreignProject.slug]],['projects:saveRoadmap',['foreign',foreignProject.slug,{goal:'FORBIDDEN'}]],['projects:aiStatus',['foreign']],['projects:aiRoadmap',['foreign',foreignProject.slug,{mode:'improve',text:'foreign input'}]]])check('foreign denied '+channel,await denied(()=>c.invoke(channel,...args)));
 check('foreign bytes retained',readFileSync(join(foreign,'projects',foreignProject.slug,'roadmap.json'),'utf8')===foreignBefore);check('no foreign query',queries===0);
 const response=await c.invoke('projects:aiRoadmap','own',ownProject.slug,{mode:'improve',text:'owned input'});check('unknown effective preserved',response.ok&&response.effectiveModel===null&&response.model===undefined);check('requested separate',response.requestedModel==='requested-fixture');check('warning preserved',response.warning==='Fallback model unknown');
 check('unbound denied',await denied(()=>client(false).invoke('projects:aiStatus','own')));window={...window,workspaceId:'foreign'};check('stale binding denied',await denied(()=>c.invoke('projects:getRoadmap','own',ownProject.slug)));console.log(JSON.stringify(checks));
}finally{for(const c of clients)c.destroy();await Bun.sleep(20);server.close();}process.exit(0);
`], { cwd: root, env: { ...process.env, ROX_CONFIG_DIR: fixture, CRAFT_CONFIG_DIR: fixture }, stdout: 'pipe', stderr: 'pipe' })
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect({exit,stdout,stderr}).toMatchObject({exit:0})
  expect(stderr.replace(/Internal error: directory mismatch[^\n]*\n/g, '')).toBe('')
  expect(JSON.parse(stdout)).toHaveLength(14)
 } finally { rmSync(fixture, {recursive:true,force:true}) }
}, 15000)
