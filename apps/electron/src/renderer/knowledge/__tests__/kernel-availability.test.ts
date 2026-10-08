import { beforeEach, describe, expect, it } from 'bun:test'
import { getKernelAvailability, invalidateKernelAvailability, observeKernelAvailability, __resetKernelAvailabilityForTests, type KernelAvailabilityProbe } from '../kernel-availability'
import { loadKnowledgeNavigatorData, type KnowledgeNavigatorApi } from '../KnowledgeNotebookTree'
const deferred = <T>() => { let resolve!: (value:T) => void; const promise = new Promise<T>(r => resolve=r); return {promise,resolve} }
beforeEach(__resetKernelAvailabilityForTests)
describe('scoped bounded Knowledge availability', () => {
  it('deduplicates a same API/workspace/connection probe and reuses its fresh verdict', async () => {
    let calls=0; const pending=deferred<{running:boolean}>(); const api={engineStatus:()=>{calls++;return pending.promise}};const opts={workspaceId:'A',connectionId:'one',now:()=>100}
    const one=getKernelAvailability(api,opts),two=getKernelAvailability(api,opts);expect(calls).toBe(1);pending.resolve({running:true});expect(await one).toMatchObject({running:true,status:'confirmed'});await two;await getKernelAvailability(api,opts);expect(calls).toBe(1)
  })
  it('isolates workspace, connection, and API identities rather than globally poisoning the next tab', async () => {
    const requests:unknown[]=[];const api={engineStatus:async(args:unknown)=>{requests.push(args);return {running:requests.length!==1}}}
    expect((await getKernelAvailability(api,{workspaceId:'A',connectionId:'one'})).running).toBe(false)
    expect((await getKernelAvailability(api,{workspaceId:'B',connectionId:'one'})).running).toBe(true)
    expect((await getKernelAvailability(api,{workspaceId:'A',connectionId:'two'})).running).toBe(true)
    expect((await getKernelAvailability({engineStatus:async()=>({running:true})},{workspaceId:'A',connectionId:'one'})).running).toBe(true)
    expect(requests).toEqual([{workspaceId:'A',connectionId:'one'},{workspaceId:'B',connectionId:'one'},{workspaceId:'A',connectionId:'two'}])
  })
  it('does not cache an implicit actor workspace', async () => {
    let calls=0;const api={engineStatus:async()=>({running:++calls>1})};expect((await getKernelAvailability(api)).running).toBe(false);expect((await getKernelAvailability(api)).running).toBe(true);expect(calls).toBe(2)
  })
  it('expires exact TTL and a backwards clock instead of reviving a future snapshot', async () => {
    let time=100,calls=0;const api={engineStatus:async()=>{calls++;return {running:true}}},opts={workspaceId:'A',now:()=>time,ttlMs:30};await getKernelAvailability(api,opts);time=129;await getKernelAvailability(api,opts);expect(calls).toBe(1);time=130;await getKernelAvailability(api,opts);time=100;await getKernelAvailability(api,opts);expect(calls).toBe(3)
  })
  it('invalidation fences old completion and preserves a replacement pending request', async () => {
    const old=deferred<{running:boolean}>(),fresh=deferred<{running:boolean}>();let calls=0;const api={engineStatus:()=>++calls===1?old.promise:fresh.promise},opts={workspaceId:'A'};const first=getKernelAvailability(api,opts);invalidateKernelAvailability(api,'A');const second=getKernelAvailability(api,opts);old.resolve({running:false});await first;const joined=getKernelAvailability(api,opts);expect(calls).toBe(2);fresh.resolve({running:true});expect((await second).running).toBe(true);expect((await joined).running).toBe(true);expect((await getKernelAvailability(api,opts)).running).toBe(true)
  })
  it('workspace invalidation leaves other scoped evidence intact', async () => {
    let calls=0;const api={engineStatus:async()=>{calls++;return {running:true}}};await getKernelAvailability(api,{workspaceId:'A'});await getKernelAvailability(api,{workspaceId:'B'});invalidateKernelAvailability(api,'A');await getKernelAvailability(api,{workspaceId:'B'});expect(calls).toBe(2);await getKernelAvailability(api,{workspaceId:'A'});expect(calls).toBe(3)
  })
  it('deadline is unknown with short retry, never a 30-second confirmed absence', async () => {
    let time=0,calls=0;const late=deferred<{running:boolean}>(),api={engineStatus:()=>{calls++;return calls===1?late.promise:Promise.resolve({running:true})}},opts={workspaceId:'A',timeoutMs:5,now:()=>time};expect(await getKernelAvailability(api,opts)).toMatchObject({running:false,status:'unknown'});time=999;await getKernelAvailability(api,opts);expect(calls).toBe(1);time=1000;expect((await getKernelAvailability(api,opts)).running).toBe(true);late.resolve({running:false});await Promise.resolve();expect((await getKernelAvailability(api,opts)).running).toBe(true)
  })
  it('missing, throwing, rejected, and malformed channels remain unknown without leaking the cause', async () => {
    for(const api of [{},{engineStatus:()=>{throw Error('private')}},{engineStatus:async()=>{throw Error('private')}},{engineStatus:async()=>({running:'yes'})}]) {
      const result=await getKernelAvailability(api as KernelAvailabilityProbe,{workspaceId:'A'});expect(result).toMatchObject({running:false,status:'unknown'});expect(JSON.stringify(result)).not.toContain('private')
    }
  })
  it('returns copies so one consumer cannot poison a shared cached verdict', async () => {
    const api={engineStatus:async()=>({running:true})},opts={workspaceId:'A'};const result=await getKernelAvailability(api,opts);result.running=false;expect((await getKernelAvailability(api,opts)).running).toBe(true)
  })
  it('shares one native observer and invalidates once before concurrent refreshes', async () => {
    let event!:()=>void,subscriptions=0,unsubscriptions=0,calls=0;const api={engineStatus:async()=>{calls++;return {running:true}},onChanged:(cb:()=>void)=>{event=cb;subscriptions++;return()=>{unsubscriptions++}}},opts={workspaceId:'A'};await getKernelAvailability(api,opts);const results:Promise<unknown>[]=[];const stop1=observeKernelAvailability(api,()=>results.push(getKernelAvailability(api,opts))),stop2=observeKernelAvailability(api,()=>results.push(getKernelAvailability(api,opts)));expect(subscriptions).toBe(1);event();await Promise.all(results);expect(calls).toBe(2);stop1();expect(unsubscriptions).toBe(0);stop2();expect(unsubscriptions).toBe(1)
  })
})
describe('actual navigator loader availability gate',()=>{
  const api=(overrides:Partial<KnowledgeNavigatorApi>={})=>({listConnections:async()=>[{id:'one'}],viewsList:async()=>[{id:'local-view',name:'Local view',domain:'knowledge'}],envelopeList:async()=>[{knowledgeRef:{scheme:'siyuan',kind:'document',id:'local-doc'},createdAt:1,updatedAt:1,flagged:true}],...overrides}) as KnowledgeNavigatorApi
  it('keeps local views/recent/favorites and issues zero kernel calls while offline',async()=>{
    let notebooks=0,titles=0;const input=api({engineStatus:async()=>({running:false}),listNotebooks:async()=>{notebooks++;return[]},get:async()=>{titles++;throw Error('must not touch offline kernel')}});const data=await loadKnowledgeNavigatorData(input,{workspaceId:'A',probeKernel:true});expect(notebooks).toBe(0);expect(titles).toBe(0);expect(data.notebooks.status).toBe('unavailable');expect(data.views[0]?.id).toBe('local-view');expect(data.recent[0]?.envelope.knowledgeRef.id).toBe('local-doc');expect(data.favorites).toHaveLength(1)
  })
  it('still reads local stores while the bounded initial probe is pending',async()=>{
    const probe=deferred<{running:boolean}>();let local=0;const input=api({engineStatus:()=>probe.promise,viewsList:async()=>{local++;return[]},envelopeList:async()=>{local++;return[]}});const result=loadKnowledgeNavigatorData(input,{workspaceId:'A',probeKernel:true});await Promise.resolve();await Promise.resolve();expect(local).toBe(2);probe.resolve({running:false});await result
  })
  it('online reads preserve first-connection and workspace scoping',async()=>{
    const reads:unknown[]=[];const input=api({engineStatus:async args=>{reads.push(args);return{running:true}},listNotebooks:async args=>{reads.push(args);return[]},get:async args=>{reads.push(args);return{title:'Native title'} as never}});const data=await loadKnowledgeNavigatorData(input,{workspaceId:'A',probeKernel:true});expect(data.recent[0]?.title).toBe('Native title');expect(reads).toEqual([{workspaceId:'A',connectionId:'one'},{connectionId:'one'},{connectionId:'one',workspaceId:'A',ref:{scheme:'siyuan',kind:'document',id:'local-doc'}}])
  })
  it('obsolete loader continuations do not start notebook/title RPC after a late positive probe',async()=>{
    const probe=deferred<{running:boolean}>();let current=true,reads=0;const input=api({engineStatus:()=>probe.promise,listNotebooks:async()=>{reads++;return[]},get:async()=>{reads++;return{} as never}});const pending=loadKnowledgeNavigatorData(input,{workspaceId:'A',probeKernel:true,isCurrent:()=>current});await Promise.resolve();await Promise.resolve();current=false;probe.resolve({running:true});await pending;expect(reads).toBe(0)
  })
  it('an obsolete connection-list continuation does not start a probe or local/private reads',async()=>{
    const connections=deferred<Array<{id:string}>>();let current=true,reads=0;const input=api({listConnections:()=>connections.promise,engineStatus:async()=>{reads++;return{running:true}},viewsList:async()=>{reads++;return[]},envelopeList:async()=>{reads++;return[]}});const pending=loadKnowledgeNavigatorData(input,{workspaceId:'A',probeKernel:true,isCurrent:()=>current});current=false;connections.resolve([{id:'one'}]);await pending;expect(reads).toBe(0)
  })
})

/** Branch suite (preserved): the tab-switch fast path skips kernel RPCs. */
const never = new Promise<never>(() => {})

describe('loadKnowledgeNavigatorData skipKernelReads', () => {
  function slowKernelApi(): KnowledgeNavigatorApi & { kernelCalls: number } {
    let kernelCalls = 0
    const api: KnowledgeNavigatorApi & { kernelCalls: number } = {
      kernelCalls: 0,
      async listConnections() {
        return [{ id: 'conn-1' }]
      },
      async listNotebooks() {
        kernelCalls += 1
        api.kernelCalls = kernelCalls
        return never
      },
      async viewsList() {
        return []
      },
      async envelopeList() {
        return [
          {
            knowledgeRef: { scheme: 'siyuan', kind: 'document', id: 'doc-1' },
            createdAt: 100,
            updatedAt: 300,
          },
          {
            knowledgeRef: { scheme: 'siyuan', kind: 'document', id: 'doc-2' },
            createdAt: 100,
            updatedAt: 200,
          },
        ]
      },
      async get() {
        kernelCalls += 1
        api.kernelCalls = kernelCalls
        return never
      },
    }
    return api
  }

  it('resolves fast with unavailable notebooks and zero kernel RPCs', async () => {
    const api = slowKernelApi()
    const started = Date.now()
    const data = await loadKnowledgeNavigatorData(api, { skipKernelReads: true })
    const elapsed = Date.now() - started
    expect(data.notebooks).toEqual({ status: 'unavailable', items: [] })
    expect(api.kernelCalls).toBe(0)
    expect(elapsed).toBeLessThan(5_000)
    // Local stores still load: envelopes render without kernel title lookups.
    expect(data.recent).toHaveLength(2)
    expect(data.recent[0]?.envelope.knowledgeRef.id).toBe('doc-1')
    expect(data.recent[0]?.title).toBeUndefined()
    expect(data.favorites).toHaveLength(0)
  })

  it('still hits the kernel when not skipping (documents the old cost)', async () => {
    const api: KnowledgeNavigatorApi = {
      async listConnections() {
        return [{ id: 'conn-1' }]
      },
      async listNotebooks() {
        return [{ id: 'nb-1', name: 'Research', icon: '', closed: false }]
      },
      async viewsList() {
        return []
      },
      async envelopeList() {
        return []
      },
    }
    const data = await loadKnowledgeNavigatorData(api)
    expect(data.notebooks.status).toBe('ok')
    expect(data.notebooks.items).toHaveLength(1)
  })
})
