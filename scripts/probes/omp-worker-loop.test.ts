import {test, expect} from 'bun:test';
import {mkdtempSync, writeFileSync, readFileSync, symlinkSync, lstatSync, readdirSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeWorkerEvidence} from './omp-worker-loop';

test('evidence replaces a planted output symlink without modifying its target',()=>{
 const root=mkdtempSync(join(tmpdir(),'rox-worker-evidence-test-'));
 try{
  const victim=join(root,'victim'), output=join(root,'evidence.json');
  writeFileSync(victim,'unchanged');
  symlinkSync(victim,output);
  writeWorkerEvidence(output,{assertionsPassed:true});
  expect(readFileSync(victim,'utf8')).toBe('unchanged');
  expect(lstatSync(output).isSymbolicLink()).toBe(false);
  expect(lstatSync(output).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(output,'utf8'))).toEqual({assertionsPassed:true});
  expect(readdirSync(root).sort()).toEqual(['evidence.json','victim']);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('failed evidence replacement removes its private pending file',()=>{
 const root=mkdtempSync(join(tmpdir(),'rox-worker-evidence-test-'));
 try{
  const output=join(root,'directory');
  mkdirSync(output);
  expect(()=>writeWorkerEvidence(output,{ok:true})).toThrow();
  expect(readdirSync(root)).toEqual(['directory']);
 }finally{rmSync(root,{recursive:true,force:true});}
});
