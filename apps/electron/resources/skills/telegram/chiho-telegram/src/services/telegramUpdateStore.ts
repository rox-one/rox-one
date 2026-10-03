import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppConfig } from '../app/config.js';
import type { TelegramClient } from '@mtcute/node';
import type { OpaqueCursorCodec } from './opaqueCursor.js';
import { listDialogs } from './telegram.js';

const MAX_RETAINED_EVENTS = 500;

interface StoredUpdateEvent {
  sequence: number;
  id: string;
  type: string;
  occurredAt: string;
  peer: string | null;
  messageId: number | null;
}

interface UpdateStoreState {
  epoch: string;
  nextSequence: number;
  snapshots: Record<string, number | null>;
  events: StoredUpdateEvent[];
}

interface UpdateCursorState {
  epoch: string;
  sequence: number;
}

function statePath(config: AppConfig) {
  return join(dirname(config.sessionPath), 'telegram-update-events.json');
}

function freshState(): UpdateStoreState {
  return {
    epoch: randomUUID(),
    nextSequence: 1,
    snapshots: {},
    events: [],
  };
}

async function loadState(config: AppConfig) {
  const raw = await readFile(statePath(config), 'utf8').catch(() => null);
  if (!raw) return freshState();
  try {
    const state = JSON.parse(raw) as UpdateStoreState;
    if (!state.epoch || !Number.isSafeInteger(state.nextSequence)) return freshState();
    return state;
  } catch {
    return freshState();
  }
}

async function saveState(config: AppConfig, state: UpdateStoreState) {
  await mkdir(dirname(statePath(config)), { recursive: true });
  await writeFile(statePath(config), JSON.stringify(state, null, 2));
}

async function sampleDialogChanges(client: TelegramClient, state: UpdateStoreState) {
  const dialogs = await listDialogs(client, {
    all: false,
    includeArchived: true,
    limit: 200,
  });
  const nextSnapshots: Record<string, number | null> = {};
  const initialized = Object.keys(state.snapshots).length > 0;
  for (const dialog of dialogs) {
    const peer = String(dialog.peer.id);
    const messageId = dialog.lastMessage?.id ?? null;
    nextSnapshots[peer] = messageId;
    if (!initialized || messageId === null || state.snapshots[peer] === messageId) continue;
    state.events.push({
      sequence: state.nextSequence,
      id: `${state.epoch}:${state.nextSequence}`,
      type: 'dialog.last_message_changed',
      occurredAt: new Date().toISOString(),
      peer,
      messageId,
    });
    state.nextSequence += 1;
  }
  state.snapshots = nextSnapshots;
  state.events = state.events.slice(-MAX_RETAINED_EVENTS);
}

export async function pollTelegramUpdates(
  client: TelegramClient,
  config: AppConfig,
  codec: OpaqueCursorCodec,
  input: { cursor?: string; limit: number },
) {
  const state = await loadState(config);
  await sampleDialogChanges(client, state);

  let requestedSequence = state.nextSequence - 1;
  let gapDetected = false;
  if (input.cursor) {
    const decoded = codec.decode<UpdateCursorState>(
      input.cursor,
      'updates',
      config.accountLabel,
    );
    if (decoded.epoch !== state.epoch) {
      gapDetected = true;
    } else {
      requestedSequence = decoded.sequence;
      const earliest = state.events[0]?.sequence ?? state.nextSequence;
      if (requestedSequence < earliest - 1) gapDetected = true;
    }
  }

  const events = gapDetected
    ? []
    : state.events
        .filter((event) => event.sequence > requestedSequence)
        .slice(0, input.limit);
  const sequence = events.at(-1)?.sequence ?? state.nextSequence - 1;
  const nextCursor = codec.encode<UpdateCursorState>(
    'updates',
    config.accountLabel,
    { epoch: state.epoch, sequence },
  );
  await saveState(config, state);
  return {
    epoch: state.epoch,
    gapDetected,
    nextCursor,
    events: events.map(({ sequence: _sequence, ...event }) => event),
    reconcileWith: gapDetected ? ['dialogs.list', 'chat.read'] : [],
  };
}
