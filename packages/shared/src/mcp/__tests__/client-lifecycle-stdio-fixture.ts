// A real child with a relative cwd dependency and controllable MCP stalls.
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

if (process.env.CLIENT_STARTED_FILE) writeFileSync(process.env.CLIENT_STARTED_FILE, String(process.pid));
const mode = process.env.CLIENT_STALL;
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === 'initialize' && mode === 'initialize') return;
  if (message.method === 'tools/list' && mode === 'tools/list') return;
  if (message.method === 'tools/list' && process.env.CLIENT_ERROR_SECRET) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: {
      code: -32603, message: `fixture rejected ${process.env.CLIENT_ERROR_SECRET}`,
    } }) + '\n');
    return;
  }
  const result = message.method === 'initialize'
    ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'client-fixture', version: '1.0' } }
    : message.method === 'tools/list'
      ? { tools: [{ name: 'inspect', inputSchema: { type: 'object' } }] }
      : { content: [{ type: 'text', text: JSON.stringify({
        cwd: process.cwd(), relative: readFileSync('relative.txt', 'utf8'),
        args: process.argv.slice(2), value: process.env.CLIENT_VALUE,
        inheritedSecret: process.env.ANTHROPIC_API_KEY,
      }) }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
});
if (process.env.CLIENT_STUBBORN) {
  setInterval(() => {}, 1000);
  process.on('SIGTERM', () => {});
} else {
  lines.on('close', () => process.exit(0));
}
