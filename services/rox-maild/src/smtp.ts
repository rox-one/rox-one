/**
 * Minimal SMTP client (RFC 5321) — just enough to hand a raw message to a
 * local Stalwart inbound listener. No third-party packages, node:net only.
 *
 * Only used against a loopback/in-network MTA: no STARTTLS, no AUTH, no
 * pipelining. Every command is bounded by a single timeout.
 */
import { connect, type Socket } from 'node:net'

export type SmtpFailure = 'connect' | 'timeout' | 'protocol' | 'rejected'

export class SmtpError extends Error {
  constructor(
    message: string,
    readonly code: SmtpFailure,
    readonly replyCode?: number,
  ) {
    super(message)
    this.name = 'SmtpError'
  }
}

export interface SmtpTarget {
  host: string
  /** Port the local Stalwart inbound listener is bound to. */
  port: number
  timeoutMs: number
  /** Name announced in EHLO. */
  helo: string
}

const MAX_REPLY_LINES = 200
const REPLY_RE = /^(\d{3})([ -])(.*)$/

interface Reply {
  code: number
  lines: string[]
}

class Connection {
  private buffer = ''
  private queued: string[] = []
  private waiter: { resolve: (line: string) => void; reject: (error: Error) => void } | null = null
  private failure: Error | null = null
  private destroyed = false
  private timer?: ReturnType<typeof setTimeout>

  constructor(private readonly socket: Socket, private readonly timeoutMs: number) {
    socket.setEncoding('utf8')
    socket.setNoDelay(true)
    socket.on('data', (chunk: string) => {
      this.refreshTimeout()
      this.buffer += chunk
      let index: number
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        let line = this.buffer.slice(0, index)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        this.buffer = this.buffer.slice(index + 1)
        if (this.waiter) {
          const waiter = this.waiter
          this.waiter = null
          waiter.resolve(line)
        } else {
          this.queued.push(line)
        }
      }
    })
    socket.on('error', (error: Error) => this.fail(new SmtpError(`SMTP socket error: ${error.message}`, 'connect')))
    socket.on('close', () => this.fail(new SmtpError('SMTP connection closed by the server', 'connect')))
    this.refreshTimeout()
  }

  static async open(target: SmtpTarget): Promise<Connection> {
    const socket = connect({ host: target.host, port: target.port })
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(new SmtpError(`Cannot reach SMTP server ${target.host}:${target.port} (${error.message})`, 'connect'))
      socket.once('error', onError)
      socket.once('connect', () => {
        socket.off('error', onError)
        resolve()
      })
    })
    return new Connection(socket, target.timeoutMs)
  }

  private refreshTimeout(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.fail(new SmtpError(`SMTP timed out after ${this.timeoutMs} ms`, 'timeout'))
      this.socket.destroy()
    }, this.timeoutMs)
    this.timer.unref?.()
  }

  private fail(error: Error): void {
    this.failure ??= error
    this.destroyed = true
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      waiter.reject(this.failure)
    }
  }

  private readLine(): Promise<string> {
    const ready = this.queued.shift()
    if (ready !== undefined) return Promise.resolve(ready)
    if (this.failure) return Promise.reject(this.failure)
    if (this.destroyed) return Promise.reject(new SmtpError('SMTP connection is closed', 'connect'))
    return new Promise<string>((resolve, reject) => {
      this.waiter = { resolve, reject }
    })
  }

  async readReply(): Promise<Reply> {
    const first = await this.readLine()
    const match = REPLY_RE.exec(first)
    if (!match) throw new SmtpError(`Malformed SMTP reply: ${JSON.stringify(first.slice(0, 200))}`, 'protocol')
    const code = Number(match[1])
    const lines = [first]
    if (match[2] === '-') {
      for (let i = 1; i < MAX_REPLY_LINES; i++) {
        const line = await this.readLine()
        lines.push(line)
        const continuation = REPLY_RE.exec(line)
        if (!continuation || continuation[1] !== match[1]) throw new SmtpError('Malformed SMTP multiline reply', 'protocol')
        if (continuation[2] === ' ') return { code, lines }
      }
      throw new SmtpError('SMTP reply exceeded the line limit', 'protocol')
    }
    return { code, lines }
  }

  private write(data: string | Buffer): void {
    if (this.failure) throw this.failure
    this.refreshTimeout()
    this.socket.write(data)
  }

  async command(line: string, ...accept: number[]): Promise<Reply> {
    this.write(`${line}\r\n`)
    const reply = await this.readReply()
    if (!accept.includes(reply.code)) {
      throw new SmtpError(`SMTP ${line.split(' ')[0]} rejected with ${reply.code}: ${reply.lines.join(' | ').slice(0, 300)}`, 'rejected', reply.code)
    }
    return reply
  }

  async data(payload: Buffer, accept: number[]): Promise<Reply> {
    this.write(payload)
    const reply = await this.readReply()
    if (!accept.includes(reply.code)) {
      throw new SmtpError(`SMTP DATA rejected with ${reply.code}: ${reply.lines.join(' | ').slice(0, 300)}`, 'rejected', reply.code)
    }
    return reply
  }

  close(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.destroyed = true
    try {
      this.socket.end()
    } catch {
      /* already gone */
    }
    this.socket.destroy()
  }
}

/** Strip a display name / angle brackets and validate an envelope address. */
export function bareAddress(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed || /[\r\n\0]/.test(trimmed)) return null
  const angled = /<([^<>]*)>\s*$/.exec(trimmed)
  const address = (angled ? angled[1]! : trimmed).trim()
  if (!address || /[\s<>\0]/.test(address)) return null
  if (address.length > 320) return null
  return address
}

/**
 * Normalise the raw message for the SMTP DATA phase: all line endings become
 * CRLF, lines starting with '.' are dot-stuffed (RFC 5321 §4.5.2) and the
 * terminating `<CRLF>.<CRLF>` is appended. latin1 round-trips every byte.
 */
export function prepareData(raw: Uint8Array): Buffer {
  let text = Buffer.from(raw).toString('latin1')
  text = text.replace(/\r\n|\r|\n/g, '\r\n').replace(/(^|\r\n)\./g, '$1..')
  if (!text.endsWith('\r\n')) text += '\r\n'
  return Buffer.from(`${text}.\r\n`, 'latin1')
}

/**
 * Deliver one already-serialised message. Throws SmtpError on any failure.
 * Sequence: greeting → EHLO (HELO fallback) → MAIL FROM → RCPT TO → DATA.
 */
export async function deliverRaw(target: SmtpTarget, mailFrom: string, rcptTo: string, raw: Uint8Array): Promise<void> {
  const connection = await Connection.open(target)
  try {
    const greeting = await connection.readReply()
    if (greeting.code !== 220) {
      throw new SmtpError(`SMTP server refused the connection with ${greeting.code}`, 'rejected', greeting.code)
    }
    try {
      await connection.command(`EHLO ${target.helo}`, 250)
    } catch (error) {
      if (!(error instanceof SmtpError && error.code === 'rejected' && (error.replyCode === 500 || error.replyCode === 502))) throw error
      await connection.command(`HELO ${target.helo}`, 250)
    }
    await connection.command(`MAIL FROM:<${mailFrom}>`, 250)
    await connection.command(`RCPT TO:<${rcptTo}>`, 250, 251)
    await connection.command('DATA', 354)
    await connection.data(prepareData(raw), [250])
    await connection.command('QUIT', 221).catch(() => undefined)
  } finally {
    connection.close()
  }
}