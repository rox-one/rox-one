/** Fail publication if the updater manifest points at missing or altered installers. */
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {statSync} from 'node:fs';
export async function verifyUpdateMetadata(folder:string,platform:string,version:string):Promise<string>{
  const name=platform==='darwin'?'latest-mac.yml':'latest.yml';
  const metadata=Bun.YAML.parse(await Bun.file(join(folder,name)).text()) as any;
  if(metadata.version!==version)throw new Error('Updater version mismatch');
  const expected=platform==='darwin'?['Rox-arm64.dmg','Rox-arm64.zip']:['Rox-x64.exe'];
  if(!Array.isArray(metadata.files)||JSON.stringify(metadata.files.map((f:any)=>f.url).sort())!==JSON.stringify(expected.sort()))throw new Error('Updater artifact set mismatch');
  for(const file of metadata.files){
    const path=join(folder,file.url);
    const hash=createHash('sha512');
    for await(const chunk of Bun.file(path).stream())hash.update(chunk);
    if(hash.digest('base64')!==file.sha512||statSync(path).size!==file.size)throw new Error('Updater SHA512/size mismatch: '+file.url);
  }
  const primary=metadata.files.find((f:any)=>f.url===(platform==='darwin'?'Rox-arm64.zip':'Rox-x64.exe'));
  if(metadata.path!==primary.url||metadata.sha512!==primary.sha512)throw new Error('Updater legacy path/hash mismatch');
  return name;
}
