/** Publish only successful desktop builds whose exact source is already in main. */
import {$} from 'bun';
import {join} from 'node:path';
import {mkdtempSync,readdirSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {verifyUpdateMetadata} from './verify-update-metadata';
const [runId,tag]=process.argv.slice(2);
if(!/^\d+$/.test(runId??'')||!/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tag??''))throw new Error('Expected numeric run ID and version tag');
const repo='rox-one/rox-one';
const run=JSON.parse(await $`gh run view ${runId} -R ${repo} --json conclusion,headSha,workflowName`.text());
if(run.conclusion!=='success'||run.workflowName!=='Desktop Release Build')throw new Error('Build workflow did not succeed');
await $`git merge-base --is-ancestor ${run.headSha} origin/main`.quiet();
async function release(){return JSON.parse(await $`gh api ${`repos/${repo}/releases`}`.text()).find((r:any)=>r.tag_name===tag)}
const draft=await release();
if(!draft?.draft||draft.target_commitish!==run.headSha)throw new Error('Draft release must target the exact successful build commit');
const root=mkdtempSync(join(tmpdir(),'rox-desktop-publish-'));
const records:{name:string;path:string;size:number;sha256:string}[]=[];
async function record(path:string,name:string){const hash=createHash('sha256');for await(const chunk of Bun.file(path).stream())hash.update(chunk);return {path,name,size:statSync(path).size,sha256:hash.digest('hex')}}
try{
for(const [dir,platform,arch] of [['macos','darwin','arm64'],['windows','win32','x64']]){
  const folder=join(root,dir);
  await $`gh run download ${runId} -R ${repo} --name ${`desktop-${platform}-${arch}`} --dir ${folder}`;
  const manifestName=`manifest-${platform}-${arch}.json`;
  const manifestPath=join(folder,manifestName);
  const m=await Bun.file(manifestPath).json();
  if(m.commit!==run.headSha||m.version!==tag.slice(1)||m.platform!==platform||m.arch!==arch)throw new Error('Manifest identity mismatch');
  const expected=platform==='darwin'?['Rox-arm64.dmg','Rox-arm64.zip']:['Rox-x64.exe'];
  if(JSON.stringify(m.artifacts.map((a:any)=>a.name).sort())!==JSON.stringify(expected.sort()))throw new Error('Artifact set mismatch');
  for(const artifact of m.artifacts){
    const local=await record(join(folder,artifact.name),artifact.name);
    if(local.size!==artifact.size||local.sha256!==artifact.sha256)throw new Error('Checksum mismatch: '+artifact.name);
    records.push(local);console.log('Verified',local.name,local.size,local.sha256);
  }
  const channelName=await verifyUpdateMetadata(folder,platform,tag.slice(1));
  records.push(await record(join(folder,channelName),channelName));
  records.push(await record(manifestPath,manifestName));
  for(const name of readdirSync(folder).filter(n=>expected.some(name=>n===name+'.blockmap')))records.push(await record(join(folder,name),name));
}
const checksums=join(root,'SHA256SUMS.txt');
await Bun.write(checksums,records.filter(r=>/\.(dmg|zip|exe)$/.test(r.name)).map(r=>`${r.sha256}  ${r.name}`).join('\n')+'\n');
records.push(await record(checksums,'SHA256SUMS.txt'));
// An interrupted upload can resume only when existing assets have identical digests.
const missing:string[]=[];
for(const local of records){const existing=draft.assets.find((a:any)=>a.name===local.name);if(existing){if(existing.size!==local.size||existing.digest!==`sha256:${local.sha256}`)throw new Error('Existing release asset differs: '+local.name)}else missing.push(local.path)}
if(missing.length)await $`gh release upload ${tag} -R ${repo} ${missing}`;
const uploaded=await release();
for(const local of records){const remote=uploaded.assets.find((a:any)=>a.name===local.name);if(!remote||remote.size!==local.size||remote.digest!==`sha256:${local.sha256}`)throw new Error('Remote digest mismatch: '+local.name)}
await $`gh release edit ${tag} -R ${repo} --draft=false --prerelease`;
const published=await release();
if(published.draft||!published.prerelease)throw new Error('Release publication readback failed');
console.log('Published verified desktop prerelease',published.html_url);
}finally{rmSync(root,{recursive:true,force:true})}
