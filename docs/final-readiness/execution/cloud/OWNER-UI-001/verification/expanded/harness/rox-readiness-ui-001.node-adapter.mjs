import assert from 'node:assert/strict';
const cases=[], hooks={beforeAll:[],beforeEach:[],afterEach:[],afterAll:[]};
let assertions=0;
function registerHook(kind){return(fn,timeout=30000)=>hooks[kind].push({fn,timeout})}
export const beforeAll=registerHook('beforeAll'), beforeEach=registerHook('beforeEach'), afterEach=registerHook('afterEach'), afterAll=registerHook('afterAll');
export function describe(name,fn){fn()}
describe.skipIf=skip=>(name,fn)=>{if(!skip)fn()};
export function it(name,fn,timeout=30000){cases.push({name,fn,timeout})}
export const test=it;
function partial(actual,expected){
 if(expected!==null&&typeof expected==='object'){
  assert.ok(actual!==null&&typeof actual==='object');
  for(const key of Object.keys(expected))partial(actual[key],expected[key]);
 }else assert.strictEqual(actual,expected);
}
export function expect(actual){
 const methods={
  toBe:expected=>assert.strictEqual(actual,expected),
  toBeNull:()=>assert.strictEqual(actual,null),
  toEqual:expected=>assert.deepStrictEqual(actual,expected),
  toMatchObject:expected=>partial(actual,expected),
  toHaveLength:expected=>assert.strictEqual(actual.length,expected),
  toStartWith:expected=>assert.ok(typeof actual==='string'&&actual.startsWith(expected)),
  toContain:expected=>assert.ok(actual.includes(expected)),
  toBeTruthy:()=>assert.ok(actual),
  toBeGreaterThan:expected=>assert.ok(actual>expected),
  toBeLessThan:expected=>assert.ok(actual<expected),
 };
 const matcher={};
 for(const[key,fn]of Object.entries(methods))matcher[key]=(...args)=>{assertions++;return fn(...args)};
 matcher.not={};
 for(const[key,fn]of Object.entries(methods))matcher.not[key]=(...args)=>{assertions++;let failed=false;try{fn(...args)}catch{failed=true}assert.ok(failed)};
 return matcher;
}
async function bounded({fn,timeout}){let timer;try{await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Hook/case timeout '+timeout+'ms')),timeout)})])}finally{clearTimeout(timer)}}
async function runHooks(kind){for(const hook of hooks[kind])await bounded(hook)}
globalThis.__ui001NodeRun=async()=>{
 let passed=0,failed=0;const start=Date.now();
 console.log('Actual test callbacks via task-local Node adapter; Node '+process.version+'; external Chromium; no Bun pass claim');
 try{await runHooks('beforeAll')}catch(error){failed++;console.error('[HARNESS FAIL]',error.stack||error);}
 const selected=process.env.ROX_UI001_TEST_FILTER?cases.filter(entry=>new RegExp(process.env.ROX_UI001_TEST_FILTER).test(entry.name)):cases;
 if(!failed)for(const entry of selected){let error;const caseStart=Date.now();try{await runHooks('beforeEach');await bounded(entry)}catch(caught){error=caught}try{await runHooks('afterEach')}catch(caught){error??=caught}if(error){failed++;console.error('[FAIL] '+entry.name+'\n'+(error.stack||error))}else{passed++;console.log('[PASS] '+entry.name+' '+(Date.now()-caseStart)+'ms')}}
 try{await runHooks('afterAll')}catch(error){failed++;console.error('[CLEANUP FAIL]',error.stack||error)}
 console.log(JSON.stringify({runtime:'Node actual source callbacks adapter',pass:passed,fail:failed,assertions,cases:selected.length,registeredCases:cases.length,elapsedMs:Date.now()-start}));
 if(failed)process.exitCode=1;
};
