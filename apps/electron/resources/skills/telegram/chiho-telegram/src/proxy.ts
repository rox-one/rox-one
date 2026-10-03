import {
  HttpProxyTcpTransport,
  SocksProxyTcpTransport,
  type TelegramTransport,
} from '@mtcute/node';

type HttpScheme = 'http' | 'https';
type SocksScheme = 'socks4' | 'socks5';
type ProxyScheme = HttpScheme | SocksScheme;

export type ParsedProxyConfig =
  | {
      type: 'http';
      scheme: HttpScheme;
      host: string;
      port: number;
      user?: string;
      password?: string;
      tls: boolean;
    }
  | {
      type: 'socks';
      scheme: SocksScheme;
      host: string;
      port: number;
      user?: string;
      password?: string;
      version: 4 | 5;
    };

const SUPPORTED_SCHEMES = new Set<ProxyScheme>([
  'http',
  'https',
  'socks4',
  'socks5',
]);

function parsePort(url: URL, scheme: ProxyScheme): number {
  if (url.port) {
    const port = Number.parseInt(url.port, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Proxy URL has invalid port: "${url.port}"`);
    }
    return port;
  }

  if (scheme === 'http') return 80;
  if (scheme === 'https') return 443;
  return 1080;
}

function parseCredentials(url: URL): { user?: string; password?: string } {
  if (!url.username) {
    return {};
  }

  const user = decodeURIComponent(url.username);
  const password = url.password ? decodeURIComponent(url.password) : undefined;

  return { user, password };
}

function parseScheme(url: URL): ProxyScheme {
  const scheme = url.protocol.replace(/:$/, '').toLowerCase();
  if (!SUPPORTED_SCHEMES.has(scheme as ProxyScheme)) {
    throw new Error(
      `Unsupported proxy scheme "${scheme}". Use http, https, socks4, or socks5.`,
    );
  }

  return scheme as ProxyScheme;
}

export function parseProxyUrl(proxyUrl: string): ParsedProxyConfig {
  if (!proxyUrl.trim()) {
    throw new Error('Proxy URL is empty.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(proxyUrl);
  } catch (error) {
    throw new Error(
      `Invalid proxy URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const scheme = parseScheme(parsedUrl);
  if (!parsedUrl.hostname) {
    throw new Error("Proxy URL is missing host.");
  }

  const port = parsePort(parsedUrl, scheme);
  const credentials = parseCredentials(parsedUrl);

  if (scheme === 'http' || scheme === 'https') {
    return {
      type: 'http',
      scheme,
      host: parsedUrl.hostname,
      port,
      ...credentials,
      tls: scheme === 'https',
    };
  }

  return {
    type: 'socks',
    scheme,
    host: parsedUrl.hostname,
    port,
    ...credentials,
    version: scheme === 'socks4' ? 4 : 5,
  };
}

export function createProxyTransport(
  proxyUrl: string | undefined,
): TelegramTransport | undefined {
  if (!proxyUrl) {
    return undefined;
  }

  const proxy = parseProxyUrl(proxyUrl);
  if (proxy.type === 'http') {
    return new HttpProxyTcpTransport({
      host: proxy.host,
      port: proxy.port,
      user: proxy.user,
      password: proxy.password,
      tls: proxy.tls,
    });
  }

  return new SocksProxyTcpTransport({
    host: proxy.host,
    port: proxy.port,
    user: proxy.user,
    password: proxy.password,
    version: proxy.version,
  });
}
