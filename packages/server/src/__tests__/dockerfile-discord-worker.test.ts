/**
 * Spec story 16 / inventory 9.4 — Docker image must ship Discord if the
 * UI offers Discord. The packaged server already builds the worker
 * (`scripts/build-server.ts`); Dockerfile.server must do the same.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..')
const dockerfile = readFileSync(join(REPO_ROOT, 'Dockerfile.server'), 'utf8')

describe('Dockerfile.server Discord worker', () => {
  it('copies the discord-worker package manifest before bun install', () => {
    expect(dockerfile).toMatch(
      /COPY packages\/messaging-discord-worker\/package\.json packages\/messaging-discord-worker\//,
    )
  })

  it('builds the Discord worker bundle the same way it builds WhatsApp', () => {
    expect(dockerfile).toMatch(/bun run scripts\/build-discord-worker\.ts/)
    expect(dockerfile).toMatch(/bun run scripts\/build-wa-worker\.ts/)
  })

  it('points CRAFT_MESSAGING_DISCORD_WORKER at the built worker.cjs', () => {
    expect(dockerfile).toMatch(
      /ENV CRAFT_MESSAGING_DISCORD_WORKER=\/app\/packages\/messaging-discord-worker\/dist\/worker\.cjs/,
    )
  })
})
