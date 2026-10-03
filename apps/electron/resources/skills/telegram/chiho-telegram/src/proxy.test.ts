import { describe, expect, it } from 'vitest';
import {
  HttpProxyTcpTransport,
  SocksProxyTcpTransport,
} from '@mtcute/node';
import { createProxyTransport, parseProxyUrl } from './proxy.js';

describe('parseProxyUrl', () => {
  it('parses socks5 proxy with explicit port', () => {
    expect(parseProxyUrl('socks5://203.0.113.10:1080')).toEqual({
      type: 'socks',
      scheme: 'socks5',
      host: '203.0.113.10',
      port: 1080,
      version: 5,
    });
  });

  it('parses socks4 proxy with credentials', () => {
    expect(parseProxyUrl('socks4://user:pass@203.0.113.11:9999')).toEqual({
      type: 'socks',
      scheme: 'socks4',
      host: '203.0.113.11',
      port: 9999,
      user: 'user',
      password: 'pass',
      version: 4,
    });
  });

  it('parses http proxy and fills default port', () => {
    expect(parseProxyUrl('http://proxy.example.com')).toEqual({
      type: 'http',
      scheme: 'http',
      host: 'proxy.example.com',
      port: 80,
      tls: false,
    });
  });

  it('parses https proxy and keeps tls enabled', () => {
    expect(parseProxyUrl('https://proxy.example.com:8443')).toEqual({
      type: 'http',
      scheme: 'https',
      host: 'proxy.example.com',
      port: 8443,
      tls: true,
    });
  });

  it('throws for unsupported scheme', () => {
    expect(() => parseProxyUrl('ftp://proxy.example.com:21')).toThrow(
      'Unsupported proxy scheme',
    );
  });

  it('throws for invalid port', () => {
    expect(() => parseProxyUrl('socks5://proxy.example.com:70000')).toThrow(
      'Invalid proxy URL',
    );
  });

  it('does not include proxy credentials in malformed URL errors', () => {
    const secret = 'proxy-password-sentinel';
    let message = '';
    try {
      parseProxyUrl(`http://user:${secret}@`);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('Invalid proxy URL');
    expect(message).not.toContain(secret);
    expect(message).not.toContain('user:');
  });
});

describe('createProxyTransport', () => {
  it('returns undefined when proxy is not set', () => {
    expect(createProxyTransport(undefined)).toBeUndefined();
  });

  it('creates HTTP proxy transport', () => {
    const transport = createProxyTransport('http://proxy.example.com:8888');
    expect(transport).toBeInstanceOf(HttpProxyTcpTransport);
  });

  it('creates SOCKS proxy transport', () => {
    const transport = createProxyTransport('socks5://proxy.example.com:1080');
    expect(transport).toBeInstanceOf(SocksProxyTcpTransport);
  });
});
