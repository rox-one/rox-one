/**
 * Dispatches meeting.followup actions on SchedulerTick.
 * Prompt/script/webhook success is not a follow-up receipt.
 */

import { createLogger } from '../../utils/debug.ts'
import type { EventBus, BaseEventPayload } from '../event-bus.ts'
import type { AutomationHandler, AutomationsConfigProvider } from './types.ts'
import { APP_EVENTS, type AppEvent, type AutomationEvent, type MeetingFollowupAction } from '../types.ts'
import { matcherMatches } from '../utils.ts'

const log = createLogger('meeting-followup-handler')

export type MeetingFollowupExecutorContext = {
  event: AutomationEvent
  workspaceId: string
  workspaceRootPath: string
  now: number
  uiClosed: boolean
}

export type MeetingFollowupExecutorResult = {
  status: string
  reason: string
  verified: boolean
}

export type MeetingFollowupExecutor = {
  execute(
    action: MeetingFollowupAction,
    ctx: MeetingFollowupExecutorContext,
  ): Promise<MeetingFollowupExecutorResult>
}

export type MeetingFollowupHandlerOptions = {
  workspaceId: string
  workspaceRootPath: string
  executor: MeetingFollowupExecutor
  uiClosed?: () => boolean
  now?: () => number
  onError?: (event: AutomationEvent, error: Error) => void
}

export class MeetingFollowupHandler implements AutomationHandler {
  private bus: EventBus | null = null
  private boundHandler: ((event: AutomationEvent, payload: BaseEventPayload) => Promise<void>) | null = null

  constructor(
    private readonly options: MeetingFollowupHandlerOptions,
    private readonly configProvider: AutomationsConfigProvider,
  ) {}

  subscribe(bus: EventBus): void {
    this.bus = bus
    this.boundHandler = this.handleEvent.bind(this)
    bus.onAny(this.boundHandler)
    log.debug('[MeetingFollowupHandler] Subscribed')
  }

  dispose(): void {
    if (this.bus && this.boundHandler) this.bus.offAny(this.boundHandler)
    this.bus = null
    this.boundHandler = null
  }

  private async handleEvent(event: AutomationEvent, payload: BaseEventPayload): Promise<void> {
    if (!APP_EVENTS.includes(event as AppEvent)) return
    const matchers = this.configProvider.getMatchersForEvent(event)
    if (matchers.length === 0) return
    const now = this.options.now?.() ?? payload.timestamp ?? Date.now()
    for (const matcher of matchers) {
      if (!matcherMatches(matcher, event, payload as unknown as Record<string, unknown>)) continue
      for (const action of matcher.actions) {
        if (action.type !== 'meeting.followup') continue
        try {
          await this.options.executor.execute(action, {
            event,
            workspaceId: this.options.workspaceId,
            workspaceRootPath: this.options.workspaceRootPath,
            now,
            uiClosed: this.options.uiClosed?.() ?? false,
          })
        } catch (error) {
          this.options.onError?.(event, error instanceof Error ? error : new Error(String(error)))
        }
      }
    }
  }
}
