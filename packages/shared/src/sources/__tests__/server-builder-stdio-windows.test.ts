import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { SourceServerBuilder } from '../server-builder.ts';
import type { LoadedSource } from '../types.ts';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

describe('Windows MCP stdio source launch', () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  test.skipIf(process.platform !== 'win32')('platform override launches a .cmd through the installed SDK under Node with argv, env and cwd intact', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mcp source with spaces '));
    const launcher = join(dir, 'mcp launcher.cmd');
    const server = join(dir, 'server.cjs');
    const { stdout: nodePath } = await execFileAsync('node', ['-p', 'process.execPath']);
    writeFileSync(launcher, `@echo off\r\n"${nodePath.trim()}" "%~dp0server.cjs" %*\r\n`);
    writeFileSync(server, `
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  const result = m.method === 'initialize'
    ? {protocolVersion:m.params.protocolVersion, capabilities:{tools:{}}, serverInfo:{name:'fixture',version:'1.0'}}
    : m.method === 'tools/list' ? {tools:[]}
    : {content:[{type:'text',text:JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),value:process.env.FIXTURE_VALUE})}]};
  console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
});
`);
    const source: LoadedSource = {
      config: {
        id: 'stdio-fixture', slug: 'stdio-fixture', name: 'Fixture', provider: 'fixture', enabled: true, type: 'mcp',
        mcp: {
          transport: 'stdio', command: 'not-a-windows-command', args: ['wrong-default'], env: { FIXTURE_VALUE: 'default' },
          platform: { win32: { command: '${SOURCE_DIR}/mcp launcher.cmd', args: ['${WORKSPACE}', 'value with spaces', 'notes & tasks', 'заметки'], env: { FIXTURE_VALUE: '${SOURCE_DIR}' } } },
        },
      },
      workspaceId: 'fixture', workspaceRootPath: dir, folderPath: dir, guide: null,
    };
    const original = JSON.stringify(source.config);
    const config = new SourceServerBuilder().buildMcpServer(source, null);
    expect(config?.type).toBe('stdio');
    if (!config || config.type !== 'stdio') throw new Error('stdio config missing');
    expect(JSON.stringify(source.config)).toBe(original);

    // Use Node, as Electron does. A Bun-only spawn test can mask Node .cmd errors.
    const runner = join(dir, 'client.cjs');
    writeFileSync(runner, `
const {Client} = require(${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/client/index.js'))});
const {StdioClientTransport} = require(${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/client/stdio.js'))});
(async () => {
  const client = new Client({name:'test',version:'1.0'});
  const transport = new StdioClientTransport(${JSON.stringify(config)});
  try {
    await client.connect(transport, {timeout:5000});
    await client.listTools();
    const result = await client.callTool({name:'echo',arguments:{}}, undefined, {timeout:5000});
    console.log(result.content[0].text);
  } finally { await client.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
`);
    const { stdout } = await execFileAsync(nodePath.trim(), [runner], { timeout: 15000 });
    expect(JSON.parse(stdout)).toEqual({ argv: [dir, 'value with spaces', 'notes & tasks', 'заметки'], cwd: dir, value: dir });
  }, 20000);
});
