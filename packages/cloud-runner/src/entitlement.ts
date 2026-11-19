/**
 * Wallet ledger for Rox Cloud paid provisioning (BYOK mode).
 *
 * The customer pays their own provider (Daytona / Modal / E2B) directly, so
 * the wallet only ever carries the platform fee. Provider compute prices must
 * never reach this file.
 *
 * Money is integer cents everywhere; no floats, no dollars on this path.
 * Every balance change writes a double-entry pair: the customer row and its
 * opposite (`reserve` or `revenue`). The two amounts sum to zero, so the
 * ledger is auditable by addition alone and a lost or replayed call cannot
 * silently invent money.
 *
 * Invariants, readable straight off the ledger:
 *   sum(amountCents where counterparty = 'customer') === balanceCents
 *   sum(amountCents where counterparty = 'reserve')  === reservedCents
 *   sum(amountCents where counterparty = 'revenue')  === -(balanceCents + reservedCents)
 *   sum(amountCents, all rows)                       === 0
 *
 * Read the revenue bucket as the platform's unsettled liability: a top-up
 * credits it negatively, a settlement earns part of it back.
 *
 * Nothing here throws a plain `Error`: an unknown account, a negative amount
 * or a non-integer amount is a `CloudRunnerError` with code `provider_error`.
 */

import { CloudRunnerError } from './types.ts';

// ============================================================
// Account
// ============================================================

export interface Account {
  id: string;
  /** Paid accounts may provision; unpaid ones never reserve. */
  paid: boolean;
  /** Spendable money now, already net of outstanding reservations. */
  balanceCents: number;
  /** Held for sandboxes that are still running, settled on stop. */
  reservedCents: number;
  /** Hard monthly ceiling in cents; `0` means unlimited. */
  monthlyCapCents: number;
  /** Settled spend in the current billing month; the caller resets it monthly. */
  monthSpentCents: number;
}

export type LedgerKind = 'topup' | 'reserve' | 'release' | 'settle';

/**
 * One row of the double-entry ledger.
 *
 * `amountCents` is signed and is the change applied to the row's own
 * counterparty bucket. `balanceAfterCents` / `reservedAfterCents` describe the
 * account right after the operation that wrote this row, and are identical for
 * both rows of a pair.
 */
export interface LedgerEntry {
  id: string;
  accountId: string;
  kind: LedgerKind;
  amountCents: number;
  balanceAfterCents: number;
  reservedAfterCents: number;
  ref: string;
  at: number;
  counterparty: 'customer' | 'reserve' | 'revenue';
  /** Cents the customer owed but the wallet could not cover; never negative balance. */
  shortfallCents?: number;
}

/** A hold placed for one sandbox, keyed by its ref (the sandbox id). */
export interface Reservation {
  ref: string;
  cents: number;
}

export interface MoneyStore {
  getAccount(id: string): Account | undefined;
  saveAccount(account: Account): void;
  appendLedger(entry: LedgerEntry): void;
  listReservations(accountId: string): Reservation[];
  /** Cents currently held for `ref`, or `undefined` when nothing is held. */
  findReservation(accountId: string, ref: string): number | undefined;
  putReservation(accountId: string, ref: string, cents: number): void;
  dropReservation(accountId: string, ref: string): void;
  nextId(): string;
  /**
   * Ledger rows in append order, both sides of every pair, optionally narrowed
   * to one account. Read-only: a caller that reorders or filters the result
   * cannot change the ledger.
   */
  listLedger(accountId?: string): LedgerEntry[];
}

/** In-memory store; the ledger read-back is for tests and operator views. */
export type MemoryMoneyStore = MoneyStore;

export function createMemoryMoneyStore(seed: readonly Account[] = []): MemoryMoneyStore {
  const accounts = new Map<string, Account>();
  const ledger: LedgerEntry[] = [];
  const reservations = new Map<string, Map<string, number>>();
  let sequence = 0;
  for (const account of seed) accounts.set(account.id, { ...account });

  return {
    getAccount(id) {
      const account = accounts.get(id);
      return account ? { ...account } : undefined;
    },
    saveAccount(account) {
      accounts.set(account.id, { ...account });
    },
    appendLedger(entry) {
      ledger.push({ ...entry });
    },
    listReservations(accountId) {
      const held = reservations.get(accountId);
      if (!held) return [];
      return [...held].map(([ref, cents]) => ({ ref, cents }));
    },
    findReservation(accountId, ref) {
      return reservations.get(accountId)?.get(ref);
    },
    putReservation(accountId, ref, cents) {
      const held = reservations.get(accountId) ?? new Map<string, number>();
      held.set(ref, cents);
      reservations.set(accountId, held);
    },
    dropReservation(accountId, ref) {
      reservations.get(accountId)?.delete(ref);
    },
    nextId() {
      sequence += 1;
      return `led_${sequence.toString(36)}`;
    },
    listLedger(accountId) {
      return ledger
        .filter((entry) => accountId === undefined || entry.accountId === accountId)
        .map((entry) => ({ ...entry }));
    },
  };
}

// ============================================================
// Guards
// ============================================================

function moneyError(message: string): CloudRunnerError {
  return new CloudRunnerError(message, 'provider_error');
}

function requireAccount(store: MoneyStore, accountId: string): Account {
  const account = store.getAccount(accountId);
  if (!account) throw moneyError(`unknown money account: ${accountId}`);
  if (!Number.isInteger(account.balanceCents) || !Number.isInteger(account.reservedCents)) {
    throw moneyError(`account ${accountId} holds non-integer cents`);
  }
  return account;
}

function assertCents(cents: number, label: string): void {
  if (!Number.isInteger(cents)) throw moneyError(`${label} must be integer cents, got ${cents}`);
  if (cents < 0) throw moneyError(`${label} must not be negative, got ${cents}`);
}

function assertRef(ref: string): void {
  if (!ref) throw moneyError('ledger ref must not be empty');
}

/**
 * Append the pair for one balance change and return `[customerRow, oppositeRow]`.
 * The caller has already applied the change to `account` and saved it.
 */
function writePair(
  store: MoneyStore,
  account: Account,
  now: number,
  kind: LedgerKind,
  customerCents: number,
  ref: string,
  opposite: 'reserve' | 'revenue',
  shortfallCents?: number,
): [LedgerEntry, LedgerEntry] {
  const shared = {
    accountId: account.id,
    kind,
    ref,
    at: now,
    balanceAfterCents: account.balanceCents,
    reservedAfterCents: account.reservedCents,
    ...(shortfallCents !== undefined && shortfallCents > 0 ? { shortfallCents } : {}),
  };
  const customerRow: LedgerEntry = {
    id: store.nextId(),
    ...shared,
    amountCents: customerCents,
    counterparty: 'customer',
  };
  const oppositeRow: LedgerEntry = {
    id: store.nextId(),
    ...shared,
    amountCents: -customerCents,
    counterparty: opposite,
  };
  store.appendLedger(customerRow);
  store.appendLedger(oppositeRow);
  return [customerRow, oppositeRow];
}

// ============================================================
// Operations
// ============================================================

export interface MoneyResult {
  account: Account;
  entries: LedgerEntry[];
}

export interface SettleResult extends MoneyResult {
  /** Cents actually debited from the wallet. */
  chargedCents: number;
  /** Cents owed beyond the wallet; recorded instead of a negative balance. */
  shortfallCents: number;
}

/** Credit the wallet. A top-up is customer money in, revenue money earned. */
export function topUp(
  store: MoneyStore,
  accountId: string,
  cents: number,
  now: number,
): MoneyResult {
  assertCents(cents, 'top-up');
  const account = requireAccount(store, accountId);
  const next: Account = { ...account, balanceCents: account.balanceCents + cents };
  store.saveAccount(next);
  const entries = writePair(store, next, now, 'topup', cents, 'topup', 'revenue');
  return { account: next, entries };
}

export type ReserveError = 'entitlement_required' | 'insufficient_balance' | 'budget_exceeded';

export type ReserveResult =
  | { ok: true; entry: LedgerEntry }
  | { ok: false; error: ReserveError };

/**
 * Hold money for one sandbox before it starts.
 *
 * On success the returned entry is the reserve-side row (`amountCents` is the
 * positive hold); its customer-side twin is already in the ledger. A second
 * reserve for the same ref is a programming error, not a second hold, so it
 * raises instead of charging twice.
 */
export function reserve(
  store: MoneyStore,
  accountId: string,
  cents: number,
  ref: string,
  now: number,
): ReserveResult {
  assertCents(cents, 'reservation');
  assertRef(ref);
  const account = requireAccount(store, accountId);
  if (!account.paid) return { ok: false, error: 'entitlement_required' };
  if (store.findReservation(accountId, ref) !== undefined) {
    throw moneyError(`reservation already held for ref ${ref} on account ${accountId}`);
  }
  if (account.balanceCents < cents) return { ok: false, error: 'insufficient_balance' };
  const committedCents = account.monthSpentCents + account.reservedCents + cents;
  if (account.monthlyCapCents > 0 && committedCents > account.monthlyCapCents) {
    return { ok: false, error: 'budget_exceeded' };
  }
  const next: Account = {
    ...account,
    balanceCents: account.balanceCents - cents,
    reservedCents: account.reservedCents + cents,
  };
  store.saveAccount(next);
  store.putReservation(accountId, ref, cents);
  const [, reserveRow] = writePair(store, next, now, 'reserve', -cents, ref, 'reserve');
  return { ok: true, entry: reserveRow };
}

/**
 * Close a hold and charge what was really used.
 *
 * The hold is released first, then `actualCents` is debited from the freed
 * money plus any other balance. If the wallet cannot cover it, the debited
 * amount stops at the balance and the rest is recorded as `shortfallCents`,
 * so a balance never goes negative. A missing hold is not an error: the
 * settlement still runs, which keeps a stop-then-settle retry honest.
 */
export function settle(
  store: MoneyStore,
  accountId: string,
  ref: string,
  actualCents: number,
  now: number,
): SettleResult {
  assertCents(actualCents, 'settlement');
  assertRef(ref);
  let account = requireAccount(store, accountId);
  const entries: LedgerEntry[] = [];

  const held = store.findReservation(accountId, ref);
  if (held !== undefined) {
    account = {
      ...account,
      balanceCents: account.balanceCents + held,
      reservedCents: account.reservedCents - held,
    };
    store.saveAccount(account);
    store.dropReservation(accountId, ref);
    entries.push(...writePair(store, account, now, 'release', held, ref, 'reserve'));
  }

  const chargedCents = Math.min(actualCents, account.balanceCents);
  const shortfallCents = actualCents - chargedCents;
  account = {
    ...account,
    balanceCents: account.balanceCents - chargedCents,
    monthSpentCents: account.monthSpentCents + chargedCents,
  };
  store.saveAccount(account);
  entries.push(
    ...writePair(store, account, now, 'settle', -chargedCents, ref, 'revenue', shortfallCents),
  );

  return { account, entries, chargedCents, shortfallCents };
}

/**
 * Drop a hold without charging anything. Safe to call twice: a ref with no
 * hold returns the account unchanged and writes no rows.
 */
export function release(
  store: MoneyStore,
  accountId: string,
  ref: string,
  now: number,
): MoneyResult {
  assertRef(ref);
  const account = requireAccount(store, accountId);
  const held = store.findReservation(accountId, ref);
  if (held === undefined) return { account, entries: [] };

  const next: Account = {
    ...account,
    balanceCents: account.balanceCents + held,
    reservedCents: account.reservedCents - held,
  };
  store.saveAccount(next);
  store.dropReservation(accountId, ref);
  const entries = writePair(store, next, now, 'release', held, ref, 'reserve');
  return { account: next, entries };
}
