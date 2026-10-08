// Real builder -> pool child: cwd-dependent startup and a non-idempotent call
// that records its execution, then exits without sending a tool response.
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const relative = readFileSync('relative.txt', 'utf8');
if (process.env.POOL_START_RECORD) appendFileSync(process.env.POOL_START_RECORD, `${process.pid}\n`);
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === 'tools/call') {
    if (process.env.POOL_CALL_RECORD) appendFileSync(process.env.POOL_CALL_RECORD, `${process.pid}:${message.params.name}\n`);
    if (message.params.name === 'die') process.exit(23);
  }
  const result = message.method === 'initialize'
    ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'pool-lifecycle-fixture', version: '1.0' } }
    : message.method === 'tools/list'
      ? { tools: ['inspect', 'die', 'reply_then_exit'].map(name => ({ name, inputSchema: { type: 'object' } })) }
      : { content: [{ type: 'text', text: JSON.stringify({ pid: process.pid, cwd: process.cwd(), relative, args: process.argv.slice(2), value: process.env.POOL_VALUE }) }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n', () => {
    if (message.method === 'tools/call' && message.params.name === 'reply_then_exit') process.exit(24);
  });
});
lines.on('close', () => process.exit(0));
