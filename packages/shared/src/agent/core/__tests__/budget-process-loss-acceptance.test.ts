import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const authorityPath = resolve(import.meta.dir, '../agent-budget.ts')
const importLedger = `const {AgentBudgetLedger,localDayStart}=await import(${JSON.stringify(authorityPath)});`
const runtime = (root: string) => ({ ...process.env, ROX_CONFIG_DIR: root, CRAFT_CONFIG_DIR: root, BUDGET_FIXTURE_ROOT: root, TZ: 'America/New_York' })
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function databaseHashes(root: string) {
  return readdirSync(root).filter(name => name.startsWith('budget.sqlite')).map(name => ({ name, sha256: hash(readFileSync(join(root, name))) }))
}
async function freshReadback(root: string, code: string) {
  const child = Bun.spawn([process.execPath, '-e', importLedger + code], { env: runtime(root), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
  return JSON.parse(stdout)
}
function retainEvidence(name: string, evidence: unknown) {
  if (!process.env.BUDGET_ACCEPTANCE_EVIDENCE_DIR) return
  mkdirSync(process.env.BUDGET_ACCEPTANCE_EVIDENCE_DIR, { recursive: true })
  writeFileSync(join(process.env.BUDGET_ACCEPTANCE_EVIDENCE_DIR, `${name}.json`), JSON.stringify(evidence, null, 2) + '\n')
}

for (const reportedUsage of [false, true]) test(`SIGKILL after durable background reservation ${reportedUsage ? 'and partial usage' : 'without usage'} preserves conservative quota and idempotent recovery`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-process-loss-'))
  let worker: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined
  try {
    worker = Bun.spawn([process.execPath, '-e', importLedger + `
const {writeFileSync}=await import('node:fs');const {join}=await import('node:path');
const root=process.env.BUDGET_FIXTURE_ROOT,ledger=new AgentBudgetLedger(join(root,'budget.sqlite'));
const now=Date.parse('2026-11-01T12:00:00-05:00');
const reservation=ledger.reserve('workspace-a','background-native-run',1,1,now);
if(!reservation)throw Error('reservation denied');
${reportedUsage ? "ledger.settleUsage('workspace-a','background-native-run','partial-event',0.2,now);" : ''}
// Actual bounded native filesystem work follows the committed reserve. No provider or billing call.
writeFileSync(join(root,'partial-result.txt'),'bounded native work retained');
console.log(JSON.stringify({pid:process.pid,reservation,snapshot:ledger.snapshot('workspace-a',1,now)}));
await new Promise(()=>{});
`], { env: runtime(root), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const reader = worker.stdout.getReader()
    let readinessTimer: ReturnType<typeof setTimeout> | undefined
    let readyText = ''
    try {
      readyText = await Promise.race([
        (async () => {
          let text = ''
          while (!text.includes('\n')) {
            const chunk = await reader.read()
            if (!chunk.value) throw new Error('worker exited before reservation marker')
            text += new TextDecoder().decode(chunk.value)
            if (text.length > 16384) throw new Error('oversized reservation marker')
          }
          return text.slice(0, text.indexOf('\n'))
        })(),
        new Promise<never>((_, reject) => {
          readinessTimer = setTimeout(() => reject(new Error('background reservation readiness timed out')), 5000)
        }),
      ])
    } finally {
      clearTimeout(readinessTimer)
      await reader.cancel()
      reader.releaseLock()
    }
    const before = JSON.parse(readyText)
    expect(before.pid).toBe(worker.pid)
    expect(before.reservation).toMatchObject({ workspaceId: 'workspace-a', runId: 'background-native-run', state: 'reserved', reservedUsd: 1 })
    expect(before.snapshot.remainingUsd).toBe(0)
    worker.kill('SIGKILL')
    await worker.exited
    expect(worker.signalCode).toBe('SIGKILL')
    const stderr = await new Response(worker.stderr).text()
    expect(stderr).toBe('')
    const crashHashes = databaseHashes(root)
    expect(readFileSync(join(root, 'partial-result.txt'), 'utf8')).toBe('bounded native work retained')
    const recovered = await freshReadback(root, `
const {join}=await import('node:path');const ledger=new AgentBudgetLedger(join(process.env.BUDGET_FIXTURE_ROOT,'budget.sqlite'));
const now=Date.parse('2026-11-01T12:00:00-05:00'),before=ledger.snapshot('workspace-a',1,now);
const denied=ledger.reserve('workspace-a','retry-after-crash',1,0.01,now)===null;
const other=ledger.snapshot('workspace-b',1,now);
const nextDay=ledger.snapshot('workspace-a',1,Date.parse('2026-11-02T00:01:00-05:00'));
ledger.reconcile('workspace-a','background-native-run','actual-recovery-receipt',0.4,now);
ledger.reconcile('workspace-a','background-native-run','actual-recovery-receipt',0.4,now);
let changedReceiptDenied=false;try{ledger.reconcile('workspace-a','background-native-run','actual-recovery-receipt',0.5,now)}catch{changedReceiptDenied=true}
const after=ledger.snapshot('workspace-a',1,now);ledger.close();
console.log(JSON.stringify({pid:process.pid,before,denied,other,nextDay,after,changedReceiptDenied}));
`)
    expect(recovered.before).toMatchObject({ reservedUsd: 0, unresolvedUsd: 1, remainingUsd: 0, exhausted: true, spentUsd: reportedUsage ? 0.2 : 0 })
    expect(recovered.denied).toBe(true)
    expect(recovered.other).toMatchObject({ remainingUsd: 1, exhausted: false })
    expect(recovered.nextDay).toMatchObject({ unresolvedUsd: 1, remainingUsd: 0, exhausted: true })
    expect(recovered.after).toMatchObject({ spentUsd: 0.4, reservedUsd: 0, unresolvedUsd: 0, remainingUsd: 0.6, exhausted: false })
    expect(recovered.changedReceiptDenied).toBe(true)
    const settled = await freshReadback(root, `
const {join}=await import('node:path');const ledger=new AgentBudgetLedger(join(process.env.BUDGET_FIXTURE_ROOT,'budget.sqlite'));
const now=Date.parse('2026-11-01T12:00:00-05:00');ledger.reconcile('workspace-a','background-native-run','actual-recovery-receipt',0.4,now);
const sameDay=ledger.snapshot('workspace-a',1,now),nextDay=ledger.snapshot('workspace-a',1,Date.parse('2026-11-02T00:01:00-05:00'));ledger.close();
console.log(JSON.stringify({pid:process.pid,sameDay,nextDay}));
`)
    expect(settled.sameDay).toEqual(recovered.after)
    expect(settled.nextDay).toMatchObject({ spentUsd: 0, unresolvedUsd: 0, remainingUsd: 1, exhausted: false })
    retainEvidence(reportedUsage ? 'sigkill-partial-usage' : 'sigkill-no-usage', { before, crashSignal: 'SIGKILL', crashHashes, recovered, settled, afterHashes: databaseHashes(root), authoritySha256: hash(readFileSync(authorityPath)), limits: 'production ledger child and actual local filesystem work; synthetic accounting receipt, no provider/runtime cancellation acceptance' })
  } finally {
    if (worker && worker.exitCode === null) { worker.kill('SIGKILL'); await worker.exited }
    rmSync(root, { recursive: true, force: true })
  }
}, 15000)

test('real local calendar contract uses 23/25-hour DST days and does not reset within the repeated hour', async () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-calendar-'))
  try {
    const result = await freshReadback(root, `
const day=t=>localDayStart(Date.parse(t));
console.log(JSON.stringify({springHours:(day('2026-03-09T00:01:00-04:00')-day('2026-03-08T12:00:00-04:00'))/3600000,fallHours:(day('2026-11-02T00:01:00-05:00')-day('2026-11-01T12:00:00-05:00'))/3600000,repeatedHourSameDay:day('2026-11-01T01:30:00-04:00')===day('2026-11-01T01:30:00-05:00')}));
`)
    expect(result).toEqual({ springHours: 23, fallHours: 25, repeatedHourSameDay: true })
    retainEvidence('local-dst-calendar', result)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
