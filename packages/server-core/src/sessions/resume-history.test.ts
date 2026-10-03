import {describe,expect,it} from 'bun:test';
import type {Message} from '@rox/core/types';
import {selectResumeHistory} from './resume-history';
const messages=[
  {id:'u1',role:'user',content:'first'}, {id:'a1',role:'assistant',content:'answer'},
  {id:'t1',role:'tool',content:'result'}, {id:'u2',role:'user',content:'pending'},
] as Message[];
describe('native transcript reconstruction input',()=>{
  it('keeps prior tool history and excludes the persisted active submission',()=>{
    expect(selectResumeHistory(messages,'u2').map(m=>m.id)).toEqual(['u1','a1','t1']);
    expect(messages).toHaveLength(4);
  });
  it('keeps the entire selected branch slice during preflight',()=>{
    expect(selectResumeHistory(messages).map(m=>m.id)).toEqual(['u1','a1','t1','u2']);
  });
  it('excludes later queued prompts without replaying the active submission',()=>{
    const queued=[...messages,{id:'u3',role:'user',content:'queued'}] as Message[];
    expect(selectResumeHistory(queued,'u2',['u3']).map(m=>m.id)).toEqual(['u1','a1','t1']);
    expect(selectResumeHistory(queued,undefined,['u3']).map(m=>m.id)).toEqual(['u1','a1','t1','u2']);
  });
  it('does not fabricate context for a brand-new first turn',()=>{
    expect(selectResumeHistory([messages[3]!],'u2')).toEqual([]);
  });
});
