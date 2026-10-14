import {describe,expect,it} from 'bun:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
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

describe('OMP branch reconstruct input (S3-10)', () => {
  it('feeds the copied child prefix into reconstruct, not the parent active submission', () => {
    const source = readFileSync(join(import.meta.dir, 'SessionManager.ts'), 'utf8');
    expect(source).toContain('getBranchResumeMessages: () => managed.branchFromMessageId');
    expect(source).toContain('selectResumeHistory(managed.messages)');
    expect(source).toContain('describeBranchPreflightFailure');
    expect(source).not.toMatch(
      /getBranchResumeMessages: \(\) => managed\.branchFromMessageId\s*\n\s*\? selectResumeHistory\(managed\.messages, managed\.activeUserMessageId/,
    );
  });
});
