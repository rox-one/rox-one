/**
 * Политика исходящих endpoint'ов для IPC-вызовов рендерера (RX-SEC-0006).
 *
 * Зеркалит серверное правило транспорта: открытый текст (ws/http) допустим
 * только на loopback — иначе токен ушёл бы в сеть в открытом виде.
 * Зашифрованные схемы (wss/https) разрешены на любой хост: пользователь
 * вправе подключать собственные удалённые серверы.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

export type EndpointPolicyVerdict = {
  readonly ok: boolean
  readonly reason?: string
}

export function isAllowedServerEndpoint(rawUrl: string): EndpointPolicyVerdict {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: `не является корректным URL: ${rawUrl.slice(0, 64)}` }
  }

  const proto = parsed.protocol.replace(':', '')
  if (proto !== 'ws' && proto !== 'wss' && proto !== 'http' && proto !== 'https') {
    return { ok: false, reason: `схема ${proto} не поддерживается (ожидается ws/wss/http/https)` }
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if ((proto === 'http' || proto === 'ws') && !LOOPBACK_HOSTS.has(host)) {
    return {
      ok: false,
      reason: `незашифрованная схема ${proto} разрешена только на loopback (127.0.0.1/localhost/::1), получен ${host}`,
    }
  }

  return { ok: true }
}
