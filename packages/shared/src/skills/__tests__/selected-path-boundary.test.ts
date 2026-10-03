import {expect,test} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {loadSkill} from '../storage.ts';
test('current craft selected read never follows an outside instructions link',()=>{
 const root=mkdtempSync(join(tmpdir(),'skill-outside-control-'));
 try{const dir=join(root,'skills','sample');mkdirSync(dir,{recursive:true});const secret=join(root,'outside.md');writeFileSync(secret,'---\nname: Foreign\ndescription: Outside\n---\nFOREIGN');symlinkSync(secret,join(dir,'SKILL.md'));expect(()=>loadSkill(root,'sample')).toThrow();}finally{rmSync(root,{recursive:true,force:true});}
});
