import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
const modulePath = join(import.meta.dir, '../agent-budget.ts')
const now = Date.parse('2026-09-30T12:00:00Z')
function spawn(root: string, body: string) {
  return Bun.spawn([process.execPath, '-e', `const {AgentBudgetLedger}=await import(${JSON.stringify(modulePath)});const {writeFileSync,existsSync}=await import('node:fs');const {join}=await import('node:path');const root=process.env.BUDGET_OWNER_FIXTURE;const ledger=new AgentBudgetLedger(join(root,'budget.sqlite'));const now=${now};${body}`], { env: { ...process.env, BUDGET_OWNER_FIXTURE: root, TZ: 'UTC' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
}
async function output(child: ReturnType<typeof spawn>) {
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
  return JSON.parse(stdout)
}
async function ready(root: string, name: string) {
  const deadline = Date.now() + 5000
  while (!existsSync(join(root, name)) && Date.now() < deadline) await Bun.sleep(5)
  expect(existsSync(join(root, name))).toBe(true)
}
async function stop(child: ReturnType<typeof spawn> | undefined) {
  if (child && child.exitCode === null) { child.kill('SIGKILL'); await child.exited }
}

test('live second process cannot steal, release, or redispatch the active reservation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-live-owner-'))
  let owner: ReturnType<typeof spawn> | undefined
  try {
    owner = spawn(root, `const reserved=ledger.reserve('ws','run',1,0.7,now);writeFileSync(join(root,'ready'),'ready');while(!existsSync(join(root,'go')))await Bun.sleep(5);ledger.releaseBeforeDispatch('ws','run',now);console.log(JSON.stringify({reserved,snapshot:ledger.snapshot('ws',1,now)}));ledger.close();`)
    await ready(root, 'ready')
    const other = await output(spawn(root, `const snapshot=ledger.snapshot('ws',1,now);const replay=ledger.reserve('ws','run',1,0.7,now);let releaseError;try{ledger.releaseBeforeDispatch('ws','run',now)}catch(error){releaseError=String(error)}const mutatorErrors=[];for(const invoke of [()=>ledger.complete('ws','run',now),()=>ledger.markUnresolved('ws','run',now),()=>ledger.settleUsage('ws','run','foreign-usage',0.2,now),()=>ledger.reconcile('ws','run','foreign-receipt',0.2,now)]){try{invoke();mutatorErrors.push(null)}catch(e){mutatorErrors.push(String(e))}}console.log(JSON.stringify({snapshot,replay,releaseError,mutatorErrors,after:ledger.snapshot('ws',1,now)}));ledger.close();`))
    expect(other.snapshot).toMatchObject({ reservedUsd: 0.7, unresolvedUsd: 0, exhausted: false })
    expect(other.replay).toBeNull()
    expect(other.releaseError).toContain('another owner')
    expect(other.mutatorErrors).toHaveLength(4)
    for (const error of other.mutatorErrors) expect(error).toContain('another owner')
    expect(other.after).toEqual(other.snapshot)
    writeFileSync(join(root, 'go'), 'go')
    expect((await output(owner)).snapshot).toMatchObject({ reservedUsd: 0, unresolvedUsd: 0, remainingUsd: 1 })
  } finally { await stop(owner); rmSync(root, { recursive: true, force: true }) }
})

test('SIGKILL owner retains conservative quota and exact reconciliation remains idempotent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-dead-owner-'))
  let owner: ReturnType<typeof spawn> | undefined
  try {
    owner = spawn(root, `ledger.reserve('ws','run',1,1,now);writeFileSync(join(root,'ready'),'ready');await new Promise(()=>{});`)
    await ready(root, 'ready')
    owner.kill('SIGKILL'); await owner.exited
    expect(owner.signalCode).toBe('SIGKILL')
    const recovered = await output(spawn(root, `const before=ledger.snapshot('ws',1,now);const retry=ledger.reserve('ws','retry',1,0.01,now);ledger.reconcile('ws','run','receipt',0.2,now);ledger.reconcile('ws','run','receipt',0.2,now);let conflict;try{ledger.reconcile('ws','run','receipt',0.3,now)}catch(error){conflict=String(error)}console.log(JSON.stringify({before,retry,after:ledger.snapshot('ws',1,now),conflict}));ledger.close();`))
    expect(recovered.before).toMatchObject({ unresolvedUsd: 1, remainingUsd: 0, exhausted: true })
    expect(recovered.retry).toBeNull()
    expect(recovered.after).toMatchObject({ spentUsd: 0.2, unresolvedUsd: 0, remainingUsd: 0.8 })
    expect(recovered.conflict).toContain('different cost')
  } finally { await stop(owner); rmSync(root, { recursive: true, force: true }) }
})

test('two barrier-synchronized processes reserve within the limit without lock errors', async () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-concurrent-owner-'))
  const children: ReturnType<typeof spawn>[] = []
  try {
    for (const who of ['a', 'b']) {
      const child = spawn(root, `writeFileSync(join(root,'${who}.ready'),'ready');while(!existsSync(join(root,'go')))await Bun.sleep(1);const reserved=ledger.reserve('ws','${who}',1,0.7,now);console.log(JSON.stringify({pid:process.pid,reserved}));ledger.close();`)
      children.push(child); await ready(root, `${who}.ready`)
    }
    writeFileSync(join(root, 'go'), 'go')
    const results = await Promise.all(children.map(output))
    expect(new Set(results.map(result => result.pid)).size).toBe(2)
    expect(results.filter(result => result.reserved !== null)).toHaveLength(1)
    const db = new DatabaseSync(join(root, 'budget.sqlite'), { readOnly: true })
    try {
      expect(db.prepare('SELECT SUM(reserved_usd) AS total, COUNT(*) AS count FROM agent_budget_runs').get()).toEqual({ total: 0.7, count: 1 })
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    } finally { db.close() }
  } finally { for (const child of children) await stop(child); rmSync(root, { recursive: true, force: true }) }
})

test('unknown live PID preserves quota while legacy ownerless rows recover conservatively', async () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-unknown-owner-'))
  try {
    await output(spawn(root, `ledger.reserve('ws','unknown',1,0.7,now);console.log('{}');ledger.close();`))
    const db = new DatabaseSync(join(root, 'budget.sqlite'))
    db.prepare("UPDATE agent_budget_runs SET state='reserved',owner_pid=?,owner_token='unverifiable-incarnation'").run(process.pid)
    db.close()
    const unknown = await output(spawn(root, `const replay=ledger.reserve('ws','unknown',1,0.7,now);let error;try{ledger.releaseBeforeDispatch('ws','unknown',now)}catch(e){error=String(e)}console.log(JSON.stringify({snapshot:ledger.snapshot('ws',1,now),replay,error}));ledger.close();`))
    expect(unknown.snapshot).toMatchObject({ reservedUsd: 0.7, remainingUsd: 0.30000000000000004 })
    expect(unknown.replay).toBeNull()
    expect(unknown.error).toContain('another owner')
    const legacyDb = new DatabaseSync(join(root, 'budget.sqlite'))
    legacyDb.exec('UPDATE agent_budget_runs SET owner_pid=NULL,owner_token=NULL')
    legacyDb.close()
    const legacy = await output(spawn(root, `console.log(JSON.stringify(ledger.snapshot('ws',1,now)));ledger.close();`))
    expect(legacy).toMatchObject({ reservedUsd: 0, unresolvedUsd: 0.7, exhausted: true })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('separate module instances in one process preserve live owner and recover explicit close', async () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-module-owner-'))
  try {
    const result = await output(spawn(root, `const reserved=ledger.reserve('ws','run',1,0.7,now);const {AgentBudgetLedger:OtherLedger}=await import(${JSON.stringify(modulePath + '?duplicate-owner-fixture')});const other=new OtherLedger(join(root,'budget.sqlite'));const before=other.snapshot('ws',1,now);const replay=ledger.reserve('ws','run',1,0.7,now);ledger.close();const after=other.snapshot('ws',1,now);let error;try{other.releaseBeforeDispatch('ws','run',now)}catch(e){error=String(e)}console.log(JSON.stringify({reserved,before,replay,after,error}));other.close();`))
    expect(result.before).toMatchObject({ reservedUsd: 0.7, unresolvedUsd: 0 })
    expect(result.replay).toEqual(result.reserved)
    expect(result.after).toMatchObject({ reservedUsd: 0, unresolvedUsd: 0.7 })
    expect(result.error).toContain('another owner')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('trigger-aborted constructor preserves original error and quota for successful recovery', async () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-constructor-fault-'))
  const { AgentBudgetLedger } = await import('../agent-budget.ts')
  const path = join(root, 'budget.sqlite')
  try {
    const owner = new AgentBudgetLedger(path)
    owner.reserve('ws', 'run', 1, 0.7, now)
    owner.close()
    const db = new DatabaseSync(path)
    try {
      db.exec("UPDATE agent_budget_runs SET state='reserved',owner_pid=NULL,owner_token=NULL; CREATE TRIGGER recovery_fault BEFORE UPDATE ON agent_budget_runs BEGIN SELECT RAISE(ABORT,'owned recovery fault'); END;")
      for (let attempt = 0; attempt < 3; attempt++) expect(() => new AgentBudgetLedger(path)).toThrow('owned recovery fault')
      expect(db.prepare('SELECT state,reserved_usd FROM agent_budget_runs').get()).toEqual({ state: 'reserved', reserved_usd: 0.7 })
      db.exec('DROP TRIGGER recovery_fault')
    } finally { db.close() }
    const recovered = new AgentBudgetLedger(path)
    try {
      expect(recovered.snapshot('ws', 1, now)).toMatchObject({ reservedUsd: 0, unresolvedUsd: 0.7 })
      expect(recovered.reserve('ws', 'too-large', 1, 0.4, now)).toBeNull()
    } finally { recovered.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
