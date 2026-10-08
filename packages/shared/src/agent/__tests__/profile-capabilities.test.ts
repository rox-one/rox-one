import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { OmpAgent } from '../omp-agent.ts'
import { createFakeOmp, useFakeOmpEnv, makeOmpConfig, chatEvents } from './omp-fake-cli.ts'
import { TestAgent, createMockBackendConfig } from './test-utils.ts'
import type { AgentProfileSnapshot } from '../../workspace-work/types.ts'

function profile(): AgentProfileSnapshot {
  return { profileId: 'profile-fixture', workspaceId: 'ws-test', revision: 1, name: 'Reviewer', role: 'Review captured work',
    sourceSlugs: [], skillSlugs: ['allowed'], memoryScope: 'none', automationEnabled: false, capturedAt: 1 }
}
test('BaseAgent activates captured skills only and passes captured role to actual backend message', async () => {
  const fake = createFakeOmp()
  let agent: TestAgent | undefined
  try {
    for (const slug of ['allowed', 'outside']) {
      const path = join(fake.workspaceRoot, 'skills', slug); mkdirSync(path, { recursive: true })
      writeFileSync(join(path, 'SKILL.md'), `---\nname: ${slug}\ndescription: Fixture instruction\n---\nDo fixture work.`)
    }
    agent = new TestAgent(createMockBackendConfig({ workspace: { id: 'ws-test', slug: 'ws-test', name: 'Fixture', rootPath: fake.workspaceRoot, createdAt: 1 },
      allowedSkillSlugs: ['allowed'], agentProfileSnapshot: profile() }))
    const drain = async (message: string) => { const events = []; for await (const event of agent!.chat(message)) events.push(event); return events }
    const rejected = await drain('[skill:outside] Execute')
    expect(rejected.some(event => event.type === 'error')).toBe(true)
    expect(agent.chatCalls).toHaveLength(0)
    await drain('[skill:allowed] Execute')
    expect(agent.chatCalls).toHaveLength(1)
    expect(agent.chatCalls[0]!.message).toContain('Review captured work')
    expect(agent.chatCalls[0]!.message).toContain('/skills/allowed/SKILL.md')
    expect(agent.chatCalls[0]!.message).not.toContain('/skills/outside/SKILL.md')
  } finally { agent?.dispose(); fake.cleanup() }
})
test('bound OMP disables independent native skill discovery while preserving RPC invocation', async () => {
  const fake = createFakeOmp('healthy'), restore = useFakeOmpEnv(fake)
  const agent = new OmpAgent(makeOmpConfig(fake, { allowedSkillSlugs: [], agentProfileSnapshot: { ...profile(), skillSlugs: [] } }))
  try {
    const events = await chatEvents(agent, 'Fixture work', 10000)
    expect(events.some(event => event.type === 'complete')).toBe(true)
    const args = fake.readArgvLog().find(args => args.includes('--mode'))!
    expect(args).toContain('--no-skills')
    expect(args).toContain('rpc')
  } finally { agent.dispose(); restore(); fake.cleanup() }
}, 15000)
