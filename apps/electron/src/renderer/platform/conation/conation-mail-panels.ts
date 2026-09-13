import type { PanelContribution, PanelRegistry, PanelRenderer } from '@craft-agent/core/platform'

/** Keep id aligned with workbench.conation.mail (blocked Mail/Channels pane). */
export const CONATION_MAIL_PANEL_ID = 'conation.mail' as const

export type MailPanelFlags = {
  shellEnabled: boolean
  inspectorEnabled: boolean
  mailEnabled: boolean
}

export type ConationMailWriteAttempt = {
  readonly status: 'blocked'
  readonly live: false
  readonly reason: 'mail-conation-unconfirmed' | 'channel-conation-unconfirmed'
  readonly evidenceLevel: 'U1'
}

export function shouldRegisterMailPanel(flags: MailPanelFlags): boolean {
  return flags.shellEnabled === true && flags.inspectorEnabled === true && flags.mailEnabled === true
}

export function conationMailSurfaceState(flags: MailPanelFlags): 'off' | 'blocked' {
  if (!shouldRegisterMailPanel(flags)) return 'off'
  return 'blocked'
}

/** No live Mail send. Does not call a network endpoint. */
export function attemptConationMailSend(): ConationMailWriteAttempt {
  return {
    status: 'blocked',
    live: false,
    reason: 'mail-conation-unconfirmed',
    evidenceLevel: 'U1',
  }
}

/** No live Channel post. Does not call a network endpoint. */
export function attemptConationChannelPost(): ConationMailWriteAttempt {
  return {
    status: 'blocked',
    live: false,
    reason: 'channel-conation-unconfirmed',
    evidenceLevel: 'U1',
  }
}

export function mailPanelContribution(
  render: PanelRenderer,
  title = 'Conation Mail',
): PanelContribution {
  return {
    id: CONATION_MAIL_PANEL_ID,
    title,
    icon: 'layers',
    slot: 'inspector',
    defaultOrder: 44,
    defaultVisible: true,
    resizable: true,
    source: { type: 'core', id: 'conation' },
    render,
  }
}

/** No-op unless shell + inspector + mail are all on (all default false). */
export function registerMailPanel(
  registry: PanelRegistry,
  render: PanelRenderer = () => null,
  flags: MailPanelFlags = {
    shellEnabled: false,
    inspectorEnabled: false,
    mailEnabled: false,
  },
  title = 'Conation Mail',
): ReturnType<PanelRegistry['register']> | undefined {
  if (!shouldRegisterMailPanel(flags)) return
  if (registry.get(CONATION_MAIL_PANEL_ID)) return
  return registry.register(mailPanelContribution(render, title))
}
