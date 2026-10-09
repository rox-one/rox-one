import { describe, it, expect } from 'bun:test';
import { handleShowWidget } from './show-widget.ts';
import type { BoardWidgetPutInput, BoardWidgetToolRecord, SessionToolContext } from '../context.ts';

function createCtx(): { ctx: SessionToolContext; calls: BoardWidgetPutInput[] } {
  const calls: BoardWidgetPutInput[] = [];
  const ctx = {
    sessionId: 'session-1',
    boardWidgets: {
      async putWidget(input: BoardWidgetPutInput): Promise<BoardWidgetToolRecord> {
        calls.push(input);
        return { widgetId: input.name, name: input.name, kind: input.kind, revision: 1, sha256: 'a'.repeat(64), createdAt: '1970-01-01T00:00:00.000Z' };
      },
    },
  } as unknown as SessionToolContext;
  return { ctx, calls };
}

describe('handleShowWidget', () => {
  it('stages through the injected callback and returns the committed record', async () => {
    const { ctx, calls } = createCtx();
    const result = await handleShowWidget(ctx, { title: 'Chart', widget_code: '<b>x</b>', name: 'chart' });

    expect(result.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: 'chart', title: 'Chart', kind: 'html', widgetCode: '<b>x</b>', sessionId: 'session-1' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ widgetId: 'chart', revision: 1 });
  });

  it('defaults kind to html and honours an explicit a2ui kind', async () => {
    const { ctx, calls } = createCtx();
    await handleShowWidget(ctx, { title: 'Chart', widget_code: 'x', name: 'a' });
    await handleShowWidget(ctx, { title: 'Stream', widget_code: '{}', name: 'b', kind: 'a2ui', sessionId: 'session-9' });
    expect(calls[0]!.kind).toBe('html');
    expect(calls[1]).toMatchObject({ kind: 'a2ui', sessionId: 'session-9' });
  });

  it('errors when the callback is not available', async () => {
    const result = await handleShowWidget({} as unknown as SessionToolContext, { title: 'T', widget_code: 'x', name: 'n' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not available');
  });

  it('rejects a missing name, title or widget_code without calling the backend', async () => {
    const { ctx, calls } = createCtx();
    expect((await handleShowWidget(ctx, { title: 'T', widget_code: 'x', name: '  ' })).isError).toBe(true);
    expect((await handleShowWidget(ctx, { title: ' ', widget_code: 'x', name: 'n' })).isError).toBe(true);
    expect((await handleShowWidget(ctx, { title: 'T', widget_code: '', name: 'n' })).isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('wraps backend failures as tool errors', async () => {
    const ctx = {
      sessionId: 'session-1',
      boardWidgets: { putWidget: async () => { throw new Error('A2UI widgets cannot be stored until an A2UI renderer ships'); } },
    } as unknown as SessionToolContext;
    const result = await handleShowWidget(ctx, { title: 'T', widget_code: 'x', name: 'n' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('A2UI widgets cannot be stored');
  });
});