import { createBackendFixture } from './backend-fixture'
const fixture = await createBackendFixture()
const allowed = new Set<string>([fixture.RPC_CHANNELS.skills.GET, fixture.RPC_CHANNELS.skills.GET_DETAILS])
const server = Bun.serve({ hostname: '127.0.0.1', port: 5189, async fetch(request) {
  if (new URL(request.url).pathname === '/health') return new Response('ready')
  try {
    const { channel, workspaceId, args } = await request.json()
    if (!allowed.has(channel) || !['fixture', 'fixture-b'].includes(workspaceId) || !Array.isArray(args)) return new Response('denied', { status: 403 })
    return Response.json(await fixture.invoke(channel, workspaceId, ...args))
  } catch {
    return Response.json({ error: 'controlled read error' }, { status: 400 })
  }
} })
const cleanup = () => { server.stop(true); fixture.dispose(); process.exit(0) }
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
