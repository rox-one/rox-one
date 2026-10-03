import { createRequire } from 'node:module'

type SqliteValue = string | number | bigint | null | Uint8Array
type SqliteRow = Record<string, unknown>

export interface NativeSqliteStatement {
  get(...bindings: SqliteValue[]): SqliteRow | undefined
  all(...bindings: SqliteValue[]): SqliteRow[]
  run(...bindings: SqliteValue[]): { changes: number | bigint; lastInsertRowid: number | bigint }
}

interface RawStatement extends Omit<NativeSqliteStatement, 'get'> {
  get(...bindings: SqliteValue[]): SqliteRow | null | undefined
}
interface RawDatabase {
  exec(sql: string): unknown
  prepare(sql: string): RawStatement
  close(throwOnError?: boolean): void
}
interface BunStatement extends RawStatement {
  finalize(): void
}
interface BunDatabase extends RawDatabase {
  prepare(sql: string): BunStatement
}

const requireBuiltin = createRequire(import.meta.url)

/** The synchronous SQLite subset used by server-side durable stores. */
export class DatabaseSync {
  readonly #database: RawDatabase
  readonly #bun: boolean
  #closed = false

  constructor(path: string, options: { readOnly?: boolean } = {}) {
    this.#bun = typeof process.versions.bun === 'string'
    if (this.#bun) {
      const { Database } = requireBuiltin('bun:sqlite') as {
        Database: new (path: string, options: { strict: boolean; safeIntegers: boolean; readonly: boolean; create: boolean }) => BunDatabase
      }
      // Every consumer supplies all bindings. Refuse missing bindings under Bun.
      const database = new Database(path, { strict: true, safeIntegers: true, readonly: options.readOnly === true, create: options.readOnly !== true })
      this.#database = database
    } else {
      const { DatabaseSync: NodeDatabaseSync } = requireBuiltin('node:sqlite') as {
        DatabaseSync: new (path: string, options: { readOnly?: boolean }) => RawDatabase
      }
      this.#database = new NodeDatabaseSync(path, options)
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('database is closed')
  }

  exec(sql: string): void { this.#assertOpen(); this.#database.exec(sql) }

  prepare(sql: string): NativeSqliteStatement {
    this.#assertOpen()
    if (this.#bun) {
      // This API exposes synchronous complete operations, never streaming rows.
      // Finalize every Bun statement immediately: cached query() only finalizes
      // its last 20 statements and retained evictions otherwise prevent close.
      const database = this.#database as BunDatabase
      database.prepare(sql).finalize() // Preserve eager SQL validation.
      const invoke = <T>(bindings: SqliteValue[], operation: (statement: BunStatement) => T): T => {
        this.#assertOpen()
        for (const value of bindings) {
          if (typeof value === 'bigint' && (value < -(2n ** 63n) || value > 2n ** 63n - 1n)) {
            throw new RangeError('SQLite integer binding exceeds signed 64-bit range')
          }
        }
        const statement = database.prepare(sql)
        try { return operation(statement) } finally { statement.finalize() }
      }
      const normalize = (row: SqliteRow): SqliteRow => {
        for (const [key, value] of Object.entries(row)) {
          if (typeof value === 'bigint') {
            if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
              throw new RangeError('SQLite integer result exceeds safe JavaScript integer range')
            }
            row[key] = Number(value)
          }
        }
        return row
      }
      return {
        get: (...bindings) => invoke(bindings, statement => {
          const row = statement.get(...bindings)
          return row == null ? undefined : normalize(row)
        }),
        all: (...bindings) => invoke(bindings, statement => statement.all(...bindings).map(normalize)),
        run: (...bindings) => invoke(bindings, statement => statement.run(...bindings)),
      }
    }
    const statement = this.#database.prepare(sql)
    return {
      get: (...bindings) => { this.#assertOpen(); return statement.get(...bindings) ?? undefined },
      all: (...bindings) => { this.#assertOpen(); return statement.all(...bindings) },
      run: (...bindings) => { this.#assertOpen(); return statement.run(...bindings) },
    }
  }

  close(): void {
    this.#assertOpen()
    // Bun must finalize prepared statements to release the file immediately.
    if (this.#bun) this.#database.close(true)
    else this.#database.close()
    this.#closed = true
  }
}
