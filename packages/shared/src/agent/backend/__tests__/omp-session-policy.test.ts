import {describe,expect,it} from 'bun:test';
import type {LlmConnection} from '../../../config/llm-connections.ts';
import {isBringYourOwnSessionConnection,selectOmpSessionConnection,selectOmpSessionModel} from '../omp-session-policy.ts';
const omp={slug:'rox-kimi',name:'ROX',providerType:'omp',authType:'none',defaultModel:'rox/standard',createdAt:1} as LlmConnection;
const legacy={slug:'old-claude',name:'Old',providerType:'anthropic',authType:'api_key',defaultModel:'claude-sonnet-4-6',createdAt:1} as LlmConnection;
const ollama={slug:'ollama-local',name:'Ollama',providerType:'pi_compat',authType:'none',baseUrl:'http://127.0.0.1:11434/v1',defaultModel:'qwen3:8b',createdAt:1} as LlmConnection;
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
  it('honors an explicit local Ollama connection instead of rewriting it to Rox Cloud',()=>{
    expect(isBringYourOwnSessionConnection(ollama)).toBe(true);
    expect(selectOmpSessionConnection({connections:[omp,ollama],sessionSlug:ollama.slug,defaultSlug:omp.slug})).toBe(ollama);
    expect(selectOmpSessionConnection({connections:[omp,ollama],defaultSlug:ollama.slug})).toBe(ollama);
    expect(selectOmpSessionModel(ollama,'qwen3:8b',false)).toBe('qwen3:8b');
  });
  it('migrates a legacy model and preserves a configured OMP model',()=>{
    expect(selectOmpSessionModel(omp,'claude-sonnet-4-6',false)).toBe('rox/standard');
    expect(selectOmpSessionModel(omp,'custom/model',true)).toBe('custom/model');
    expect(selectOmpSessionModel(omp,'rox/fast',false)).toBe('rox/fast');
  });
});
