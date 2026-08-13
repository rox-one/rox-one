import { describe, expect, it } from 'bun:test'
import { isAgentErrorCode } from '@craft-agent/core/types'
import {
  parseError,
  classifyOmpStartupExit,
  scrubOmpStderr,
  ompStartupErrorToAgentError,
  OmpStartupError,
  type OmpStartupErrorCode,
} from '../errors.ts'

describe('parseError proxy interception handling', () => {
  it('maps interceptor proxy marker message to proxy_error', () => {
    const message = 'Received an unexpected HTML error page (HTTP 400) instead of a JSON API response. This may be caused by your network proxy (http://example.com:8080). Check your proxy settings in Settings > Network.'
    const parsed = parseError(new Error(message))

    expect(parsed.code).toBe('proxy_error')
    expect(parsed.message).toBe(message)
  })

  it('maps raw Cloudflare HTML error page to proxy_error with sanitized message', () => {
    const rawHtml = `<html>
<head><title>400 Bad Request</title></head>
<body>
<center><h1>400 Bad Request</h1></center>
<hr><center>cloudflare</center>
</body>
</html>`

    const parsed = parseError(new Error(rawHtml))

    expect(parsed.code).toBe('proxy_error')
    expect(parsed.message).toContain('unexpected HTML error page')
    expect(parsed.message).toContain('HTTP 400')
    expect(parsed.message.toLowerCase()).toContain('proxy settings')
    expect(parsed.message.toLowerCase()).not.toContain('<html')
    expect(parsed.originalError).toBe(rawHtml)
  })

  it('does not remap regular 401 auth errors as proxy_error', () => {
    const parsed = parseError(new Error('401 Unauthorized'))

    expect(parsed.code).toBe('invalid_api_key')
  })
})

describe('parseError tool-support classification', () => {
  // Regression for the misclassification in the screenshot: an Anthropic
  // cache_control TTL ordering error mentioning `tools` in its hint string
  // was being labeled "Model Does Not Support Tools". It's an invalid_request,
  // not a tool-support refusal.
  const CACHE_CONTROL_ORDERING_ERROR =
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"system.0.cache_control.ttl: ' +
    'a ttl=\'1h\' cache_control block must not come after a ttl=\'5m\' cache_control block. ' +
    'Note that blocks are processed in the following order: `tools`, `system`, `messages`."}}'

  it('does NOT classify cache_control TTL ordering errors as model_no_tool_support', () => {
    const parsed = parseError(new Error(CACHE_CONTROL_ORDERING_ERROR))
    expect(parsed.code).not.toBe('model_no_tool_support')
  })

  it('classifies cache_control TTL ordering errors as invalid_request', () => {
    const parsed = parseError(new Error(CACHE_CONTROL_ORDERING_ERROR))
    expect(parsed.code).toBe('invalid_request')
  })

  it('still classifies explicit tool-support refusals as model_no_tool_support', () => {
    const cases = [
      'No endpoints found that support tool use for this model',
      'The model gpt-3.5-turbo-instruct does not support tools',
      'tool_use is not supported by this model',
      'function calling not available on this endpoint',
    ]
    for (const message of cases) {
      const parsed = parseError(new Error(message))
      expect(parsed.code).toBe('model_no_tool_support')
    }
  })
})

describe('parseError context overflow detection (#666)', () => {
  it('maps context_length_exceeded error to context_overflow', () => {
    const parsed = parseError(new Error('Error: context_length_exceeded - this turn would exceed the model context window'))
    expect(parsed.code).toBe('context_overflow')
  })

  it('maps "exceeds the context window" message to context_overflow', () => {
    const parsed = parseError(new Error('The request exceeds the context window of 200000 tokens'))
    expect(parsed.code).toBe('context_overflow')
  })

  it('maps "too many tokens" message to context_overflow', () => {
    const parsed = parseError(new Error('Request rejected: too many tokens for this model'))
    expect(parsed.code).toBe('context_overflow')
  })

  it('maps "token limit exceeded" message to context_overflow', () => {
    const parsed = parseError(new Error('Token limit exceeded'))
    expect(parsed.code).toBe('context_overflow')
  })

  it('returns a typed error definition with title and retry action', () => {
    const parsed = parseError(new Error('context_length_exceeded'))
    expect(parsed.title).toBeTruthy()
    expect(parsed.message).toBeTruthy()
    expect(parsed.canRetry).toBe(true)
  })

  it('does not misclassify image-too-large errors as context_overflow', () => {
    const parsed = parseError(new Error('Image dimensions exceed the 8000px limit'))
    expect(parsed.code).toBe('image_too_large')
  })

  it('does not misclassify unrelated errors as context_overflow', () => {
    const parsed = parseError(new Error('500 Internal Server Error'))
    expect(parsed.code).toBe('service_error')
  })
})

describe('scrubOmpStderr', () => {
  it('redacts common API-key shapes before stderr enters typed errors', () => {
    const stderr =
      'fatal: auth failed for sk-ant-api03-AbCdEf123456 and ghp_0123456789abcdef; ' +
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig; hex 0123456789abcdef0123456789abcdef; ' +
      'header: Bearer my-secret-bearer-token'
    const scrubbed = scrubOmpStderr(stderr)
    expect(scrubbed).not.toContain('AbCdEf123456')
    expect(scrubbed).not.toContain('ghp_0123456789abcdef')
    expect(scrubbed).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(scrubbed).not.toContain('0123456789abcdef0123456789abcdef')
    expect(scrubbed).not.toContain('my-secret-bearer-token')
    expect(scrubbed).toContain('auth failed')
  })

  it('keeps classification evidence intact (no-models message survives scrubbing)', () => {
    const scrubbed = scrubOmpStderr('No models available. Use /login or set an API key environment variable.')
    expect(scrubbed).toContain('No models available')
    expect(scrubbed).toContain('/login')
  })

  it('leaves ordinary output untouched', () => {
    expect(scrubOmpStderr('listening on port 6806')).toBe('listening on port 6806')
  })
})

describe('classifyOmpStartupExit stderr scrubbing', () => {
  it('typed error message and stderr carry no token-shaped content', () => {
    const err = classifyOmpStartupExit({
      exitCode: 1,
      signal: null,
      stderr: 'Error: invalid api key sk-ant-api03-SecretKey12345678 — aborting',
    })
    expect(err.ompCode).toBe('OMP_AUTH_REQUIRED')
    expect(err.message).not.toContain('SecretKey12345678')
    expect(err.stderr ?? '').not.toContain('SecretKey12345678')
  })
})

const OMP_STARTUP_CODES: OmpStartupErrorCode[] = [
  'OMP_NOT_CONFIGURED',
  'OMP_NO_MODELS',
  'OMP_AUTH_REQUIRED',
  'OMP_START_FAILED',
  'OMP_READY_TIMEOUT',
  'OMP_PROTOCOL_ERROR',
]

describe('ompStartupErrorToAgentError core ErrorCode union', () => {
  it('maps every OMP startup code onto AgentError.code without a string cast', () => {
    for (const code of OMP_STARTUP_CODES) {
      const agentError = ompStartupErrorToAgentError(new OmpStartupError({
        code,
        message: `${code} diagnostic`,
      }))
      expect(agentError.code).toBe(code)
      expect(isAgentErrorCode(agentError.code)).toBe(true)
      expect(agentError.title.length).toBeGreaterThan(0)
      expect(agentError.message).toContain(code)
    }
  })
})
