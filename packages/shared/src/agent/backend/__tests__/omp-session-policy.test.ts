import {describe,expect,it} from 'bun:test';
import type {LlmConnection} from '../../../config/llm-connections.ts';
import {selectOmpSessionConnection,selectOmpSessionModel} from '../omp-session-policy.ts';
const omp={slug:'rox-kimi',name:'ROX',providerType:'omp',authType:'none',defaultModel:'rox/standard',createdAt:1} as LlmConnection;
const legacy={slug:'old-claude',name:'Old',providerType:'anthropic',authType:'api_key',defaultModel:'claude-sonnet-4-6',createdAt:1} as LlmConnection;
describe('mandatory OMP session routing',()=>{
  it('migrates a saved legacy session to the configured OMP connection',()=>{
    expect(selectOmpSessionConnection({connections:[legacy,omp],sessionSlug:legacy.slug,defaultSlug:omp.slug})).toBe(omp);
  });
  it('never starts a legacy backend when no OMP connection exists',()=>{
    expect(()=>selectOmpSessionConnection({connections:[legacy],defaultSlug:legacy.slug})).toThrow('OMP');
  });
  it('preserves an explicit OMP connection',()=>{
    const custom={...omp,slug:'other-omp'};
    expect(selectOmpSessionConnection({connections:[omp,custom],sessionSlug:custom.slug,defaultSlug:omp.slug})).toBe(custom);
  });
  it('migrates a legacy model and preserves a configured OMP model',()=>{
    expect(selectOmpSessionModel(omp,'claude-sonnet-4-6',false)).toBe('rox/standard');
    expect(selectOmpSessionModel(omp,'custom/model',true)).toBe('custom/model');
    expect(selectOmpSessionModel(omp,'rox/fast',false)).toBe('rox/fast');
  });
});
