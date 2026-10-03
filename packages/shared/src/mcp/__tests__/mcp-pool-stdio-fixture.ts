// Real stdio MCP child for pool transport tests. No network/package installation.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'pool-stdio-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'inspect', inputSchema: { type: 'object' as const } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  if (request.params.arguments?.stall) {
    await new Promise<void>((resolve) => extra.signal.addEventListener('abort', () => resolve(), { once: true }));
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({
      path: process.env.PATH,
      value: process.env.POOL_TEST_VALUE,
      args: process.argv.slice(2),
    }) }],
  };
});
await server.connect(new StdioServerTransport());
process.stdin.on('end', () => { void server.close(); });
