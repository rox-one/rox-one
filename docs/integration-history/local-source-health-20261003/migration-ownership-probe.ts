import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const module = await import('REPLACE_WITH_EXACT_OWNED_CHECKOUT/packages/shared/src/sources/default-microservices.ts');
const migrate = module.migrateLegacyNativeDefault ?? module.migrationReviewBoundary;
const root = fs.mkdtempSync(join(tmpdir(), 'rox-migration-source-control-'));
try {
 const home = join(root, 'home');const target = join(root, 'target');const dir = join(root, 'sources', 'applications');
 fs.mkdirSync(home);fs.mkdirSync(target);fs.mkdirSync(dir,{recursive:true});
 const outside = join(root, 'outside-owned-file');const configPath=join(dir, 'config.json');
 const before=JSON.stringify({id:'ms-applications',slug:'applications',name:'Applications',icon:'🧩',tagline:'Applications and ~/Library/Applications',enabled:false,provider:'craft-local',type:'local',local:{path:'~/Applications',format:'markdown'},createdAt:123,updatedAt:456});
 fs.writeFileSync(outside,before);fs.symlinkSync(outside,configPath);fs.writeFileSync(join(dir,'guide.md'),'custom instructions');
 migrate(root,configPath,{slug:'applications',name:'Applications',icon:'🧩',tagline:'Native application folder and launch shortcuts',path:target,mkdir:false,guide:'new guide'}, {platform:'win32',homeDir:home,env:{},roxRoot:join(root,'rox'),notesPath:join(root,'notes')},1000);
 assert.equal(fs.readFileSync(outside,'utf8'),before,'a linked source config must never mutate its outside target');
 console.log('PASS: actual migration refuses linked config; outside bytes unchanged');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
