import { describe, expect, it } from 'bun:test'
import { deferred, rendererEffect, settle } from './rox-readiness-ui-001.effect-harness'

describe('UI-001 canonical browser address lifecycle',()=>{
  function owner() {
    const reply=deferred<Array<{id:string}>>()
    let removed!: (id:string)=>void, off=0
    const updates: unknown[]=[]
    const window={electronAPI:{browserPane:{
      list:()=>reply.promise,
      onRemoved(callback:(id:string)=>void){removed=callback;return()=>{off++}},
    }}}
    const cleanup=rendererEffect(new URL('../../../pages/BrowserPanelPage.tsx',import.meta.url),'browserPane.onRemoved',{
      window,instanceId:'selected',setAvailability:(value:unknown)=>updates.push(value),
    })!
    return{reply,updates,cleanup,remove:(id:string)=>removed(id),off:()=>off}
  }
  it('missing lookup belongs to the requested ID',async()=>{
    const test=owner();test.reply.resolve([{id:'other'}]);await settle()
    expect(test.updates).toEqual([{id:'selected',kind:'loading'},{id:'selected',kind:'missing'}])
    test.cleanup();expect(test.off()).toBe(1)
  })
  it('removal supersedes a pending canonical lookup and detached callbacks',async()=>{
    const test=owner();test.remove('unrelated');test.remove('selected')
    test.reply.resolve([{id:'selected'}]);await settle()
    expect(test.updates.at(-1)).toEqual({id:'selected',kind:'missing'})
    test.cleanup();test.remove('selected');expect(test.updates).toHaveLength(2)
  })
  it('transport error is unavailable and a disposed request cannot replace another route',async()=>{
    const test=owner();test.reply.reject(new Error('offline'));await settle()
    expect(test.updates.at(-1)).toEqual({id:'selected',kind:'unavailable'})
    test.cleanup()
    const old=owner();old.cleanup();old.reply.resolve([{id:'selected'}]);await settle()
    expect(old.updates).toEqual([{id:'selected',kind:'loading'}])
  })
})
