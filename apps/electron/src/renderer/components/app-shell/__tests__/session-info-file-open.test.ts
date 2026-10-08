import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * UI-A1 review4: opening a session file from SessionInfoPopover shows a
 * fullscreen preview (FullscreenOverlayBase, 350). The popover (island 400)
 * would float over it in narrow non-compact windows, and the drawer would stay
 * open underneath, so both presentations close when a file is opened.
 */
const popover = readFileSync(join(import.meta.dir, '../SessionInfoPopover.tsx'), 'utf8')
const files = readFileSync(join(import.meta.dir, '../../right-sidebar/SessionFilesSection.tsx'), 'utf8')

function block(src: string, start: string): string {
  const at = src.indexOf(start)
  if (at < 0) throw new Error(`missing ${start}`)
  return src.slice(at, src.indexOf('}, [', at))
}

describe('SessionFilesSection reports in-app file opens', () => {
  for (const handler of ['const handleFileClick', 'const handleFileDoubleClick']) {
    it(`${handler} calls onFileOpen after previewing a file, not for directories`, () => {
      const body = block(files, handler)
      const [dirBranch, fileBranch] = body.split('} else {')
      expect(dirBranch).not.toContain('onFileOpen')
      expect(fileBranch).toMatch(/onOpenFile\(file\.path\)\s*onFileOpen\?\.\(file\)/)
    })
  }

  it('onFileOpen is an optional prop passed through the component signature', () => {
    expect(files).toContain('onFileOpen?: (file: SessionFile) => void')
    expect(files).toMatch(/export function SessionFilesSection\(\{[^}]*onFileOpen \}: SessionFilesSectionProps\)/)
  })
})

describe('SessionInfoPopover closes when a file opens', () => {
  it('handleFileOpen closes the surface without handing focus back to the composer', () => {
    const body = block(popover, 'const handleFileOpen')
    expect(body).toContain('setOpen(false)')
    expect(body).toContain('closingForFileRef.current = true')
    expect(body).not.toContain('craft:focus-input')
    expect(body).not.toContain('handleOpenChange')
  })

  it('both presentations wire onFileOpen into the files section', () => {
    expect((popover.match(/<SessionInfoPopoverContent [^>]*onFileOpen=\{handleFileOpen\}/g) ?? []).length).toBe(2)
    expect(popover).toMatch(/<SessionFilesSection[\s\S]*?onFileOpen=\{onFileOpen\}/)
  })

  it('the drawer skips its focus restore when it closes for a file preview', () => {
    const drawer = popover.slice(popover.indexOf('<DrawerContent'), popover.indexOf('</DrawerContent>'))
    expect(drawer).toMatch(/onCloseAutoFocus=\{\(e\) => \{\s*if \(!closingForFileRef\.current\) return\s*closingForFileRef\.current = false\s*e\.preventDefault\(\)/)
  })
})
