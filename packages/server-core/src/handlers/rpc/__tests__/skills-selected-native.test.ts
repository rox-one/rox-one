import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import * as promises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HandlerDeps } from '../../handler-deps.ts';

const sandbox=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'selected-native-rpc-')));
const previous=process.env.ROX_CONFIG_DIR;
process.env.ROX_CONFIG_DIR=join(sandbox,'config');
let authority: import('../../../authority/native-authority.ts').NativeAuthority;
let server: import('../../../transport/server.ts').WsRpcServer;
let admin: import('../../../authority/native-authority.ts').NativeIssuedCredential;
let client: import('../../../transport/client.ts').WsRpcClient;
let reader: import('../../../authority/native-authority.ts').NativeIssuedCredential;
let channels: typeof import('@rox/shared/protocol').RPC_CHANNELS;
const root=join(sandbox,'workspace'),project=join(root,'project'),slug='selected-native-'+crypto.randomUUID();
function createSkill(directory:string,body:string){fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(join(directory,'SKILL.md'),'---\nname: Selected\ndescription: Canonical\n---\n'+body);}
beforeAll(async()=>{
 const {NativeAuthority}=await import('../../../authority/native-authority.ts');
 const {WsRpcServer}=await import('../../../transport/server.ts');
 const {WsRpcClient}=await import('../../../transport/client.ts');
 const {registerSkillsHandlers}=await import('../skills.ts');
 const {saveConfig}=await import('@rox/shared/config');
 channels=(await import('@rox/shared/protocol')).RPC_CHANNELS;
 fs.mkdirSync(project,{recursive:true});
 createSkill(join(root,'.omp','skills',slug),'Native selected 日本語 🔒');
 createSkill(join(project,'.agents','skills',slug),'Project canonical');
 saveConfig({workspaces:[{id:'selected-workspace',slug:'selected-workspace',name:'Selected',rootPath:root,createdAt:Date.now()}],activeWorkspaceId:'selected-workspace',activeSessionId:null});
 authority=new NativeAuthority({stateDir:join(sandbox,'authority')});
 const tty=Object.getOwnPropertyDescriptor(process.stdin,'isTTY');
 try{Object.defineProperty(process.stdin,'isTTY',{configurable:true,value:true});admin=authority.bootstrapLocalAdministrator('selected fixture');}finally{if(tty)Object.defineProperty(process.stdin,'isTTY',tty);else Reflect.deleteProperty(process.stdin,'isTTY');}
 authority.registerWorkspace(admin.credential,'selected-workspace',root);
 reader=authority.redeemEnrollment(authority.issueEnrollment(admin.credential,'reader',Date.now()+60000),'reader')!;
 authority.grantWorkspace(admin.credential,reader.principal.subject,'selected-workspace',['read']);
 server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,nativeAuthority:authority});
 registerSkillsHandlers(server,{platform:{},sessionManager:{getSessions:()=>[{workspaceId:'selected-workspace',workingDirectory:project}]}} as unknown as HandlerDeps);
 await server.listen();
 client=new WsRpcClient(`ws://127.0.0.1:${server.port}`,{token:reader.credential,workspaceId:'selected-workspace',autoReconnect:false,requestTimeout:5000});
},30000);
afterAll(async()=>{client?.destroy();await server?.close();authority?.close();if(previous===undefined)delete process.env.ROX_CONFIG_DIR;else process.env.ROX_CONFIG_DIR=previous;fs.rmSync(sandbox,{recursive:true,force:true});},30000);
test('registered authenticated selected port returns full OMP body and authorized project precedence',async()=>{
 const detail=await client.invoke(channels.skills.GET_DETAILS,'selected-workspace',slug) as {content:string;source:string};
 expect(detail.content).toBe('Native selected 日本語 🔒');expect(detail.source).toBe('omp');
 const projectDetail=await client.invoke(channels.skills.GET_DETAILS,'selected-workspace',slug,project) as {content:string;source:string};
 expect(projectDetail.content).toBe('Project canonical');expect(projectDetail.source).toBe('project');
 const list=await client.invoke(channels.skills.GET,'selected-workspace') as {slug:string;content:string}[];
 expect(list.find(item=>item.slug===slug)?.content).toBe('');
},30000);
test('workspace mismatch, foreign project and read-only mutation fail closed',async()=>{
 const foreign=join(sandbox,'foreign');createSkill(join(foreign,'.agents','skills',slug),'FOREIGN');
 await expect(client.invoke(channels.skills.GET_DETAILS,'other-workspace',slug)).rejects.toThrow();
 await expect(client.invoke(channels.skills.GET_DETAILS,'selected-workspace',slug,foreign)).rejects.toThrow();
 await expect(client.invoke(channels.skills.UPDATE,'selected-workspace',slug,{content:'write'})).rejects.toThrow();
 expect(fs.readFileSync(join(foreign,'.agents','skills',slug,'SKILL.md'),'utf8')).toContain('FOREIGN');
},30000);
test('revocation while canonical project validation awaits prevents body opening',async()=>{
 const original=promises.realpath,entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
 const held=spyOn(promises,'realpath').mockImplementation((async(path:any,...args:any[])=>{if(String(path)===project){entered.resolve();await release.promise;}return (original as any)(path,...args);}) as typeof promises.realpath);
 const originalOpen=fs.openSync, selected=fs.realpathSync(join(project,'.agents','skills',slug,'SKILL.md'));let reads=0;
 const open=spyOn(fs,'openSync').mockImplementation(((...args:Parameters<typeof fs.openSync>)=>{if(String(args[0])===selected)reads++;return originalOpen(...args);}) as typeof fs.openSync);
 try{
  const result=client.invoke(channels.skills.GET_DETAILS,'selected-workspace',slug,project).then(()=>false,()=>true);
  await entered.promise;authority.revokeWorkspaceGrant(admin.credential,reader.principal.subject,'selected-workspace');release.resolve();
  expect(await result).toBe(true);expect(reads).toBe(0);
 }finally{release.resolve();held.mockRestore();open.mockRestore();}
},30000);
