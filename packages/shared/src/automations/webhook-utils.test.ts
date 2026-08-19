/**
 * Tests for webhook utility functions (expandWebhookAction, etc.)
 */

import { describe, it, expect } from 'bun:test';
import { expandWebhookAction, blockedWebhookDestination, blockedWebhookResolvedAddresses, executeWebhookRequest } from './webhook-utils.ts';
import type { WebhookAction } from './types.ts';

const env = {
  CRAFT_WH_SESSION_ID: 'sess-123',
  CRAFT_WH_EVENT: 'LabelAdd',
  API_TOKEN: 'tok-secret',
};

describe('expandWebhookAction', () => {
  it('expands URL templates', () => {
    const action: WebhookAction = {
      type: 'webhook',
      url: 'https://api.example.com/hook/${CRAFT_WH_SESSION_ID}',
    };
    const result = expandWebhookAction(action, env);
    expect(result.url).toBe('https://api.example.com/hook/sess-123');
  });

  it('expands header values', () => {
    const action: WebhookAction = {
      type: 'webhook',
      url: 'https://api.example.com',
      headers: { 'X-Event': '${CRAFT_WH_EVENT}', 'X-Static': 'unchanged' },
    };
    const result = expandWebhookAction(action, env);
    expect(result.headers).toEqual({ 'X-Event': 'LabelAdd', 'X-Static': 'unchanged' });
  });

  it('expands string body', () => {
    const action: WebhookAction = {
      type: 'webhook',
      url: 'https://api.example.com',
      body: 'session=${CRAFT_WH_SESSION_ID}',
      bodyFormat: 'raw',
    };
    const result = expandWebhookAction(action, env);
    expect(result.body).toBe('session=sess-123');
  });

  it('expands object body (JSON)', () => {
    const action: WebhookAction = {
      type: 'webhook',
      url: 'https://api.example.com',
      body: { id: '${CRAFT_WH_SESSION_ID}', event: '${CRAFT_WH_EVENT}' },
    };
    const result = expandWebhookAction(action, env);
    expect(result.body).toEqual({ id: 'sess-123', event: 'LabelAdd' });
  });

  it('expands basic auth credentials', () => {
    const action: WebhookAction = {
      type: 'webhook',
      url: 'https://api.example.com',
      auth: { type: 'basic', username: '${CRAFT_WH_SESSION_ID}', password: '${API_TOKEN}' },
    };
    const result = expandWebhookAction(action, env);
    expect(result.auth).toEqual({ type: 'basic', username: 'sess-123', password: 'tok-secret' });
  });

  it('expands bearer auth token', () => {
    const action: WebhookAction = {
      type: 'webhook',
      url: 'https://api.example.com',
      auth: { type: 'bearer', token: '${API_TOKEN}' },
    };
    const result = expandWebhookAction(action, env);
    expect(result.auth).toEqual({ type: 'bearer', token: 'tok-secret' });
  });

  it('passes through fields without templates unchanged', () => {
    const action: WebhookAction = {
      type: 'webhook',
      url: 'https://api.example.com/static',
      method: 'PUT',
      bodyFormat: 'json',
      captureResponse: true,
    };
    const result = expandWebhookAction(action, env);
    expect(result.url).toBe('https://api.example.com/static');
    expect(result.method).toBe('PUT');
    expect(result.bodyFormat).toBe('json');
    expect(result.captureResponse).toBe(true);
  });
});

describe('blockedWebhookDestination', () => {
  it('blocks loopback and RFC1918 hosts', async () => {
    for (const url of [
      'http://127.0.0.1/secret',
      'http://localhost/secret',
      'http://192.168.1.1/hook',
      'http://10.0.0.8/hook',
      'http://169.254.169.254/latest/meta-data/',
      'http://metadata.google.internal/',
    ]) {
      const result = await executeWebhookRequest({ type: 'webhook', url });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not allowed');
    }
  });

  it('allows public https hosts', () => {
    expect(blockedWebhookDestination(new URL('https://example.com/hook'))).toBeNull();
    expect(blockedWebhookDestination(new URL('https://facebook.com/hook'))).toBeNull();
    expect(blockedWebhookDestination(new URL('https://fdx.com/hook'))).toBeNull();
  });

  it('blocks IPv6 loopback and unique-local literals without matching hostnames', () => {
    expect(blockedWebhookDestination(new URL('http://[::1]/hook'))).not.toBeNull();
    expect(blockedWebhookDestination(new URL('http://[fc00::1]/hook'))).not.toBeNull();
    expect(blockedWebhookDestination(new URL('http://[fd12:3456::1]/hook'))).not.toBeNull();
  });

  it('blocks hostnames that resolve to private addresses', async () => {
    const url = new URL('https://evil.example/hook');
    const blocked = await blockedWebhookResolvedAddresses(url, async () => [
      { address: '127.0.0.1', family: 4 },
    ]);
    expect(blocked).toContain('private address');

    const result = await executeWebhookRequest(
      { type: 'webhook', url: 'https://evil.example/hook' },
      { lookup: async () => [{ address: '169.254.169.254', family: 4 }] },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('private address');
  });

  it('fails closed when DNS lookup throws', async () => {
    const result = await executeWebhookRequest(
      { type: 'webhook', url: 'https://missing.example/hook' },
      { lookup: async () => { throw new Error('ENOTFOUND'); } },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('could not be resolved');
  });

  it('allows hostnames that resolve only to public addresses', async () => {
    const blocked = await blockedWebhookResolvedAddresses(
      new URL('https://hooks.slack.com/services/x'),
      async () => [{ address: '8.8.8.8', family: 4 }],
    );
    expect(blocked).toBeNull();
  });
});
