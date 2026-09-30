#!/usr/bin/env bun
/**
 * Inject a test message into the LOCAL Stalwart over plain SMTP (loopback
 * only). Simulates inbound mail for the local pilot — nothing leaves the Mac.
 *
 *   bun scripts/mail/inject-test-mail.ts --to mark@rox.one [--from test@example.com]
 *       [--subject "..."] [--text "..."] [--html "<p>..</p>"] [--attach ./file.pdf]
 *       [--host 127.0.0.1] [--port 2525]
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { connect } from 'node:net'

const args = process.argv.slice(2)
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const host = opt('host', '127.0.0.1')!
const port = Number(opt('port', '2525'))
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('inject-test-mail only talks to a loopback SMTP server')
const to = opt('to')
if (!to) throw new Error('--to is required')
const from = opt('from', 'test@example.com')!
const subject = opt('subject', 'Тестовое письмо Rox Mail')!
const text = opt('text', 'Привет! Это тестовое письмо, отправленное в локальный Stalwart.')!
const html = opt('html')
const attach = opt('attach')

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64').replace(/.{1,76}/g, '$&\r\n')
const encWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`)
const boundary = `rox-${Date.now().toString(36)}`
const alt = `alt-${boundary}`
const headers = [
  `From: ${from}`, `To: ${to}`, `Subject: ${encWord(subject)}`, `Date: ${new Date().toUTCString()}`,
  `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@example.com>`, 'MIME-Version: 1.0',
]
const textPart = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(text)].join('\r\n')
const htmlPart = html ? ['Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(html)].join('\r\n') : null
let body = htmlPart
  ? [`Content-Type: multipart/alternative; boundary="${alt}"`, '', `--${alt}`, textPart, `--${alt}`, htmlPart, `--${alt}--`].join('\r\n')
  : textPart
if (attach) {
  const name = basename(attach)
  body = [
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, body, `--${boundary}`,
    `Content-Type: application/octet-stream; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`, 'Content-Transfer-Encoding: base64', '',
    b64(readFileSync(attach)), `--${boundary}--`,
  ].join('\r\n')
}
const [ctHeader, ...rest] = body.split('\r\n')
const message = [...headers, ctHeader, ...rest].join('\r\n').replace(/^\./gm, '..')

const script = [`EHLO rox-local-test`, `MAIL FROM:<${from}>`, `RCPT TO:<${to}>`, 'DATA', `${message}\r\n.`, 'QUIT']
const socket = connect(port, host)
let step = -1
let buf = ''
socket.setEncoding('utf8')
socket.on('data', (chunk: string) => {
  buf += chunk
  const lines = buf.split('\r\n')
  buf = lines.pop() ?? ''
  for (const line of lines) {
    if (/^\d{3}-/.test(line)) continue
    const code = Number(line.slice(0, 3))
    if (code >= 400) { console.error(`SMTP error: ${line}`); socket.destroy(); process.exit(1) }
    step += 1
    if (step < script.length) socket.write(`${script[step]}\r\n`)
    else socket.end()
  }
})
socket.on('close', () => { if (step >= script.length - 1) console.log(`queued: ${from} → ${to} «${subject}»`) })
socket.on('error', (e) => { console.error(e.message); process.exit(1) })
