import type { TelegramClient } from "@mtcute/node";
import {
  dialogInventoryKey,
  fetchTelegramDialogFolderPage,
  getTelegramDialogTotals,
  mapDialogInventoryItem,
  type TelegramDialogInventoryItem,
  type TelegramDialogLocation,
  type TelegramDialogOffset,
  type TelegramDialogTotals,
} from "./telegram.js";

export interface DialogInventoryCursorState {
  phase: "active" | "archived";
  offset: TelegramDialogOffset | null;
  seenActive: number;
  seenArchived: number;
}

export interface DialogInventoryPageResult {
  totals: TelegramDialogTotals;
  inventoryTotal: number;
  dialogs: TelegramDialogInventoryItem[];
  nextState: DialogInventoryCursorState | null;
}

function totalForLocation(
  totals: TelegramDialogTotals,
  location: TelegramDialogLocation,
) {
  if (location === "active") return totals.activeTotal;
  if (location === "archived") return totals.archivedTotal;
  return totals.allTotal;
}

function firstPhase(location: TelegramDialogLocation): "active" | "archived" {
  return location === "archived" ? "archived" : "active";
}

function phaseTotal(totals: TelegramDialogTotals, phase: "active" | "archived") {
  return phase === "active" ? totals.activeTotal : totals.archivedTotal;
}

function phaseSeen(state: DialogInventoryCursorState) {
  return state.phase === "active" ? state.seenActive : state.seenArchived;
}

function moveToNextPhase(
  state: DialogInventoryCursorState,
  location: TelegramDialogLocation,
): DialogInventoryCursorState | null {
  if (location !== "all" || state.phase === "archived") return null;
  return {
    phase: "archived",
    offset: null,
    seenActive: state.seenActive,
    seenArchived: state.seenArchived,
  };
}

export async function listTelegramDialogInventoryPage(
  client: TelegramClient,
  params: {
    location: TelegramDialogLocation;
    pageSize: number;
    state?: DialogInventoryCursorState | null;
  },
): Promise<DialogInventoryPageResult> {
  const totals = await getTelegramDialogTotals(client);
  let state: DialogInventoryCursorState = params.state ?? {
    phase: firstPhase(params.location),
    offset: null,
    seenActive: 0,
    seenArchived: 0,
  };
  const dialogs: TelegramDialogInventoryItem[] = [];
  const seenKeys = new Set<string>();
  let nextState: DialogInventoryCursorState | null = state;

  while (nextState && dialogs.length < params.pageSize) {
    state = nextState;
    const available = phaseTotal(totals, state.phase);
    if (available === 0 || phaseSeen(state) >= available) {
      nextState = moveToNextPhase(state, params.location);
      continue;
    }

    const page = await fetchTelegramDialogFolderPage(client, {
      location: state.phase,
      limit: Math.max(1, params.pageSize - dialogs.length),
      offset: state.offset,
    });
    if (page.dialogs.length === 0) {
      nextState = moveToNextPhase(state, params.location);
      continue;
    }

    for (const dialog of page.dialogs) {
      const key = dialogInventoryKey(dialog);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      dialogs.push(mapDialogInventoryItem(dialog));
    }

    const seenActive =
      state.seenActive + (state.phase === "active" ? page.dialogs.length : 0);
    const seenArchived =
      state.seenArchived + (state.phase === "archived" ? page.dialogs.length : 0);
    const nextForPhase: DialogInventoryCursorState = {
      phase: state.phase,
      offset: page.nextOffset,
      seenActive,
      seenArchived,
    };
    const exhausted =
      !page.nextOffset ||
      (state.phase === "active" ? seenActive : seenArchived) >= available;
    nextState = exhausted
      ? moveToNextPhase(nextForPhase, params.location)
      : nextForPhase;
  }

  return {
    totals,
    inventoryTotal: totalForLocation(totals, params.location),
    dialogs,
    nextState,
  };
}
