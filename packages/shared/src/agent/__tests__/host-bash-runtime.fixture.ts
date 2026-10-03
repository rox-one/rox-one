import { dirname, join } from 'node:path';
import { createClaudeContext } from '../claude-context.ts';
import { SESSION_TOOL_REGISTRY, setHostBashPort } from '@craft-agent/session-tools-core';
import { setWindowsBootstrapRuntime } from '../../toolchain/windows-bootstrap.ts';

// A real native executable is used at the fixture bootstrap path. The runtime
// contract is injected; installer receipt validation has its own test suite.
const root = process.env.HOST_BASH_RUNTIME_FIXTURE!;
const bootstrapNode = join(root, 'bootstrap', 'node.exe');
setWindowsBootstrapRuntime({
  mode: 'bundled', receiptState: 'ready', missingTools: [],
  findExecutable: async name => name === 'node' ? bootstrapNode : null,
  source: name => name === 'node' ? 'bundled' : null,
  pathEntries: async () => [dirname(bootstrapNode)],
  isExcludedPath: async () => false,
  filterPath: async path => path,
  gitBashPath: async () => process.env.CLAUDE_CODE_GIT_BASH_PATH ?? null,
});
let portCalled = false;
setHostBashPort(async () => { portCalled = true; throw new Error('legacy exec port cannot receive env'); });
const context = createClaudeContext({
  sessionId: 'host-bash-runtime-fixture', workspaceId: 'fixture', workspacePath: root,
  onPlanSubmitted: () => {}, onAuthRequest: () => {},
});
if (process.argv.includes('--without-provider')) context.getHostBashEnv = undefined;
const originalPath = process.env.PATH;
const results: Record<string, unknown> = {};
const handler = SESSION_TOOL_REGISTRY.get('bash')!.handler!;
for (const name of ['pandoc', 'uvx', 'python', 'python3', 'node']) {
  const result = await handler(context, {
    command: `${name} --version && ${name} -p "process.execPath"`,
  });
  results[name] = { isError: result.isError, text: result.content[0]?.text };
}
results.nestedPython = await handler(context, { command: 'bash -c \'python3 -p "process.execPath"\'' });
results.python3Location = await handler(context, { command: 'command -v python3' });
results.sanitized = await handler(context, {
  command: 'node -p "JSON.stringify([process.env.AWS_SECRET_ACCESS_KEY, process.env.ROX_SECRET_FIXTURE, process.env.aws_session_token, process.env.UV_PYTHON])"',
});
results.portCalled = portCalled;
results.parentPathUnchanged = process.env.PATH === originalPath;
console.log(JSON.stringify(results));
