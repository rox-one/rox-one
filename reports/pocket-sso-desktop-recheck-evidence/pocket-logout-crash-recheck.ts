import {createPocketFixture} from '/Users/t/.codex/worktrees/pocket-id-sso/rox-release-20261003/packages/shared/src/auth/__tests__/pocket-test-fixture.ts';
import {RoxAccountAuthority,LOCAL_ROX_CALLER} from '/Users/t/.codex/worktrees/pocket-id-sso/rox-release-20261003/packages/shared/src/auth/rox-account-authority.ts';
const f=createPocketFixture();await f.authority.start(LOCAL_ROX_CALLER);await f.authority.state(LOCAL_ROX_CALLER);
const record=f.records.get(JSON.stringify(LOCAL_ROX_CALLER))!;
await f.store.writeLogout(LOCAL_ROX_CALLER,record);
// Crash after durable revocation intent and before active-record clear.
const restarted=new RoxAccountAuthority(f.store,f.client);
const state=await restarted.state(LOCAL_ROX_CALLER);let error;try{const context=await restarted.capture(LOCAL_ROX_CALLER);await restarted.inference(context)}catch(e){error=e.message};
console.log(JSON.stringify({pendingLogout:f.pendingLogouts.size,connected:state.connected,inferenceError:error,brokerLogouts:f.logouts,activeRecords:f.records.size}));
