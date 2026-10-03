import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyUpdateMetadata} from '/Users/t/Projects/rox-one-recheck-candidate-20261003/scripts/verify-update-metadata.ts';
const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true})});
function fixture(platform:string,arch='arm64'){
 const dir=mkdtempSync(join(tmpdir(),'rox-update-metadata-fixture-'));dirs.push(dir);
 const names=platform==='darwin'?[`Rox-${arch}.dmg`,`Rox-${arch}.zip`]:['Rox-x64.exe'];
 const files=names.map(name=>{const bytes=Buffer.from(`synthetic installer fixture ${name}`);writeFileSync(join(dir,name),bytes);return {url:name,size:bytes.length,sha512:createHash('sha512').update(bytes).digest('base64')}});
 const primary=files.find(f=>f.url.endsWith(platform==='darwin'?'.zip':'.exe'))!;
 const metadata:any={version:'0.11.7',files,path:primary.url,sha512:primary.sha512};
 const name=platform==='darwin'?'latest-mac.yml':'latest.yml';
 function save(){writeFileSync(join(dir,name),Bun.YAML.stringify(metadata))}save();return {dir,name,metadata,files,save};
}
describe('actual e074 updater metadata verifier with isolated local installers',()=>{
 for(const platform of ['darwin','win32']){
  test(`${platform} accepts correct version, set, SHA512, size and legacy primary`,async()=>{const f=fixture(platform);expect(await verifyUpdateMetadata(f.dir,platform,'0.11.7')).toBe(f.name)});
  test(`${platform} rejects wrong release version`,async()=>{const f=fixture(platform);await expect(verifyUpdateMetadata(f.dir,platform,'0.11.8')).rejects.toThrow('Updater version mismatch')});
  test(`${platform} rejects modified installer bytes`,async()=>{const f=fixture(platform);writeFileSync(join(f.dir,f.files[0].url),'altered installer');await expect(verifyUpdateMetadata(f.dir,platform,'0.11.7')).rejects.toThrow('Updater SHA512/size mismatch')});
  test(`${platform} rejects correct hash with wrong declared size`,async()=>{const f=fixture(platform);f.files[0].size++;f.save();await expect(verifyUpdateMetadata(f.dir,platform,'0.11.7')).rejects.toThrow('Updater SHA512/size mismatch')});
  test(`${platform} rejects mismatched legacy primary path`,async()=>{const f=fixture(platform);f.metadata.path='unrelated.zip';f.save();await expect(verifyUpdateMetadata(f.dir,platform,'0.11.7')).rejects.toThrow('Updater legacy path/hash mismatch')});
  test(`${platform} rejects mismatched legacy primary hash`,async()=>{const f=fixture(platform);f.metadata.sha512='invalid';f.save();await expect(verifyUpdateMetadata(f.dir,platform,'0.11.7')).rejects.toThrow('Updater legacy path/hash mismatch')});
  test(`${platform} rejects unexpected/traversal installer references before file read`,async()=>{const f=fixture(platform);f.files[0].url='../outside-installer.exe';f.save();await expect(verifyUpdateMetadata(f.dir,platform,'0.11.7')).rejects.toThrow('Updater artifact set mismatch')});
  test(`${platform} rejects absent manifest`,async()=>{const f=fixture(platform);rmSync(join(f.dir,f.name));await expect(verifyUpdateMetadata(f.dir,platform,'0.11.7')).rejects.toThrow()});
 }
 test('macOS missing ZIP cannot pass verification',async()=>{const f=fixture('darwin');rmSync(join(f.dir,'Rox-arm64.zip'));await expect(verifyUpdateMetadata(f.dir,'darwin','0.11.7')).rejects.toThrow()});
 test('macOS duplicate installer references are rejected',async()=>{const f=fixture('darwin');f.metadata.files=[f.files[0],f.files[0]];f.save();await expect(verifyUpdateMetadata(f.dir,'darwin','0.11.7')).rejects.toThrow('Updater artifact set mismatch')});
 test('current verifier has an ARM64-only Mac contract: valid Intel pair is rejected',async()=>{const f=fixture('darwin','x64');await expect(verifyUpdateMetadata(f.dir,'darwin','0.11.7')).rejects.toThrow('Updater artifact set mismatch')});
});
