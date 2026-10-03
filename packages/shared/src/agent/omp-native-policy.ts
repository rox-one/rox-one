import {cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync, rmSync, realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

export const OMP_NATIVE_POLICY_VERSION='18.4.12';
export const OMP_NATIVE_AGENT_SOURCE_SHA256='a51e06caf5e5f382c7f80c86030ae13a70ed4c7d0c1ac9f6d6ffc11c20d2c81e';
const seam='const expandedText = options?.synthetic ? templated : this.#modelMentions.expandMentions(templated);';
const replacement=`const expandedText = options?.synthetic ? templated : this.#roxRequiredModes(this.#modelMentions.expandMentions(templated));`;
const requiredModesMethod=`#roxRequiredModes(roxExpandedText: string): string {
        // ROX mandatory modes: after native slash/template expansion, before native notices.
        const roxFirstLine = roxExpandedText.split(/\\r?\\n/, 1)[0];
        const roxWords = roxFirstLine.trim().split(/\\s+/);
        const roxRequired = ["orchestrate", "workflowz", "ultrathink"];
        const roxBare = !/^(?: {4}|\\t)/.test(roxFirstLine) && roxWords.every(word => roxRequired.includes(word));
        const roxMissing = roxBare ? roxRequired.filter(word => !roxWords.includes(word)) : roxRequired;
        return roxMissing.length === 0 ? roxExpandedText : roxMissing.join(" ") + "\\n\\n" + roxExpandedText;
    }
    `;
const sha=(data:string)=>createHash('sha256').update(data).digest('hex');

/** Private, source-complete pinned overlay. Never modify the installed tarball.
 * Copy all source modules so Bun realpath resolution cannot return to the unpatched class.
 * Dependencies/assets stay linked to the verified native package, with an explicit provenance record.
 */
export function prepareOmpNativePolicy(packageDir:string,runtimeRoot:string):{packageDir:string;entry:string;dispose:()=>void} {
 packageDir=realpathSync(packageDir);
 const version=JSON.parse(readFileSync(join(packageDir,'package.json'),'utf8')).version;
 if(version!==OMP_NATIVE_POLICY_VERSION)throw new Error('Mandatory ROX native modes require pinned OMP 18.4.12');
 const source=readFileSync(join(packageDir,'src/session/agent-session.ts'),'utf8');
 if(sha(source)!==OMP_NATIVE_AGENT_SOURCE_SHA256||source.split(seam).length!==2)throw new Error('OMP native policy source integrity mismatch');
 const replaceOnce=(text:string,from:string,to:string)=>{
  if(text.split(from).length!==2)throw new Error('OMP native policy seam integrity mismatch');
  return text.replace(from,to);
 };
 let patched=replaceOnce(source,seam,replacement);
 const matcher='#createMagicKeywordNotices(text: string): CustomMessage[] {';
 patched=replaceOnce(patched,matcher,requiredModesMethod+matcher);
 patched=replaceOnce(patched,'keywordNotices = this.#createMagicKeywordNotices(skillArgs);','keywordNotices = this.#createMagicKeywordNotices(this.#roxRequiredModes(skillArgs));');
 patched=replaceOnce(patched,'const rawText = options?.rawText ?? text;\n\t\tconst preprocessed = options?.preprocessed;\n\t\tconst prependMessages = options?.prependMessages ?? [];',`const rawText = options?.rawText ?? text;
        const preprocessed = options?.preprocessed;
        const roxExistingPrepend = options?.prependMessages ?? [];
        if (attribution === "user") text = this.#roxRequiredModes(text);
        const prependMessages = attribution === "user" ? [...this.#createMagicKeywordNotices(text).filter(notice => !roxExistingPrepend.some(existing => existing.role === "custom" && existing.customType === notice.customType)), ...roxExistingPrepend] : roxExistingPrepend;`);
 mkdirSync(runtimeRoot,{recursive:true,mode:0o700});
 const overlay=mkdtempSync(join(runtimeRoot,'rox-native-policy-'));
 try{
  cpSync(join(packageDir,'src'),join(overlay,'src'),{recursive:true});
  for(const entry of readdirSync(packageDir,{withFileTypes:true})){
   if(entry.name==='src')continue;
   if(entry.isDirectory())symlinkSync(join(packageDir,entry.name),join(overlay,entry.name),process.platform==='win32'?'junction':undefined);
   else cpSync(join(packageDir,entry.name),join(overlay,entry.name),{dereference:false});
  }
  writeFileSync(join(overlay,'src/session/agent-session.ts'),patched,{mode:0o600});
  writeFileSync(join(overlay,'rox-native-policy.json'),JSON.stringify({version:OMP_NATIVE_POLICY_VERSION,sourceSha256:sha(source),patchedSha256:sha(patched),seam:'post-native-expansion/pre-native-keyword-notices',skillArgsCovered:true,queuedUserMessagesCovered:true,syntheticUnchanged:true},null,2)+'\n',{flag:'wx',mode:0o600});
  return {packageDir:overlay,entry:join(overlay,'src/cli.ts'),dispose:()=>rmSync(overlay,{recursive:true,force:true})};
 }catch(error){rmSync(overlay,{recursive:true,force:true});throw error;}
}
