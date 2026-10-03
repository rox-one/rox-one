import type { AppConfig, AiMode } from '../app/config.js';

export interface ConversationMessage {
  sender: string;
  text: string;
  at: string;
}

export interface ConversationContext {
  peerDisplayName: string;
  messages: ConversationMessage[];
}

export interface SummaryResponse {
  summary: string;
}

export interface NudgeResponse {
  nudge: string;
}

export interface TagsResponse {
  tags: string[];
}

export interface CompanyResponse {
  companyName: string | null;
  role: string | null;
}

export interface TaskSuggestionResponse {
  shouldCreateTask: boolean;
  dueInDays: number | null;
  why: string;
  priority: 'low' | 'med' | 'high';
}

export interface RuleMatchResponse {
  matched: boolean;
  reason: string;
  setTag: string | null;
  shouldCreateTask: boolean;
  dueInDays: number | null;
  priority: 'low' | 'med' | 'high';
  why: string | null;
}

export interface AiService {
  readonly mode: AiMode;
  readonly model: string;
  summarize(context: ConversationContext): Promise<SummaryResponse>;
  summarizeSinceLastSeen(context: ConversationContext): Promise<SummaryResponse>;
  nudge(
    context: ConversationContext,
    params: { style: 'concise' | 'friendly'; avoidQuestion: boolean },
  ): Promise<NudgeResponse>;
  suggestTags(context: ConversationContext): Promise<TagsResponse>;
  suggestCompany(context: ConversationContext): Promise<CompanyResponse>;
  suggestTask(context: ConversationContext): Promise<TaskSuggestionResponse>;
  evaluateRule(params: {
    context: ConversationContext;
    ruleName: string;
    instruction: string;
  }): Promise<RuleMatchResponse>;
}

interface OpenClawChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
  }>;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

interface JsonLike {
  [key: string]: unknown;
}

function extractJsonString(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('AI response was empty.');
  }

  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }

  throw new Error(`Could not parse JSON from AI response: ${trimmed.slice(0, 200)}`);
}

function parseJson<T>(raw: string): T {
  const jsonString = extractJsonString(raw);
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    throw new Error(
      `AI returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function priorityValue(value: unknown): 'low' | 'med' | 'high' {
  if (value === 'low' || value === 'med' || value === 'high') {
    return value;
  }
  return 'med';
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim();
    if (!tag) continue;
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  return tags.slice(0, 12);
}

function normalizeSummary(value: unknown): SummaryResponse {
  if (typeof value === 'object' && value) {
    const summaryRaw = (value as JsonLike).summary;
    if (typeof summaryRaw === 'string') {
      const summary = summaryRaw.trim();
      if (summary) return { summary };
    }
  }
  throw new Error('AI summary response missing "summary" string.');
}

function normalizeNudge(value: unknown): NudgeResponse {
  if (typeof value === 'object' && value) {
    const nudgeRaw = (value as JsonLike).nudge;
    if (typeof nudgeRaw === 'string') {
      const nudge = nudgeRaw.trim();
      if (nudge) return { nudge };
    }
  }
  throw new Error('AI nudge response missing "nudge" string.');
}

function normalizeTagsResponse(value: unknown): TagsResponse {
  if (typeof value === 'object' && value && 'tags' in (value as JsonLike)) {
    return { tags: normalizeTags((value as JsonLike).tags) };
  }
  throw new Error('AI tags response missing "tags" array.');
}

function normalizeCompanyResponse(value: unknown): CompanyResponse {
  const row = (typeof value === 'object' && value ? (value as JsonLike) : {}) as JsonLike;
  const companyNameRaw = row.companyName;
  const roleRaw = row.role;
  const companyName =
    typeof companyNameRaw === 'string' && companyNameRaw.trim()
      ? companyNameRaw.trim()
      : null;
  const role = typeof roleRaw === 'string' && roleRaw.trim() ? roleRaw.trim() : null;
  return { companyName, role };
}

function normalizeTaskResponse(value: unknown): TaskSuggestionResponse {
  const row = (typeof value === 'object' && value ? (value as JsonLike) : {}) as JsonLike;
  const shouldCreateTask = Boolean(row.shouldCreateTask);
  const dueInDaysRaw = typeof row.dueInDays === 'number' ? Math.round(row.dueInDays) : null;
  const dueInDays =
    dueInDaysRaw && Number.isInteger(dueInDaysRaw) && dueInDaysRaw > 0
      ? Math.min(30, dueInDaysRaw)
      : null;
  const whyRaw = row.why;
  const why =
    typeof whyRaw === 'string' && whyRaw.trim()
      ? whyRaw.trim()
      : 'AI-suggested follow-up.';
  return {
    shouldCreateTask,
    dueInDays,
    why,
    priority: priorityValue(row.priority),
  };
}

function normalizeRuleResponse(value: unknown): RuleMatchResponse {
  const row = (typeof value === 'object' && value ? (value as JsonLike) : {}) as JsonLike;
  const matched = Boolean(row.matched);
  const reasonRaw = row.reason;
  const reason =
    typeof reasonRaw === 'string' && reasonRaw.trim()
      ? reasonRaw.trim()
      : matched
        ? 'Matched by AI.'
        : 'Not matched by AI.';
  const setTagRaw = row.setTag;
  const setTag =
    typeof setTagRaw === 'string' && setTagRaw.trim() ? setTagRaw.trim() : null;

  const shouldCreateTaskRaw = row.shouldCreateTask;
  const shouldCreateTask =
    typeof shouldCreateTaskRaw === 'boolean' ? shouldCreateTaskRaw : false;

  const dueInDaysRaw = typeof row.dueInDays === 'number' ? Math.round(row.dueInDays) : null;
  const dueInDays =
    dueInDaysRaw && Number.isInteger(dueInDaysRaw) && dueInDaysRaw > 0
      ? Math.min(30, dueInDaysRaw)
      : null;

  const whyRaw = row.why;
  const why = typeof whyRaw === 'string' && whyRaw.trim() ? whyRaw.trim() : null;

  return {
    matched,
    reason,
    setTag,
    shouldCreateTask,
    dueInDays,
    priority: priorityValue(row.priority),
    why,
  };
}

function renderConversation(context: ConversationContext): string {
  const messages = context.messages
    .slice(-80)
    .map((message) => `[${message.at}] ${message.sender}: ${message.text}`)
    .join('\n');

  return `Peer: ${context.peerDisplayName}\nMessages:\n${messages || '(no messages)'}`;
}

function withTimeoutSignal(timeoutMs: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref();
  return controller;
}

const OPENCLAW_MAX_ATTEMPTS = 4;
const OPENCLAW_RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const OPENCLAW_RETRY_BASE_DELAY_MS = 100;
const OPENCLAW_RETRY_MAX_DELAY_MS = 800;
const OPENCLAW_PREFLIGHT_TIMEOUT_MS = 5_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: unknown }).name === 'AbortError')
  );
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

abstract class BaseAiService implements AiService {
  abstract readonly mode: AiMode;
  abstract readonly model: string;

  protected abstract completeJson<T>(prompt: string): Promise<T>;

  async summarize(context: ConversationContext): Promise<SummaryResponse> {
    const output = await this.completeJson<unknown>(
      [
        'You are a CRM assistant. Summarize this Telegram conversation for business context.',
        'Return strict JSON: {"summary":"string"}',
        'Keep it concise and factual, no markdown.',
        renderConversation(context),
      ].join('\n\n'),
    );
    return normalizeSummary(output);
  }

  async summarizeSinceLastSeen(context: ConversationContext): Promise<SummaryResponse> {
    const output = await this.completeJson<unknown>(
      [
        'You are a CRM assistant.',
        'Summarize only what changed recently and what follow-up context matters now.',
        'Return strict JSON: {"summary":"string"}',
        'Keep it concise and factual, no markdown.',
        renderConversation(context),
      ].join('\n\n'),
    );
    return normalizeSummary(output);
  }

  async nudge(
    context: ConversationContext,
    params: { style: 'concise' | 'friendly'; avoidQuestion: boolean },
  ): Promise<NudgeResponse> {
    const questionInstruction = params.avoidQuestion
      ? 'Do not ask a question in the nudge. Use a declarative next-step suggestion.'
      : 'A question is allowed if useful.';
    const output = await this.completeJson<unknown>(
      [
        'You are a CRM assistant writing one follow-up message.',
        `Style: ${params.style}.`,
        'Return strict JSON: {"nudge":"string"}',
        'The nudge should be one short message, specific and polite.',
        questionInstruction,
        renderConversation(context),
      ].join('\n\n'),
    );
    return normalizeNudge(output);
  }

  async suggestTags(context: ConversationContext): Promise<TagsResponse> {
    const output = await this.completeJson<unknown>(
      [
        'You are a CRM classifier for Telegram conversations.',
        'Return strict JSON: {"tags":["string"]}.',
        'Tags should be short CRM labels, max 12 tags.',
        renderConversation(context),
      ].join('\n\n'),
    );
    return normalizeTagsResponse(output);
  }

  async suggestCompany(context: ConversationContext): Promise<CompanyResponse> {
    const output = await this.completeJson<unknown>(
      [
        'Infer likely company and role from conversation context.',
        'Return strict JSON: {"companyName":"string|null","role":"string|null"}',
        'If unknown, return null values.',
        renderConversation(context),
      ].join('\n\n'),
    );
    return normalizeCompanyResponse(output);
  }

  async suggestTask(context: ConversationContext): Promise<TaskSuggestionResponse> {
    const output = await this.completeJson<unknown>(
      [
        'Decide if a follow-up task should be created.',
        'Return strict JSON: {"shouldCreateTask":boolean,"dueInDays":number|null,"why":"string","priority":"low|med|high"}',
        'Set dueInDays to 1-30 when shouldCreateTask=true, else null.',
        renderConversation(context),
      ].join('\n\n'),
    );
    return normalizeTaskResponse(output);
  }

  async evaluateRule(params: {
    context: ConversationContext;
    ruleName: string;
    instruction: string;
  }): Promise<RuleMatchResponse> {
    const output = await this.completeJson<unknown>(
      [
        'Evaluate this automation rule against the conversation and latest messages.',
        `Rule name: ${params.ruleName}`,
        `Rule instruction: ${params.instruction}`,
        'Return strict JSON: {"matched":boolean,"reason":"string","setTag":"string|null","shouldCreateTask":boolean,"dueInDays":number|null,"priority":"low|med|high","why":"string|null"}',
        'If matched=false then setTag should be null and shouldCreateTask should be false.',
        'Use dueInDays in range 1-30 when shouldCreateTask=true, else null.',
        renderConversation(params.context),
      ].join('\n\n'),
    );
    return normalizeRuleResponse(output);
  }
}

class GeminiAiService extends BaseAiService {
  readonly mode = 'gemini';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
  ) {
    super();
  }

  protected async completeJson<T>(prompt: string): Promise<T> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const controller = withTimeoutSignal(this.timeoutMs);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gemini request failed (${response.status}): ${errorBody.slice(0, 300)}`);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('\n')
      .trim();
    if (!text) {
      throw new Error('Gemini returned an empty response.');
    }
    return parseJson<T>(text);
  }
}

class OpenClawAiService extends BaseAiService {
  readonly mode = 'openclaw';
  private readonly normalizedBaseUrl: string;
  private preflightPromise: Promise<void> | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly model: string,
    private readonly timeoutMs: number,
  ) {
    super();
    this.normalizedBaseUrl = this.baseUrl.replace(/\/+$/, '');
  }

  protected async completeJson<T>(prompt: string): Promise<T> {
    await this.ensureHealthy();
    const response = await this.requestWithRetry({
      failurePrefix: 'OpenClaw request failed',
      timeoutMs: this.timeoutMs,
      request: (signal) =>
        fetch(`${this.normalizedBaseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: this.buildJsonHeaders(),
          body: JSON.stringify({
            model: this.model,
            temperature: 0.2,
            messages: [
              {
                role: 'system',
                content:
                  'You are a strict JSON API. Output valid JSON only, without markdown fences.',
              },
              { role: 'user', content: prompt },
            ],
          }),
          signal,
        }),
    });

    const payload = (await response.json()) as OpenClawChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
              .join('\n')
          : '';
    if (!text.trim()) {
      throw new Error('OpenClaw returned an empty response.');
    }
    return parseJson<T>(text);
  }

  private buildJsonHeaders(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  private buildAuthHeaders(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }

  private async ensureHealthy(): Promise<void> {
    if (!this.preflightPromise) {
      this.preflightPromise = this.runPreflight();
    }
    try {
      await this.preflightPromise;
    } catch (error) {
      this.preflightPromise = undefined;
      throw error;
    }
  }

  private async runPreflight(): Promise<void> {
    await this.requestWithRetry({
      failurePrefix: 'OpenClaw health preflight failed',
      timeoutMs: Math.min(this.timeoutMs, OPENCLAW_PREFLIGHT_TIMEOUT_MS),
      allowStatus: (status) => status === 404 || status === 405,
      request: (signal) =>
        fetch(`${this.normalizedBaseUrl}/v1/models`, {
          method: 'GET',
          headers: this.buildAuthHeaders(),
          signal,
        }),
    });
  }

  private async requestWithRetry(params: {
    failurePrefix: string;
    timeoutMs: number;
    request: (signal: AbortSignal) => Promise<Response>;
    allowStatus?: (status: number) => boolean;
  }): Promise<Response> {
    let lastRetriableError: Error | undefined;

    for (let attempt = 1; attempt <= OPENCLAW_MAX_ATTEMPTS; attempt += 1) {
      const controller = withTimeoutSignal(params.timeoutMs);
      let response: Response;
      try {
        response = await params.request(controller.signal);
      } catch (error) {
        if (this.shouldRetryError(error) && attempt < OPENCLAW_MAX_ATTEMPTS) {
          await delay(this.retryDelay(attempt));
          continue;
        }
        throw this.wrapRequestError(params.failurePrefix, error, attempt);
      }

      if (response.ok || params.allowStatus?.(response.status)) {
        return response;
      }

      const body = (await response.text()).slice(0, 300);
      const error = this.wrapStatusError(params.failurePrefix, response.status, body, attempt);
      if (this.shouldRetryStatus(response.status) && attempt < OPENCLAW_MAX_ATTEMPTS) {
        lastRetriableError = error;
        await delay(this.retryDelay(attempt));
        continue;
      }
      throw error;
    }

    throw (
      lastRetriableError ??
      new Error(
        `${params.failurePrefix} after ${OPENCLAW_MAX_ATTEMPTS} attempts: unknown retry failure.`,
      )
    );
  }

  private shouldRetryStatus(status: number): boolean {
    return OPENCLAW_RETRYABLE_STATUSES.has(status);
  }

  private shouldRetryError(error: unknown): boolean {
    return isAbortError(error) || error instanceof TypeError;
  }

  private retryDelay(attempt: number): number {
    return Math.min(
      OPENCLAW_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)),
      OPENCLAW_RETRY_MAX_DELAY_MS,
    );
  }

  private wrapStatusError(
    failurePrefix: string,
    status: number,
    body: string,
    attempt: number,
  ): Error {
    if (attempt > 1) {
      return new Error(
        `${failurePrefix} after ${attempt} attempts (${status}): ${body}`,
      );
    }
    return new Error(`${failurePrefix} (${status}): ${body}`);
  }

  private wrapRequestError(
    failurePrefix: string,
    error: unknown,
    attempt: number,
  ): Error {
    if (isAbortError(error)) {
      if (attempt > 1) {
        return new Error(
          `${failurePrefix} after ${attempt} attempts: request timed out after ${this.timeoutMs}ms.`,
        );
      }
      return new Error(`${failurePrefix}: request timed out after ${this.timeoutMs}ms.`);
    }

    const message = normalizeErrorMessage(error);
    if (attempt > 1) {
      return new Error(`${failurePrefix} after ${attempt} attempts: ${message}`);
    }
    return new Error(`${failurePrefix}: ${message}`);
  }
}

export function createAiService(config: AppConfig): AiService | undefined {
  if (!config.aiMode) {
    return undefined;
  }

  if (config.aiMode === 'gemini') {
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is required for AI_MODE=gemini.');
    }
    return new GeminiAiService(config.geminiApiKey, config.geminiModel, config.aiTimeoutMs);
  }

  if (!config.openclawBaseUrl) {
    throw new Error('OPENCLAW_BASE_URL is required for AI_MODE=openclaw.');
  }

  return new OpenClawAiService(
    config.openclawBaseUrl,
    config.openclawApiKey,
    config.openclawModel,
    config.aiTimeoutMs,
  );
}
