import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from './app/config.js';
import { createAiService } from './ai/service.js';

function openClawConfig(): AppConfig {
  return {
    apiId: 1,
    apiHash: 'hash',
    sessionPath: '/tmp/test.session',
    limit: 5,
    all: false,
    accountLabel: 'default',
    geminiModel: 'gemini-2.0-flash',
    openclawModel: 'openclaw:main',
    aiTimeoutMs: 5_000,
    jsonOutput: false,
    aiMode: 'openclaw',
    openclawBaseUrl: 'https://openclaw.example',
    openclawApiKey: 'test-token',
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

const context = {
  peerDisplayName: 'Telegram',
  messages: [
    {
      sender: 'Telegram',
      text: 'Your login code is 12345',
      at: new Date('2026-03-04T00:00:00Z').toISOString(),
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OpenClawAiService', () => {
  it('runs health preflight before chat completion', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: '{"tags":["security-alert"]}' } }],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const ai = createAiService(openClawConfig());
    if (!ai) {
      throw new Error('Expected OpenClaw AI service.');
    }

    const result = await ai.suggestTags(context);
    expect(result.tags).toEqual(['security-alert']);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [preflightUrl, preflightInit] = fetchMock.mock.calls[0]!;
    expect(String(preflightUrl)).toBe('https://openclaw.example/v1/models');
    expect(preflightInit?.method).toBe('GET');

    const [completionUrl, completionInit] = fetchMock.mock.calls[1]!;
    expect(String(completionUrl)).toBe('https://openclaw.example/v1/chat/completions');
    expect(completionInit?.method).toBe('POST');
    expect(completionInit?.headers).toEqual(
      expect.objectContaining({ authorization: 'Bearer test-token' }),
    );
  });

  it('retries transient 503 responses from chat completions', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(textResponse('no available server', 503))
      .mockResolvedValueOnce(textResponse('no available server', 503))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: '{"tags":["system"]}' } }],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const ai = createAiService(openClawConfig());
    if (!ai) {
      throw new Error('Expected OpenClaw AI service.');
    }

    const result = await ai.suggestTags(context);
    expect(result.tags).toEqual(['system']);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('fails fast when health preflight is unauthorized', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(textResponse('unauthorized', 401));
    vi.stubGlobal('fetch', fetchMock);

    const ai = createAiService(openClawConfig());
    if (!ai) {
      throw new Error('Expected OpenClaw AI service.');
    }

    await expect(ai.suggestTags(context)).rejects.toThrow(
      'OpenClaw health preflight failed (401): unauthorized',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
