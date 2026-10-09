import { describe, expect, test } from 'bun:test'
import {
  createS3UploadTarget,
  encodeObjectKeyPath,
  s3TargetOptionsFromEnv,
  signAwsV4,
} from '../r2-target'
import type { DriveUploadTarget } from '../types'

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

interface CapturedRequest {
  url: string
  method?: string
  headers: Record<string, string>
  body: unknown
  duplex?: string
}

function fixedFetch(response: Response, captured: CapturedRequest[]): typeof fetch {
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = init?.headers && !(init.headers instanceof Headers) && !Array.isArray(init.headers)
      ? (init.headers as Record<string, string>)
      : {}
    const duplex = init && 'duplex' in init && typeof init.duplex === 'string' ? init.duplex : undefined
    captured.push({ url: String(input), method: init?.method, headers, body: init?.body, duplex })
    return response
  }
  return impl as unknown as typeof fetch
}

describe('AWS SigV4 signing', () => {
  test('matches the documented AWS example signature', async () => {
    const result = await signAwsV4({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { range: 'bytes=0-9' },
      payloadHash: EMPTY_SHA256,
      region: 'us-east-1',
      service: 's3',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      date: new Date('2013-05-24T00:00:00Z'),
    })

    expect(result.scope).toBe('20130524/us-east-1/s3/aws4_request')
    expect(result.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
    expect(result.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,'
      + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,'
      + `Signature=${result.signature}`,
    )
    expect(result.headers).toMatchObject({
      host: 'examplebucket.s3.amazonaws.com',
      range: 'bytes=0-9',
      'x-amz-date': '20130524T000000Z',
      'x-amz-content-sha256': EMPTY_SHA256,
    })
  })

  test('collapses whitespace and sorts signed header names', async () => {
    const result = await signAwsV4({
      method: 'put',
      url: 'https://s3.example/bucket/file.txt',
      headers: { 'x-amz-meta-note': '  a   b  ', 'content-type': 'text/plain' },
      payloadHash: EMPTY_SHA256,
      region: 'auto',
      accessKeyId: 'KEY',
      secretAccessKey: 'SECRET',
      date: new Date('2026-01-01T00:00:00Z'),
    })
    expect(result.canonicalRequest).toContain('x-amz-meta-note:a b\n')
    expect(result.authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-meta-note',
    )
  })

  test('sorts the canonical query by encoded name, then value', async () => {
    const result = await signAwsV4({
      method: 'GET',
      // `a` is a prefix of `a-b`: sorting the joined `name=value` strings would
      // put `a-b=2` first, but the canonical order is by name.
      url: 'https://s3.example/bucket?b=2&a-b=2&a=1',
      payloadHash: EMPTY_SHA256,
      region: 'auto',
      accessKeyId: 'KEY',
      secretAccessKey: 'SECRET',
      date: new Date('2026-01-01T00:00:00Z'),
    })
    expect(result.canonicalRequest.split('\n')[2]).toBe('a=1&a-b=2&b=2')
  })
})

describe('encodeObjectKeyPath', () => {
  test('encodes reserved characters but preserves separators', () => {
    expect(encodeObjectKeyPath('Folder a/b+c#d.txt')).toBe('Folder%20a/b%2Bc%23d.txt')
  })

  test('percent-encodes dot segments so they cannot escape the prefix', () => {
    expect(encodeObjectKeyPath('job/../x')).toBe('job/%2E%2E/x')
    expect(encodeObjectKeyPath('job/./x')).toBe('job/%2E/x')
    // A dot inside a segment is left untouched (only whole `.`/`..` segments).
    expect(encodeObjectKeyPath('job/a.b/x')).toBe('job/a.b/x')
  })
})

describe('s3TargetOptionsFromEnv', () => {
  test('returns null until all five variables are present', () => {
    expect(s3TargetOptionsFromEnv({})).toBeNull()
    expect(s3TargetOptionsFromEnv({
      ROX_DRIVE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      ROX_DRIVE_S3_BUCKET: 'drive',
      ROX_DRIVE_S3_ACCESS_KEY_ID: 'key',
    })).toBeNull()
  })

  test('defaults the region to auto', () => {
    const options = s3TargetOptionsFromEnv({
      ROX_DRIVE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      ROX_DRIVE_S3_BUCKET: 'drive',
      ROX_DRIVE_S3_ACCESS_KEY_ID: 'key',
      ROX_DRIVE_S3_SECRET_ACCESS_KEY: 'secret',
    })
    expect(options).toMatchObject({ bucket: 'drive', region: 'auto', accessKeyId: 'key' })
  })
})

describe('createS3UploadTarget', () => {
  const base = {
    endpoint: 'https://acct.r2.cloudflarestorage.com/',
    bucket: 'drive',
    region: 'auto',
    accessKeyId: 'KEY',
    secretAccessKey: 'SECRET',
    now: () => new Date('2026-01-01T00:00:00Z'),
  }

  test('PUTs a byte body with a signed payload hash', async () => {
    const captured: CapturedRequest[] = []
    const target: DriveUploadTarget = createS3UploadTarget({
      ...base,
      fetch: fixedFetch(new Response('', { status: 200 }), captured),
    })
    await target.put('Folder a/report.txt', new Uint8Array(0), { sizeBytes: 0, contentType: 'text/plain' })

    expect(captured).toHaveLength(1)
    const request = captured[0]!
    expect(request.url).toBe('https://acct.r2.cloudflarestorage.com/drive/Folder%20a/report.txt')
    expect(request.headers['x-amz-content-sha256']).toBe(EMPTY_SHA256)
    expect(request.headers['x-amz-date']).toBe('20260101T000000Z')
    expect(request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 Credential=KEY/20260101/auto/s3/aws4_request')).toBe(true)
    expect(request.method).toBe('PUT')
    expect(request.body).toBeInstanceOf(Uint8Array)
  })

  test('streams an unknown-length body with UNSIGNED-PAYLOAD and half-duplex', async () => {
    const captured: CapturedRequest[] = []
    const target = createS3UploadTarget({
      ...base,
      fetch: fixedFetch(new Response('', { status: 200 }), captured),
    })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
    })
    await target.put('stream.bin', stream)

    expect(captured[0]!.headers['x-amz-content-sha256']).toBe('UNSIGNED-PAYLOAD')
    expect(captured[0]!.duplex).toBe('half')
  })

  test('throws a coded error on a non-2xx response', async () => {
    const target = createS3UploadTarget({
      ...base,
      fetch: fixedFetch(new Response('denied', { status: 403, statusText: 'Forbidden' }), []),
    })
    await expect(target.put('x.txt', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'DRIVE_IMPORT_S3_PUT_FAILED',
      status: 403,
    })
  })

  test('escapes dot segments so a key cannot escape the job prefix when signed and fetched', async () => {
    const captured: CapturedRequest[] = []
    const target = createS3UploadTarget({
      ...base,
      fetch: fixedFetch(new Response('', { status: 200 }), captured),
    })
    await target.put('job/../x', new Uint8Array(0), { sizeBytes: 0 })

    expect(captured).toHaveLength(1)
    const request = captured[0]!
    // WHATWG URL normalisation would collapse `job/../x`; the escaped key is
    // what is signed and sent so the object stays under the job prefix.
    expect(request.url).toBe('https://acct.r2.cloudflarestorage.com/drive/job/%2E%2E/x')
    expect(new URL('https://acct.r2.cloudflarestorage.com/drive/job/../x').pathname).toBe('/drive/x')

    // The signature binds the escaped path, not the collapsed one.
    const signing = {
      method: 'PUT',
      headers: { 'content-length': '0' },
      payloadHash: EMPTY_SHA256,
      region: 'auto',
      accessKeyId: 'KEY',
      secretAccessKey: 'SECRET',
      date: new Date('2026-01-01T00:00:00Z'),
    }
    const escaped = await signAwsV4({ ...signing, url: request.url })
    const collapsed = await signAwsV4({ ...signing, url: 'https://acct.r2.cloudflarestorage.com/drive/x' })
    expect(escaped.canonicalRequest.split('\n')[1]).toBe('/drive/job/%2E%2E/x')
    expect(collapsed.canonicalRequest.split('\n')[1]).toBe('/drive/x')
    expect(request.headers.authorization).toBe(escaped.authorization)
    expect(escaped.signature).not.toBe(collapsed.signature)
  })
})