import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const cloud = readFileSync(join(__dirname, '../../cloud-runs/CloudRunsChip.tsx'), 'utf8')
const magic = readFileSync(join(__dirname, '../MagicPromptChip.tsx'), 'utf8')
const input = readFileSync(join(__dirname, '../../app-shell/input/InputContainer.tsx'), 'utf8')

function triggerClassName(source: string): string {
  const match = source.match(/<button[\s\S]*?className="([^"]+)"/)
  if (!match) throw new Error('trigger className not found')
  return match[1]
}

describe('composer cloud and magic chip contrast', () => {
  it('uses opaque chrome on trigger buttons instead of muted-foreground/70', () => {
    const cloudTrigger = triggerClassName(cloud)
    const magicTrigger = triggerClassName(magic)

    for (const className of [cloudTrigger, magicTrigger]) {
      expect(className).toContain('bg-background')
      expect(className).not.toContain('text-muted-foreground/70')
    }

    expect(cloud).toContain('bg-background')
    expect(magic).toContain('bg-background')
    expect(input).toContain('bg-background')
    expect(input).toContain('absolute top-2 right-2 z-20')
    expect(input).toContain('rounded-md bg-background p-0.5')
    expect(magicTrigger).toContain('disabled:opacity-50')
    expect(magicTrigger).not.toContain('disabled:opacity-40')
  })
})
