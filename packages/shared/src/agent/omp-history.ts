/** Native transcript identity and explicit one-time migration from ROX history. */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Message } from '@rox/core/types';

export const OMP_REQUIRED_KEYWORDS = ['orchestrate', 'workflowz', 'ultrathink'] as const;
/** Native matcher only accepts standalone lowercase prose. A separate directive avoids code/quotation exclusions. */
export function withOmpRequiredModes(message: string): string {
  // A bare initial directive is the only form we trust as already activated.
  const rawFirstLine = message.split('\n', 1)[0]!;
  const firstLine = /^(?: {4}|\t)/.test(rawFirstLine) ? '' : rawFirstLine.trim();
  const tokens = firstLine.split(/\s+/);
  const active = tokens.length && tokens.every(token => (OMP_REQUIRED_KEYWORDS as readonly string[]).includes(token)) ? tokens : [];
  const missing = OMP_REQUIRED_KEYWORDS.filter(word => !active.includes(word));
  return missing.length ? `${missing.join(' ')}\n\n${message}` : message;
}
export interface OmpIdentity { version: 1; sessionId: string; file: string }
function confined(dir: string, file: string): boolean {
  return existsSync(file) && dirname(realpathSync(file)) === realpathSync(dir);
}
function header(file: string): { type?: string; id?: string } {
  const records=readFileSync(file,'utf8').split('\n').filter(line=>line.trim()).map((line,index)=>{
    let record: unknown;
    try {record=JSON.parse(line);} catch {throw new Error(`Corrupt OMP transcript JSON at line ${index+1}`);}
    if(!record || typeof record!=='object' || Array.isArray(record) || typeof (record as {type?:unknown}).type!=='string') throw new Error(`Invalid OMP transcript record at line ${index+1}`);
    return record as {type?:string;id?:string};
  });
  // OMP 18.4.12 may prefix the session header with its fixed-width mutable title slot.
  const first=records[records[0]?.type==='title' ? 1 : 0];
  if(!first || first.type!=='session' || !first.id) throw new Error('OMP transcript has no valid session header');
  return first;
}
export function readOmpResumeFile(dir: string, sessionId?: string | null): string | null {
  if (!existsSync(dir)) return null;
  const identityPath=join(dir,'active-session.json');
  if (existsSync(identityPath)) {
    const identity=JSON.parse(readFileSync(identityPath,'utf8')) as OmpIdentity;
    if (identity.version === 1 && (identity as unknown as {cleared?:boolean}).cleared === true) return null;
    if(identity.version!==1 || basename(identity.file)!==identity.file || !identity.sessionId) throw new Error('Invalid persisted OMP session identity');
    const file=join(dir,identity.file);
    if(!confined(dir,file) || header(file).id!==identity.sessionId) throw new Error('Persisted OMP transcript is missing or does not match its identity');
    return file;
  }
  const files=readdirSync(dir).filter(name=>name.endsWith('.jsonl')).map(name=>join(dir,name))
    .filter(file=>confined(dir,file));
  const eligible=files.filter(file=>{
    const h=header(file); return (!sessionId || h.id===sessionId) && readFileSync(file,'utf8').split('\n').some(line=>line.includes('"message"'));
  }).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs);
  // Only discover an unambiguous transcript without a persisted identity.
  if(!sessionId && eligible.length>1) throw new Error('Multiple OMP transcripts exist without a saved active identity');
  return eligible[0]??null;
}
export function writeOmpIdentity(dir: string, sessionId: string, file: string): void {
  if(dirname(resolve(file))!==resolve(dir)) throw new Error('OMP active transcript escaped its ROX session directory');
  mkdirSync(dir,{recursive:true});
  const path=join(dir,'active-session.json'), temp=join(dir,`.active-${randomUUID()}.tmp`);
  writeFileSync(temp,JSON.stringify({version:1,sessionId,file:basename(file)} satisfies OmpIdentity)+'\n',{mode:0o600}); renameSync(temp,path);
}
/** Durable invalidation prevents an app restart from resurrecting undone native messages. */
export function resetOmpHistory(dir: string): void {
  mkdirSync(dir,{recursive:true});
  const temp=join(dir,`.active-${randomUUID()}.tmp`);
  writeFileSync(temp,JSON.stringify({version:1,cleared:true})+'\n',{mode:0o600});
  renameSync(temp,join(dir,'active-session.json'));
}
export function isOmpHistoryReset(dir: string): boolean {
  try {const state=JSON.parse(readFileSync(join(dir,'active-session.json'),'utf8'));return state.version===1&&state.cleared===true;} catch {return false;}
}
/** Migration retains all stored text/tool pairs, never pretends to recover absent provider metadata. */
export function seedOmpHistory(dir: string, cwd: string, messages: Message[], reason: 'resume'|'branch'): string | null {
  const history=messages.filter(m=>!m.isStreaming && (m.role==='user'||m.role==='assistant'||m.role==='tool'));
  if(!history.length) return null;
  mkdirSync(dir,{recursive:true}); const sessionId=randomUUID(); const file=join(dir,`recovered-${Date.now()}_${sessionId}.jsonl`);
  const now=new Date().toISOString(); const entries: Record<string,unknown>[]=[{type:'session',version:3,id:sessionId,timestamp:now,cwd},
    {type:'custom',id:randomUUID().slice(0,8),parentId:null,timestamp:now,customType:'rox-history-reconstruction',data:{reason,source:'ROX stored messages',providerMetadataRecovered:false}}];
  let parentId=entries[1]!.id as string;
  const append=(message: Record<string,unknown>, sourceId: string)=>{const id=randomUUID().slice(0,8); entries.push({type:'message',id,parentId,timestamp:now,message,roxMessageId:sourceId}); parentId=id;};
  const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
  for(const m of history) {
    const timestamp=m.timestamp||Date.now();
    if(m.role==='tool') {
      const toolCallId=m.toolUseId||`recovered-${m.id}`;
      append({role:'assistant',content:[{type:'toolCall',id:toolCallId,name:m.toolName||'unknown',arguments:m.toolInput||{}}],api:'openai-completions',provider:'rox',model:'reconstructed',usage,stopReason:'toolUse',timestamp},m.id);
      append({role:'toolResult',toolCallId,toolName:m.toolName||'unknown',content:[{type:'text',text:m.toolResult??m.content}],isError:m.isError??false,timestamp},m.id);
    } else {
      const attachmentRefs=m.attachments?.map(a=>`[Stored attachment: ${a.name}${a.storedPath?` at ${a.storedPath}`:''}]`).join('\n');
      const content=m.content+(attachmentRefs?`\n\n${attachmentRefs}`:'');
      append(m.role==='user'?{role:'user',content:[{type:'text',text:content}],timestamp}:{role:'assistant',content:[{type:'text',text:content}],api:'openai-completions',provider:'rox',model:'reconstructed',usage,stopReason:'stop',timestamp},m.id);
    }
  }
  writeFileSync(file,entries.map(e=>JSON.stringify(e)).join('\n')+'\n',{mode:0o600}); return file;
}
