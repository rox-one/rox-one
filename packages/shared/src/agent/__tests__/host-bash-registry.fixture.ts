import { createClaudeContext } from '../claude-context.ts';
import { SESSION_TOOL_REGISTRY, setHostBashPort } from '@rox/session-tools-core';
const root = process.env.HOST_BASH_REGISTRY_FIXTURE!;
let portCalled = false;
setHostBashPort(async () => { portCalled = true; throw new Error('legacy port lacks env'); });
const context = createClaudeContext({ sessionId: 'host-bash-registry', workspaceId: 'fixture', workspacePath: root,
  onPlanSubmitted: () => {}, onAuthRequest: () => {} });
if (process.argv.includes('--without-provider')) context.getHostBashEnv = undefined;
const factoryProvider = context.getHostBashEnv;
if (factoryProvider) context.getHostBashEnv = async () => { console.error('fixture: prepare-start'); const env = await factoryProvider(); console.error('fixture: prepare-complete'); return env; };
const phases: string[] = [];
context.hostBashObserver = observation => { phases.push(observation.phase); console.error(`fixture: ${observation.phase}`); };
const parentPath = process.env.PATH;
const result = await SESSION_TOOL_REGISTRY.get('bash')!.handler!(context, {
  command: 'pandoc && printf "|credentials:%s:%s:%s" "$AWS_SECRET_ACCESS_KEY" "$ROX_SECRET_FIXTURE" "$aws_session_token"',
});
console.log(JSON.stringify({ runtime: { name: process.release.name, bun: process.versions.bun ?? null }, phases, result, portCalled, parentPathUnchanged: process.env.PATH === parentPath }));
