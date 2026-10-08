import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, renameSync, openSync, closeSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { OMP_WORKER_POLICY_SOURCE } from '../../packages/shared/src/agent/omp-worker-policy.ts';
import { prepareOmpNativePolicy } from '../../packages/shared/src/agent/omp-native-policy.ts';
import { resolveConfigDir } from '../../packages/shared/src/config/paths.ts';
// Pinned Bun 1.3.14; optional ROX_OMP_PACKAGE_DIR points to a pinned 18.4.12 package.
// All provider responses are native in-memory fixtures; every fetch is forbidden.
export function writeWorkerEvidence(outputPath: string, evidence: unknown): void {
 const pending=join(dirname(outputPath), `.${basename(outputPath)}.${randomUUID()}.pending`);
 let created=false;
 try {
  const fd=openSync(pending,'wx',0o600);
  created=true;
  try { writeFileSync(fd,JSON.stringify(evidence,null,2)+'\n'); }
  finally { closeSync(fd); }
  // Replace the directory entry rather than following a pre-existing output symlink.
  renameSync(pending,outputPath);
 } finally {
  if(created)rmSync(pending,{force:true});
 }
}

async function main(): Promise<void> {
const root=mkdtempSync(join(tmpdir(),'rox-native-worker-loop-'));
process.env.PI_CODING_AGENT_DIR=join(root,'profile');
process.env.OMP_PROFILE='default';
let networkAttempts=0;
globalThis.fetch=async()=>{networkAttempts++;throw new Error('Fixture forbids all network');};
const originalBase=process.env.ROX_OMP_PACKAGE_DIR ?? join(resolveConfigDir(), 'toolchain', 'omp', '18.4.12', 'package');
const nativePolicy=process.env.ROX_OMP_NATIVE_POLICY==='1'?prepareOmpNativePolicy(originalBase,root):null;
const base=nativePolicy?.packageDir ?? originalBase;
const packageVersion=JSON.parse(readFileSync(join(base,'package.json'),'utf8')).version;
if(packageVersion!=='18.4.12')throw new Error('Expected pinned native OMP 18.4.12');
const outputPath=process.argv[2] ?? join(tmpdir(),'rox-native-worker-loop.json');
const {Settings}=await import(base+'/src/config/settings.ts');
const {AuthStorage}=await import(base+'/node_modules/@oh-my-pi/pi-ai/src/auth-storage.ts');
const {ModelRegistry}=await import(base+'/src/config/model-registry.ts');
const {createAgentSession}=await import(base+'/src/sdk.ts');
const {initializeExtensions}=await import(base+'/src/modes/runtime-init.ts');
const {SessionManager}=await import(base+'/src/session/session-manager.ts');
const {loadExtensions}=await import(base+'/src/extensibility/extensions/loader.ts');
const {createMockModel}=await import(base+'/node_modules/@oh-my-pi/pi-ai/src/providers/mock.ts');
const {getSupportedEfforts}=await import(base+'/node_modules/@oh-my-pi/pi-catalog/src/model-thinking.ts');
const {containsMagicKeyword}=await import(base+'/node_modules/@oh-my-pi/pi-tui/src/prompt/magic-keywords.ts');
const logs=join(root,'hooks.jsonl');
writeFileSync(join(root,'policy.js'),OMP_WORKER_POLICY_SOURCE);
writeFileSync(join(root,'observer.js'),`import {appendFileSync} from 'node:fs';
export default function(pi){for(const event of ['before_agent_start','context','tool_call'])pi.on(event,(e,c)=>{appendFileSync(${JSON.stringify(logs)},JSON.stringify({event,agent:c.agent,thinking:pi.getThinkingLevel(),toolName:e.toolName,input:e.input})+'\\n');});}`);
let session:any;
let auth:any;
try{
 const settings=Settings.isolated({'task.batch':false,'task.enableEffort':true,'task.maxEffort':'max','task.isolation.enabled':false,'async.enabled':false,'eval.tools.enabled':true,'magicKeywords.enabled':true,'magicKeywords.ultrathink':true,'magicKeywords.orchestrate':true,'magicKeywords.workflow':true,'providers.autoThinkingMaxEffort':'max','disabledProviders':['claude-plugins','agent-plugins','omp-plugins'],'modelRoles.default':'fixture/worker','modelRoles.task':'fixture/worker','modelRoles.smol':'fixture/worker'});
 auth=await AuthStorage.create(join(root,'auth.db'));
 const registry=new ModelRegistry(auth,join(root,'models.yml'),{settings,cacheDbPath:join(root,'cache.db')});
 const calls:any[]=[];
 let parentIssued=false;
 const mock=createMockModel({id:'worker',provider:'fixture',reasoning:true,handler:(context,options)=>{
  const tools=context.tools?.map(t=>t.name)??[];
  const child=tools.includes('yield');
  calls.push({child,tools,reasoning:options?.reasoning,systemPrompt:context.systemPrompt,messages:structuredClone(context.messages)});
  if(child)return {content:[{type:'toolCall',name:'yield',arguments:{data:{text:'CHILD_OK'}}}]};
  if(!parentIssued){parentIssued=true;return {content:[{type:'toolCall',name:'task',arguments:{agent:'fixture-scout',task:'Read-only child assignment',solutionSpace:'fixed deterministic fixture',effort:'lo'}}]};}
  return {content:['PARENT_OK']};
 }});
 registry.registerProvider('fixture',{api:'mock',baseUrl:'mock://',apiKey:'fixture-only',streamSimple:(_model,ctx,opt)=>mock.stream(mock,ctx,opt),models:[{id:'worker',name:'fixture worker',reasoning:true,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:200000,maxTokens:4096}]});
 const extensions=await loadExtensions([join(root,'policy.js'),join(root,'observer.js')],root);
 if(extensions.errors.length)throw new Error(JSON.stringify(extensions.errors));
 const result=await createAgentSession({cwd:root,agentDir:process.env.PI_CODING_AGENT_DIR,settings,authStorage:auth,modelRegistry:registry,model:registry.find('fixture','worker'),getApiKey:()=> 'fixture-only',thinkingLevel:'auto',toolNames:nativePolicy?['task','read','eval']:['task','read'],enableMCP:false,enableLsp:false,enableIrc:false,disableExtensionDiscovery:true,preloadedExtensions:extensions,sessionManager:SessionManager.inMemory(root),skills:[],rules:[],contextFiles:[],promptTemplates:nativePolicy?[{name:'fixture',description:'fixture',content:'NATIVE_SLASH_EXPANDED',filePath:join(root,'fixture.md')}]:[],slashCommands:[],systemPrompt:'Fixture parent. Dispatch one restricted worker; report its result.',autoApprove:true,inheritedSessionAgents:[{name:'fixture-scout',description:'isolated read-only fixture',systemPrompt:'Restricted specialist; do not spawn agents.',tools:['read'],thinkingLevel:'medium',model:['fixture/worker:medium'],source:'user'}]});
 session=result.session;
 await initializeExtensions(session,{mode:'rpc',reportRuntimeError:error=>{throw new Error(JSON.stringify(error));},reportSendError:(_action,error)=>{throw error;}});
 const events:any[]=[];
 session.subscribe(e=>{events.push(e);});
 await session.prompt(nativePolicy ? 'Dispatch the deterministic read-only child without caller-supplied modes.' : 'orchestrate workflowz ultrathink\n\nDispatch the deterministic read-only child.');
 let nativePolicyProof:any;
 if(nativePolicy){
  // The native in-memory mock model defaults to text-only; explicitly enable
  // vision on this fixture model so image preservation reaches the provider.
  session.agent.state.model.input.push('image');
  const beforeImage=calls.length;
  await session.prompt('',{images:[{type:'image',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',mimeType:'image/png'}]});
  const imageCall=calls.slice(beforeImage).find(call=>call.tools.length);
  if(!imageCall.messages.some(message=>message.role==='user'&&Array.isArray(message.content)&&message.content.some(block=>block.type==='image')))throw new Error('Image block not preserved');
  const noticesBeforeImage=calls[beforeImage-1].messages.filter(message=>message.role==='developer').length;
  if(imageCall.messages.filter(message=>message.role==='developer').length-noticesBeforeImage!==3)throw new Error('Image-only prompt missing actual native keyword notices');
  const beforeSlash=calls.length;await session.prompt('/fixture');
  const slashCall=calls.slice(beforeSlash).find(call=>call.tools.length);
  if(!slashCall.messages.some(message=>message.role==='user'&&JSON.stringify(message.content).includes('NATIVE_SLASH_EXPANDED')))throw new Error('Slash command did not expand');
  const beforeSynthetic=calls.length;await session.prompt('synthetic fixture',{synthetic:true});
  const syntheticCall=calls.slice(beforeSynthetic).find(call=>call.tools.length);
  const magicCount=(messages:any[])=>messages.filter(message=>message.role==='developer'&&/Multi-step reasoning:|User message: orchestration request|User message contains \*\*workflowz\*\*/.test(JSON.stringify(message.content))).length;
  if(magicCount(syntheticCall.messages)!==magicCount(slashCall.messages))throw new Error('Synthetic prompt acquired native notices');
  const beforeSkill=calls.length;
  await session.promptCustomMessage({customType:'skill-prompt',content:'Fixture skill instruction body',display:true,attribution:'user',details:{name:'fixture',args:'plain request'}});
  const skillCall=calls.slice(beforeSkill).find(call=>call.tools.length);
  if(magicCount(skillCall.messages)-magicCount(syntheticCall.messages)!==3)throw new Error('User skill args omitted native notices');
  const queueProof:any[]=[];
  for(const mode of ['steer','followUp']){
    const beforeQueue=calls.length;
    const previous=calls.at(-1);
    await session[mode]('plain queued request');
    const deadline=Date.now()+10000;
    while(calls.length===beforeQueue&&Date.now()<deadline)await Bun.sleep(10);
    await session.waitForIdle();
    const queuedCall=calls.slice(beforeQueue).find(call=>call.tools.length);
    if(!queuedCall||magicCount(queuedCall.messages)-magicCount(previous.messages)!==3)throw new Error('Queued user path omitted native notices: '+mode);
    queueProof.push(mode);
  }
  nativePolicyProof={...JSON.parse(readFileSync(join(base,'rox-native-policy.json'),'utf8')),imageOnlyNativeNotices:3,imagePreserved:true,slashExpanded:true,skillArgsNativeNotices:3,queuedUserNativeNotices:queueProof,syntheticNoticeSemanticsPreserved:true};
 }
 const hooks=existsSync(logs)?readFileSync(logs,'utf8').trim().split('\n').map(line=>JSON.parse(line)):[];
 const supportedMax=getSupportedEfforts(registry.find('fixture','worker')).at(-1);
 const textOf=(message:any)=>typeof message.content==='string'?message.content:(message.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('\n');
 const agentCalls=calls.filter(call=>call.tools.length);
 const child=calls.find(call=>call.child);
 if(!child)throw new Error('Child provider was not invoked');
 if(JSON.stringify(child.tools)!==JSON.stringify(['read','yield']))throw new Error('Native child tool restrictions changed');
 if(agentCalls.some(call=>call.reasoning!==supportedMax))throw new Error('Provider received reduced thinking');
 if(agentCalls.some(call=>!['orchestrate','workflowz','ultrathink'].every(word=>call.messages.some(message=>message.role==='user'&&containsMagicKeyword(textOf(message),word)))))throw new Error('Provider user projection lacks required prose words');
 if(agentCalls.some(call=>!JSON.stringify(call.systemPrompt).includes('ROX mandatory execution policy')))throw new Error('Native worker omitted inherited system policy');
 const taskResult=events.find(event=>event.type==='tool_execution_end'&&event.toolName==='task');
 if(taskResult?.isError||!JSON.stringify(taskResult?.result).includes('CHILD_OK'))throw new Error('Actual task/yield loop failed');
 const nativeNotices=child.messages.filter(message=>message.role==='developer').map(textOf);
 if(nativeNotices.length!==1||!nativeNotices[0].includes('Multi-step reasoning'))throw new Error('Restricted worker native keyword notices violated capabilities');
 const revisedTask=agentCalls.at(-1).messages.find(message=>message.role==='assistant')?.content.find(block=>block.type==='toolCall'&&block.name==='task')?.arguments;
 if(!containsMagicKeyword(revisedTask?.task??'','workflowz'))throw new Error('Native task execution did not preserve assignment revision');
 if(networkAttempts)throw new Error('Unexpected network attempt');
 const evidence={nativePolicy:nativePolicyProof,scope:'Full native SDK parent prompt, actual task tool dispatch and restricted child provider loop using native in-memory mock stream. No external API or credentials.',ompVersion:packageVersion,networkAttempts,paidProviderRequests:0,requestedThinking:'max',supportedMaximum:supportedMax,parentThinking:session.thinkingLevel,parentInitialThinking:'auto',childDefaultThinking:'medium',callerEffort:'lo',parentTools:session.getEnabledToolNames(),revisedTask,requests: calls.map(call=>({kind:call.child?'child':call.tools.length?'parent':'native-task-label-auxiliary',tools:call.tools,reasoning:call.reasoning,systemPolicyPresent:JSON.stringify(call.systemPrompt).includes('ROX mandatory execution policy'),projectedUserText:call.messages.filter(message=>message.role==='user').map(textOf),nativeNoticeText:call.messages.filter(message=>message.role==='developer').map(textOf)})),hooks,taskResult:taskResult.result,assertionsPassed:true,boundary:'Native task label generation is a separate tool-free auxiliary completion without AgentSession thinking/context hooks; its text inherits the assignment keywords. No installed-app or remote provider acceptance.'};
 writeWorkerEvidence(outputPath,evidence);
 console.log(JSON.stringify({networkAttempts,requests:evidence.requests.map(call=>({kind:call.kind,tools:call.tools,reasoning:call.reasoning})),hooks:hooks.length,parentThinking:session.thinkingLevel,supportedMax,assertionsPassed:true}));
}finally{await session?.dispose();auth?.close?.();nativePolicy?.dispose();rmSync(root,{recursive:true,force:true});}
}

if(import.meta.main)await main();
