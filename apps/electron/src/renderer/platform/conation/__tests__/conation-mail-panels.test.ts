import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPanelRegistry } from '@craft-agent/core/platform'
import {
  CONATION_MAIL_PANEL_ID,
  attemptConationChannelPost,
  attemptConationMailSend,
  conationMailSurfaceState,
  registerMailPanel,
  shouldRegisterMailPanel,
} from '../conation-mail-panels.ts'

const mailPanelSource = readFileSync(join(__dirname, '../ConationMailPanel.tsx'), 'utf8')
const mailPanelsSource = readFileSync(join(__dirname, '../conation-mail-panels.ts'), 'utf8')
const panelHostSource = readFileSync(join(__dirname, '../../PanelHost.tsx'), 'utf8')
const unifiedShellSource = readFileSync(
  join(__dirname, '../../../atoms/unified-shell.ts'),
  'utf8',
)

describe('registerMailPanel', () => {
  it('is off unless shell, inspector, and mail are all on', () => {
    expect(
      shouldRegisterMailPanel({
        shellEnabled: false,
        inspectorEnabled: true,
        mailEnabled: true,
      }),
    ).toBe(false)
    expect(
      shouldRegisterMailPanel({
        shellEnabled: true,
        inspectorEnabled: false,
        mailEnabled: true,
      }),
    ).toBe(false)
    expect(
      shouldRegisterMailPanel({
        shellEnabled: true,
        inspectorEnabled: true,
        mailEnabled: false,
      }),
    ).toBe(false)
    expect(
      shouldRegisterMailPanel({
        shellEnabled: true,
        inspectorEnabled: true,
        mailEnabled: true,
      }),
    ).toBe(true)
  })

  it('does not register when the mail flag is off', () => {
    const registry = createPanelRegistry()
    registerMailPanel(registry)
    registerMailPanel(registry, () => null, {
      shellEnabled: true,
      inspectorEnabled: true,
      mailEnabled: false,
    })
    expect(registry.get(CONATION_MAIL_PANEL_ID)).toBeUndefined()
    expect(registry.list('inspector', {}).map((panel) => panel.id)).not.toContain(
      CONATION_MAIL_PANEL_ID,
    )
    expect(
      conationMailSurfaceState({
        shellEnabled: true,
        inspectorEnabled: true,
        mailEnabled: false,
      }),
    ).toBe('off')
  })

  it('registers conation.mail once when all flags are on', () => {
    const registry = createPanelRegistry()
    const render = () => null
    const flags = {
      shellEnabled: true,
      inspectorEnabled: true,
      mailEnabled: true,
    }
    const registration = registerMailPanel(registry, render, flags, 'Localized Mail')
    const duplicate = registerMailPanel(registry, render, flags, 'Localized Mail')

    expect(registry.get(CONATION_MAIL_PANEL_ID)?.title).toBe('Localized Mail')
    expect(registry.get(CONATION_MAIL_PANEL_ID)?.source.id).toBe('conation')
    expect(registry.get(CONATION_MAIL_PANEL_ID)?.defaultOrder).toBe(44)
    expect(
      registry.list('inspector', {}).filter((panel) => panel.id === CONATION_MAIL_PANEL_ID),
    ).toHaveLength(1)
    expect(registration).toBeDefined()
    expect(duplicate).toBeUndefined()
    expect(conationMailSurfaceState(flags)).toBe('blocked')
  })

  it('mail/channel write attempts stay blocked with no live send', () => {
    const mail = attemptConationMailSend()
    const channel = attemptConationChannelPost()
    expect(mail.status).toBe('blocked')
    expect(mail.live).toBe(false)
    expect(mail.reason).toBe('mail-conation-unconfirmed')
    expect(mail.evidenceLevel).toBe('U1')
    expect(channel.status).toBe('blocked')
    expect(channel.live).toBe(false)
    expect(channel.reason).toBe('channel-conation-unconfirmed')
    expect(mailPanelsSource).not.toContain('fetch(')
    expect(mailPanelsSource).not.toContain('toast.success')
  })

  it('panel chrome is unavailable/blocked, never a successful send', () => {
    expect(mailPanelSource).toContain("data-conation-mail=\"off\"")
    expect(mailPanelSource).toContain("data-conation-mail=\"blocked\"")
    expect(mailPanelSource).toContain("t('common.unavailable')")
    expect(mailPanelSource).toContain("t('workbench.mode.unavailable')")
    expect(mailPanelSource).toContain('disabled')
    expect(mailPanelSource).not.toContain('toast.success')
    expect(mailPanelSource).not.toContain('toast.ok')
    expect(mailPanelSource).not.toContain('fetch(')
    expect(mailPanelSource).not.toContain('openUrl')
    expect(mailPanelSource).not.toContain('electronAPI')
  })

  it('PanelHost wires the mail flag default-off and registers the blocked pane', () => {
    expect(unifiedShellSource).toContain('featureWorkbenchConationMailAtom')
    expect(unifiedShellSource).toMatch(
      /atomWithStorage<boolean>\(\s*getKeyString\(KEYS\.featureWorkbenchConationMail\),\s*false/,
    )
    expect(panelHostSource).toContain('registerMailPanel(')
    expect(panelHostSource).toContain('useAtomValue(featureWorkbenchConationMailAtom)')
    expect(panelHostSource).toContain('mailRegistration?.dispose()')
    expect(panelHostSource).not.toContain('ConationShellSettings')
  })
})
