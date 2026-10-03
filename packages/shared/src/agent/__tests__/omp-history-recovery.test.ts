import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OmpAgent } from '../omp-agent.ts';
import { createFakeOmp, useFakeOmpEnv, makeOmpConfig, chatEvents, type FakeOmp } from './omp-fake-cli.ts';
let fake: FakeOmp; let restore: (() => void) | undefined; const agents: OmpAgent[] = [];
afterEach(() => { for (const agent of agents.splice(0)) agent.destroy(); restore?.(); fake?.cleanup(); });
function setup() { fake = createFakeOmp('healthy'); restore = useFakeOmpEnv(fake); const config = makeOmpConfig(fake); const agent = new OmpAgent(config); agents.push(agent); return { agent, config }; }
function transcript(dir: string, name: string, id: string) {
 mkdirSync(dir, { recursive: true }); const file = join(dir, name);
 writeFileSync(file, [
 {type:'session',version:3,id,timestamp:'2026-10-03T00:00:00.000Z',cwd:fake.workspaceRoot},
 {type:'message',id:'aaaa1111',parentId:null,message:{role:'user',content:[{type:'text',text:'remember BANANA'}],timestamp:1}},
 {type:'message',id:'bbbb2222',parentId:'aaaa1111',message:{role:'assistant',content:[{type:'text',text:'BANANA'}],timestamp:2}},
 ].map(e=>JSON.stringify(e)).join('\n')+'\n'); return file;
}
describe('OMP persistent history and mandatory runtime modes', () => {
 it('restores saved identity before sending a new user prompt', async () => {
  const {agent,config} = setup(); const dir = join(fake.workspaceRoot,'sessions','session-test','omp');
  const file = transcript(dir,'2026-10-03_saved-id.jsonl','saved-id'); config.session!.sdkSessionId='saved-id'; agent.setSessionId('saved-id');
  await chatEvents(agent,'continue',15000);
  const log=fake.readRpcLog(); expect(log.find(f=>f.type==='switch_session')?.sessionPath).toBe(file);
  expect(log.findIndex(f=>f.type==='switch_session')).toBeLessThan(log.findIndex(f=>f.type==='prompt'));
 },20000);
 it('resumes the child transcript after destroying and recreating the adapter', async () => {
  const {agent,config}=setup(); await chatEvents(agent,'first turn',30000); agent.destroy();
  const second=new OmpAgent(config); agents.push(second); await chatEvents(second,'continued after restart',30000);
  expect(fake.readRpcLog().filter(f=>f.type==='switch_session').at(-1)?.sessionPath).toBe(fake.transcriptFile);
 },45000);
 it('clearing history starts a new context rather than resuming the old transcript', async () => {
  const {agent}=setup(); await chatEvents(agent,'first turn',30000); agent.clearHistory(); await chatEvents(agent,'fresh turn',30000);
  expect(fake.readRpcLog().filter(f=>f.type==='switch_session')).toHaveLength(0);
 },45000);
 it('starts fresh after an empty clear even if old sdk identity remains persisted',async()=>{
  const {agent,config}=setup();await chatEvents(agent,'first',30000);config.session!.sdkSessionId='fake-omp-session-id';agent.clearHistory();agent.destroy();config.getResumeMessages=()=>[];
  const second=new OmpAgent(config);agents.push(second);expect((await chatEvents(second,'fresh after restart',30000)).some(e=>e.type==='text_complete')).toBe(true);expect(fake.readRpcLog().some(f=>f.type==='switch_session')).toBe(false);
 },60000);
 it('keeps a persisted reset across restart and reconstructs only retained ROX history',async()=>{
  const {agent,config}=setup();await chatEvents(agent,'first turn',30000);agent.clearHistory();agent.destroy();
  config.getResumeMessages=()=>[{id:'retained-user',role:'user',content:'retained question',timestamp:1},{id:'retained-answer',role:'assistant',content:'retained answer',timestamp:2}];
  const second=new OmpAgent(config);agents.push(second);await chatEvents(second,'continue after undo',30000);
  const switches=fake.readRpcLog().filter(f=>f.type==='switch_session');expect(String(switches.at(-1)?.sessionPath)).toContain('recovered-');
 },60000);
 it('kills a child after rejected restoration and retries the same saved history',async()=>{
  const {agent}=setup();fake.setScenario('restore-reject');const dir=join(fake.workspaceRoot,'sessions','session-test','omp');const file=transcript(dir,'saved.jsonl','saved');writeOmpIdentity(dir,'saved',file);
  expect((await chatEvents(agent,'must not run empty',30000)).some(e=>e.type==='error')).toBe(true);fake.setScenario('healthy');
  expect((await chatEvents(agent,'retry',30000)).some(e=>e.type==='text_complete')).toBe(true);
  expect(fake.readArgvLog()).toHaveLength(2);expect(fake.readRpcLog().filter(f=>f.type==='prompt')).toHaveLength(1);expect(fake.readRpcLog().filter(f=>f.type==='switch_session')).toHaveLength(2);
 },60000);
 it('applies all three native magic modes on every turn without duplicating existing directives', async () => {
  const {agent}=setup(); await chatEvents(agent,'question one',15000); await chatEvents(agent,'orchestrate workflowz ultrathink\nquestion two',15000);
  const prompts=fake.readRpcLog().filter(f=>f.type==='prompt');
  for(const p of prompts) for(const word of ['orchestrate','workflowz','ultrathink']) expect(String(p.message).match(new RegExp('\\b'+word+'\\b','g'))).toHaveLength(1);
  expect(fake.readRpcLog().filter(f=>f.type==='set_thinking_level' && f.level==='max')).toHaveLength(2);
 },30000);
 it('forks a private copy at the exact assistant anchor and leaves the parent unchanged', async () => {
  const {agent,config}=setup(); const parentDir=join(fake.workspaceRoot,'sessions','parent','omp'); const file=transcript(parentDir,'2026-10-03_parent-id.jsonl','parent-id'); const before=readFileSync(file,'utf8');
  Object.assign(config.session!,{branchFromMessageId:'visible-answer',branchFromSessionPath:join(parentDir,'..'),branchFromSdkTurnId:'bbbb2222',branchFromSdkSessionId:'parent-id'});
  await chatEvents(agent,'new branch question',15000); const log=fake.readRpcLog();
  const switched=String(log.find(f=>f.type==='switch_session')?.sessionPath); expect(switched).not.toBe(file); expect(switched).toContain(join('session-test','omp'));
  expect(log.find(f=>f.type==='fork')?.entryId).toBe('bbbb2222'); expect(readFileSync(file,'utf8')).toBe(before);
 },20000);
});

import { readOmpResumeFile, writeOmpIdentity, seedOmpHistory, withOmpRequiredModes, resetOmpHistory } from '../omp-history.ts';
describe('OMP identity and legacy reconstruction',()=>{
 it('rejects identity path traversal and does not choose another transcript',()=>{setup();const dir=join(fake.dir,'identities');transcript(dir,'one.jsonl','one');writeFileSync(join(dir,'active-session.json'),JSON.stringify({version:1,sessionId:'one',file:'../one.jsonl'}));expect(()=>readOmpResumeFile(dir)).toThrow('Invalid persisted');});
 it('a reset tombstone prevents discovery of archived native transcripts',()=>{setup();const dir=join(fake.dir,'reset');transcript(dir,'old.jsonl','old');resetOmpHistory(dir);expect(readOmpResumeFile(dir,'old')).toBeNull();expect(readOmpResumeFile(dir)).toBeNull();});
 it('rejects a corrupt interior JSONL record rather than silently dropping context',()=>{setup();const dir=join(fake.dir,'corrupt');const file=transcript(dir,'corrupt.jsonl','corrupt');writeOmpIdentity(dir,'corrupt',file);writeFileSync(file,readFileSync(file,'utf8')+'not json\n');expect(()=>readOmpResumeFile(dir)).toThrow('Corrupt OMP transcript');});
 it('reads the native OMP18 fixed-width title slot before its session header',()=>{setup();const dir=join(fake.dir,'titled');const file=transcript(dir,'titled.jsonl','titled');const title={type:'title',v:1,title:'native title',updatedAt:'2026-10-03T00:00:00.000Z',pad:''};writeFileSync(file,JSON.stringify(title)+'\n'+readFileSync(file,'utf8'));writeOmpIdentity(dir,'titled',file);expect(readOmpResumeFile(dir,'titled')).toBe(file);});
 it('pins an atomic active identity independently of newer transcript filenames',()=>{setup();const dir=join(fake.dir,'identities');const selected=transcript(dir,'older.jsonl','old');transcript(dir,'newer.jsonl','new');writeOmpIdentity(dir,'old',selected);expect(readOmpResumeFile(dir)).toBe(selected);});
 it('reconstructs complete tool pairs with provenance and preserves every stored message',()=>{setup();const dir=join(fake.dir,'migrated');const file=seedOmpHistory(dir,fake.workspaceRoot,[{id:'u',role:'user',content:'question',timestamp:1},{id:'t',role:'tool',content:'answer',toolName:'read',toolUseId:'call-1',toolInput:{path:'a.txt'},timestamp:2},{id:'a',role:'assistant',content:'result',timestamp:3}],'resume')!;const entries=readFileSync(file,'utf8').trim().split('\n').map(l=>JSON.parse(l));expect(entries[1].customType).toBe('rox-history-reconstruction');expect(entries.filter(e=>e.type==='message').map(e=>e.message.role)).toEqual(['user','assistant','toolResult','assistant']);expect(entries.find(e=>e.message?.role==='toolResult').message.toolCallId).toBe('call-1');});
 it('adds native prose directives when words occur in quoted or fenced first lines',()=>{for(const prefix of ['> ', '``` ', '    ']) {const result=withOmpRequiredModes(prefix+'orchestrate workflowz ultrathink\nquoted task'); expect(result.startsWith('orchestrate workflowz ultrathink\n\n')).toBe(true);}});
 it('adds native prose directives even when matching words occur in a code block',()=>{const result=withOmpRequiredModes('```\norchestrate workflowz ultrathink\n```');expect(result.startsWith('orchestrate workflowz ultrathink\n\n')).toBe(true);});
});
