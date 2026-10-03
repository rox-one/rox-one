import {join} from 'node:path';
const root='/Users/t/Projects/rox-one-recheck-candidate-20261003';
const dir=join(root,'docs/final-readiness/parallel-work/postmerge/e0740755da02fa31112216b1a32b6d707c3a2cc1/platforms-final/compiled');
const entries=['scripts/verify-update-metadata.ts','scripts/desktop-release.ts','scripts/publish-desktop-release.ts','apps/electron/src/main/auto-update.ts'];
for(const entry of entries){const result=await Bun.build({entrypoints:[join(root,entry)],target:'bun',packages:'external',outdir:join(dir,entry.replaceAll('/','_').replace(/\.ts$/,''))});if(!result.success){console.error(result.logs);process.exit(1)}console.log(JSON.stringify({entry,success:true,outputs:result.outputs.map(x=>({path:x.path,size:x.size})),scope:'Parse/bundle/module-resolution check only; compiled module not executed'}))}
