import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { validateMcpConnection, validateStdioMcpConnection } from '../validation.ts';
import { disableDebug, enableDebug, isDebugEnabled } from '../../utils/debug.ts';

test('stdio diagnostics redact configured vault secrets from server stderr', async () => {
  const secrets = {
    FIRECRAWL_API_KEY: 'vault-firecrawl-key',
    TELEGRAM_API_HASH: 'vault-telegram-hash',
    TELEGRAM_SESSION_STRING: 'vault-telegram-session',
  };
  const result = await validateStdioMcpConnection({
    command: process.execPath,
    args: ['--eval', 'console.error([process.env.FIRECRAWL_API_KEY, process.env.TELEGRAM_API_HASH, process.env.TELEGRAM_SESSION_STRING].join(" ")); process.exit(1)'],
    env: secrets,
    timeout: 4000,
  });
  expect(result.success).toBe(false);
  expect(result.error).toContain('[REDACTED]');
  for (const secret of Object.values(secrets)) expect(result.error).not.toContain(secret);
});

test('HTTP probe redacts echoed URL, header and access-token credentials from errors and debug logs', async () => {
  const secrets = {
    username: 'vault-username',
    password: 'vault-password',
    query: 'vault query/value',
    fragment: 'vault-fragment',
    header: 'vault-custom-header',
    accessToken: 'vault-access-token',
  };
  let endpoint = '';
  let authorization: string | undefined;
  const server = createServer((request, response) => {
    authorization = request.headers.authorization;
    response.writeHead(401).end(`Unauthorized: ${endpoint} ${Object.values(secrets).join(' ')}`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://${secrets.username}:${secrets.password}@127.0.0.1:${(server.address() as AddressInfo).port}/mcp?api_key=${encodeURIComponent(secrets.query)}#${secrets.fragment}`;
  const originalWrite = process.stderr.write;
  const originallyEnabled = isDebugEnabled();
  let logs = '';
  process.stderr.write = ((chunk: string | Uint8Array) => {
    logs += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;
  enableDebug();
  try {
    const result = await validateMcpConnection({
      mcpUrl: endpoint,
      mcpHeaders: { 'X-Custom-Header': secrets.header },
      mcpAccessToken: secrets.accessToken,
    });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe('needs-auth');
    expect(result.error).toContain('[REDACTED]');
    expect(logs).toContain('Validating MCP connection to');
    expect(authorization).toBe(`Bearer ${secrets.accessToken}`);
    for (const secret of Object.values(secrets)) {
      expect(result.error).not.toContain(secret);
      expect(result.error).not.toContain(encodeURIComponent(secret));
      expect(logs).not.toContain(secret);
      expect(logs).not.toContain(encodeURIComponent(secret));
    }
  } finally {
    process.stderr.write = originalWrite;
    if (!originallyEnabled) disableDebug();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('an invalid remote URL produces a sanitized validation result', async () => {
  const result = await validateMcpConnection({ mcpUrl: 'not a url?token=vault-invalid-url-secret' });
  expect(result.success).toBe(false);
  expect(result.error).not.toContain('vault-invalid-url-secret');
});
