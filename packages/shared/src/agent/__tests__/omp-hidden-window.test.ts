import { expect, spyOn, test } from 'bun:test'
import * as processes from 'node:child_process'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { OmpAgent } from '../omp-agent'
import { createFakeOmp, useFakeOmpEnv, makeOmpConfig, chatEvents } from './omp-fake-cli'
import { withOmpRequiredModes } from '../omp-history'

// These exercise actual production launch callers with the existing isolated
// NODE_ENV=test protocol fixture. They do not certify a Windows console or a
// native 18.4.12 policy overlay; those remain separate native acceptance gates.
async function withLaunches(run: (agent:OmpAgent, fake:ReturnType<typeof createFakeOmp>, launches:Array<{args:string[];windowsHide:boolean|undefined;shell:boolean|string;cwd:unknown}>)=>Promise<void>) {
  const fake=createFakeOmp('healthy'),restore=useFakeOmpEnv(fake)
  const agent=new OmpAgent(makeOmpConfig(fake,{model:'kimi-k3',miniModel:'kimi-k2',envOverrides:{ROX_API_KEY:'isolated-launch-fixture'}}))
  const children:ChildProcess[]=[],launches:Array<{args:string[];windowsHide:boolean|undefined;shell:boolean|string;cwd:unknown}>=[]
  const spawn=processes.spawn
  const observed=((...args:Parameters<typeof processes.spawn>)=>{
    if(args[0]===fake.binPath){
      const options=args[2] as SpawnOptions
      launches.push({args:[...(args[1] as string[])],windowsHide:options.windowsHide,shell:options.shell??false,cwd:options.cwd})
    }
    const child=spawn(...args)
    if(args[0]===fake.binPath)children.push(child)
    return child
  }) as typeof processes.spawn
  const spy=spyOn(processes,'spawn').mockImplementation(observed)
  try{await run(agent,fake,launches)}finally{
    spy.mockRestore();agent.destroy()
    const deadline=Date.now()+15000
    while(children.some(child=>child.exitCode===null&&child.signalCode===null)){
      if(Date.now()>deadline){for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');throw Error('Owned OMP fixture did not exit')}
      await Bun.sleep(10)
    }
    restore();fake.cleanup()
  }
}

test('actual RPC OMP child starts hidden without shell interpretation or model/context changes',()=>withLaunches(async(agent,fake,launches)=>{
  const events=await chatEvents(agent,'RPC launch fixture',30000)
  expect(events.some(event=>event.type==='text_complete')).toBe(true)
  expect(launches).toHaveLength(1)
  expect(launches[0]?.windowsHide).toBe(true)
  expect(launches[0]?.shell).toBe(false)
  expect(launches[0]?.cwd).toBe(fake.workspaceRoot)
  expect(launches[0]?.args).toContain('--mode')
  expect(fake.readRpcLog().filter(frame=>frame.type==='prompt')).toHaveLength(1)
}),45000)

test('actual one-shot child starts hidden and preserves literal argv, model, and no-session ownership',()=>withLaunches(async(agent,fake,launches)=>{
  const marker=join(fake.workspaceRoot,'unwanted-shell-effect'),prompt=`Literal \"quote\"\n$(touch '${marker}') & %PATH% ! ;`;
  expect(await agent.runMiniCompletion(prompt)).toContain('fake-omp answer:')
  expect(launches).toHaveLength(1)
  expect(launches[0]?.windowsHide).toBe(true)
  expect(launches[0]?.shell).toBe(false)
  expect(launches[0]?.args).toEqual(['--no-session','--thinking','max','--model','kimi-k2','-p',withOmpRequiredModes(prompt)])
  expect(fake.readArgvLog()).toEqual([launches[0]!.args])
  expect(existsSync(marker)).toBe(false)
  expect((agent as any).oneShotChildren.size).toBe(0)
}),45000)
