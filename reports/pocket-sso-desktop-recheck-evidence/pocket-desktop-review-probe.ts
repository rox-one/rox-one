import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OmpAgent } from '/Users/t/.codex/worktrees/pocket-id-sso/rox-release-20261003/packages/shared/src/agent/omp-agent.ts';
import { createFakeOmp, useFakeOmpEnv, makeOmpConfig, chatEvents } from '/Users/t/.codex/worktrees/pocket-id-sso/rox-release-20261003/packages/shared/src/agent/__tests__/omp-fake-cli.ts';
import { createPocketFixture } from '/Users/t/.codex/worktrees/pocket-id-sso/rox-release-20261003/packages/shared/src/auth/__tests__/pocket-test-fixture.ts';
import { setRoxAccountAuthority, LOCAL_ROX_CALLER } from '/Users/t/.codex/worktrees/pocket-id-sso/rox-release-20261003/packages/shared/src/auth/rox-account-authority.ts';
const fake = createFakeOmp('model-public'); const restore = useFakeOmpEnv(fake); let agent: OmpAgent|undefined;
try {
 const script = join(fake.dir,'fake-omp.js'); const source = readFileSync(script,'utf8');
 writeFileSync(script, source.replace('function logRpc(obj) {', "function logRpc(obj) { if (obj.type === 'prompt') obj.personalCredentialMatches = process.env.ROX_API_KEY === 'account-key-fixture';"));
 const pocket = createPocketFixture(); await pocket.authority.start(LOCAL_ROX_CALLER); await pocket.authority.state(LOCAL_ROX_CALLER); setRoxAccountAuthority(pocket.authority);
 const context=await pocket.authority.capture(LOCAL_ROX_CALLER);
 agent = new OmpAgent(makeOmpConfig(fake, {model:'kimi-k3',roxExecutionContext:context,envOverrides:{ROX_API_KEY:'wrong-session-fixture-key'}}));
 const first=await chatEvents(agent,'private model fixture',30_000); agent.setModel('rox/standard'); const second=await chatEvents(agent,'public model fixture',30_000);
 console.log(JSON.stringify({privateErrors:first.filter(e=>e.type.includes("error")),publicErrors:second.filter(e=>e.type.includes("error")),privateCompleted:first.some(e=>e.type==='text_complete'),publicCompleted:second.some(e=>e.type==='text_complete'),spawns:fake.readArgvLog().length,prompts:fake.readRpcLog().filter(f=>f.type==='prompt')}));
} finally {agent?.destroy(); await Bun.sleep(100);restore();fake.cleanup();}
