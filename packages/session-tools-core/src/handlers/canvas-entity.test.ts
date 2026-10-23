import { describe, it, expect } from 'bun:test';
import { handleCanvasCreateEntityCard, handleCanvasLinkEntity } from './canvas-entity.ts';
import type { CanvasToolCallbacks, SessionToolContext } from '../context.ts';

function createCtx(overrides?: Partial<CanvasToolCallbacks>): {
  ctx: SessionToolContext;
  createCalls: unknown[];
  linkCalls: unknown[];
} {
  const createCalls: unknown[] = [];
  const linkCalls: unknown[] = [];
  const canvas: CanvasToolCallbacks = {
    async createEntityCard(input) {
      createCalls.push(input);
      return { objectId: 'obj-1', entityId: 'ent-1', boardId: input.boardId };
    },
    async linkEntity(input) {
      linkCalls.push(input);
      return { objectId: 'obj-2', entityId: input.entityId, boardId: input.boardId };
    },
    ...overrides,
  };
  return {
    ctx: { sessionId: 'session-1', canvas } as unknown as SessionToolContext,
    createCalls,
    linkCalls,
  };
}

describe('handleCanvasCreateEntityCard', () => {
  it('routes through ctx.canvas and returns objectId/entityId/boardId', async () => {
    const { ctx, createCalls } = createCtx();
    const result = await handleCanvasCreateEntityCard(ctx, {
      boardId: 'board-a',
      kind: 'note',
      title: 'Hello',
      x: 10,
      y: 20,
    });
    expect(result.isError).toBeFalsy();
    expect(createCalls).toEqual([{
      boardId: 'board-a',
      kind: 'note',
      title: 'Hello',
      props: undefined,
      x: 10,
      y: 20,
    }]);
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      objectId: 'obj-1',
      entityId: 'ent-1',
      boardId: 'board-a',
    });
  });

  it('errors when canvas callbacks are missing', async () => {
    const result = await handleCanvasCreateEntityCard(
      { sessionId: 's' } as unknown as SessionToolContext,
      { boardId: 'b', kind: 'note' },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('not available');
  });

  it('rejects missing boardId or kind without calling the backend', async () => {
    const { ctx, createCalls } = createCtx();
    expect((await handleCanvasCreateEntityCard(ctx, { boardId: '  ', kind: 'note' })).isError).toBe(true);
    expect((await handleCanvasCreateEntityCard(ctx, { boardId: 'b', kind: '' })).isError).toBe(true);
    expect(createCalls).toHaveLength(0);
  });

  it('wraps backend failures as tool errors', async () => {
    const { ctx } = createCtx({
      createEntityCard: async () => {
        throw Object.assign(new Error('board not found'), { code: 'CANVAS_BOARD_MISSING' });
      },
    });
    const result = await handleCanvasCreateEntityCard(ctx, { boardId: 'missing', kind: 'note' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('CANVAS_BOARD_MISSING');
  });
});

describe('handleCanvasLinkEntity', () => {
  it('routes through ctx.canvas and returns the card ids', async () => {
    const { ctx, linkCalls } = createCtx();
    const result = await handleCanvasLinkEntity(ctx, {
      boardId: 'board-a',
      kind: 'note',
      entityId: 'n-9',
      x: 1,
      y: 2,
    });
    expect(result.isError).toBeFalsy();
    expect(linkCalls).toEqual([{
      boardId: 'board-a',
      kind: 'note',
      entityId: 'n-9',
      x: 1,
      y: 2,
    }]);
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      objectId: 'obj-2',
      entityId: 'n-9',
      boardId: 'board-a',
    });
  });

  it('rejects missing boardId, kind, or entityId', async () => {
    const { ctx, linkCalls } = createCtx();
    expect((await handleCanvasLinkEntity(ctx, { boardId: '', kind: 'note', entityId: 'n' })).isError).toBe(true);
    expect((await handleCanvasLinkEntity(ctx, { boardId: 'b', kind: '', entityId: 'n' })).isError).toBe(true);
    expect((await handleCanvasLinkEntity(ctx, { boardId: 'b', kind: 'note', entityId: ' ' })).isError).toBe(true);
    expect(linkCalls).toHaveLength(0);
  });

  it('wraps denied access as a tool error', async () => {
    const { ctx } = createCtx({
      linkEntity: async () => {
        throw Object.assign(new Error('edit denied'), { code: 'CANVAS_FORBIDDEN' });
      },
    });
    const result = await handleCanvasLinkEntity(ctx, { boardId: 'b', kind: 'note', entityId: 'n' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('CANVAS_FORBIDDEN');
  });
});
