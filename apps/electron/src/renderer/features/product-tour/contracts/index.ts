/**
 * PROPOSED CONTRACT — not an installed ROX implementation.
 * Baseline: 192558583b3f7acc84e0636a4e5fc7ba8d9a7435
 * A0 freezes these names before parallel work; adapters import existing native types.
 * No domain mutation port is intentionally exposed to the learning engine.
 */
export type TourId = "OBT-01" | "OBT-02" | "OBT-03" | "OBT-04" | "OBT-05" | "OBT-06" | "OBT-07" | "OBT-08" | "OBT-09" | "OBT-10" | "OBT-11" | "OBT-12" | "OBT-13" | "OBT-14" | "OBT-15" | "OBT-16" | "OBT-17" | "OBT-18" | "OBT-19" | "OBT-20" | "OBT-21" | "OBT-22" | "OBT-23" | "OBT-24" | "OBT-25";
export type StepId = "sources.ask" | "agents.budget" | "agents.overview" | "approval.inspect" | "approval.resolve" | "attachments.add" | "attachments.review" | "automation.action" | "automation.control" | "automation.trigger" | "connections.audit" | "connections.services" | "cwd.inspect" | "feed.read" | "feed.sources" | "first.compose" | "first.execution" | "first.permissions" | "first.result" | "first.send" | "first.session" | "inbox.queue" | "inbox.triage" | "learning.controls" | "learning.library" | "meetings.list" | "meetings.result" | "memory.inspect" | "memory.save" | "memory.scope" | "models.picker" | "models.settings" | "notes.create" | "notes.save" | "pages.open" | "pages.state" | "parallel.new" | "parallel.return" | "project.link" | "project.open" | "search.open" | "search.query" | "skills.explain" | "skills.select" | "sources.details" | "sources.result" | "sources.select" | "sources.status" | "tasks.create" | "tasks.delegate" | "voice.review" | "voice.start" | "workflow.board" | "workflow.label" | "workflow.status" | "workspace.scope";
export type TargetId = "agents.budget" | "agents.summary" | "automation.action" | "automation.controls" | "automation.trigger" | "composer.attach" | "composer.attachments" | "composer.directory" | "composer.input" | "composer.model" | "composer.permissions" | "composer.send" | "composer.skills" | "composer.sources" | "composer.voice" | "connections.audit" | "connections.services" | "feed.reader" | "feed.sources" | "inbox.actions" | "inbox.list" | "learning.library" | "learning.preferences" | "meetings.artifacts" | "meetings.list" | "memory.editor" | "memory.list" | "memory.scope" | "notes.create" | "notes.editor" | "pages.freshness" | "pages.host" | "permission.actions" | "permission.request" | "projects.list" | "search.input" | "search.results" | "session.entry" | "session.execution" | "session.final-result" | "session.labels" | "session.list" | "session.new" | "session.project" | "session.status" | "session.tool-result" | "sessions.view-switcher" | "settings.ai" | "skills.list" | "source.status" | "sources.list" | "tasks.delegate" | "tasks.quick-entry" | "workspace.switcher";
export type SignalName = "attachment.ready" | "connections.audit-visible" | "dictation.inserted" | "draft.nonempty" | "execution.state-visible" | "feed.item-opened" | "meeting.artifact-opened" | "memory.persisted" | "model-picker.opened" | "note.created" | "note.persisted" | "page.rendered" | "permission.resolved-by-user" | "personal-task.delegated" | "personal-task.persisted" | "project.visible" | "search.finished" | "search.result-opened" | "session.created" | "session.labels-committed" | "session.project-committed" | "session.ready" | "session.reopened" | "session.sources-committed" | "session.status-committed" | "sessions.view-visible" | "skill.selected" | "source.details-visible" | "source.tool-succeeded" | "user-turn.accepted" | "user-turn.final-delivered";
export type CapabilityId = "agent-center.available" | "attachments.available" | "automation.entity-present" | "automations.available" | "connection-fabric.available" | "feed.available" | "filesystem.selector" | "inbox.available" | "labels.available" | "meeting.artifact-present" | "meetings.available" | "memory.available" | "memory.write-available" | "notes.available" | "pages.available" | "pages.entity-present" | "permissions.pending" | "personal-tasks.available" | "projects.available" | "search.available" | "sessions.available" | "shell.ready" | "skills.available" | "sources.list" | "sources.ready" | "task.delegation-available" | "voice.available";
export type TriggerId = "agent-center-opened" | "attachment-control-opened" | "automation-editor-opened" | "connections-opened" | "feed-opened" | "first-answer-delivered" | "inbox-opened" | "learning-manual-start" | "material-persisted" | "meetings-opened" | "memory-opened" | "model-picker-opened" | "notes-opened" | "page-opened" | "permission-request-present" | "project-opened" | "ready-source-available" | "second-session-created" | "session-workflow-opened" | "settings-ai-opened" | "skills-opened" | "sources-opened" | "tasks-opened" | "voice-control-opened" | "welcome-created" | "working-directory-opened" | "workspace-menu-opened";
export type RouteKey = "agents" | "connections" | "current-session" | "feed" | "inbox" | "keep" | "learning" | "meetings" | "memory" | "notes" | "projects" | "search" | "selected-automation" | "selected-page" | "selected-source" | "settings-ai" | "skills" | "sources" | "tasks";

export type EvidenceLevel = 'acknowledged' | 'observed' | 'verified';
export type Phase = 'idle' | 'preparing' | 'locating' | 'presenting' | 'waiting-action'
  | 'handed-off' | 'paused' | 'blocked' | 'finished';
export type SafeReason = 'user-paused' | 'user-dismissed' | 'scope-changed' | 'focus-lost'
  | 'modal-open' | 'target-missing' | 'ambiguous-target' | 'target-occluded'
  | 'route-timeout' | 'unsupported-platform' | 'api-unavailable' | 'not-authorized'
  | 'installing' | 'not-connected' | 'network-unavailable' | 'missing-entity'
  | 'storage-unavailable' | 'lease-lost' | 'operation-failed' | 'correlation-ambiguous';
export interface TourScope {
  readonly workspaceId: string;
  readonly panelId: string;
  readonly sessionId?: string;
  readonly entityId?: string;
 }
export interface TourBinding extends TourScope {
  readonly clientProfileId: string;
  readonly runToken: string;
}
export type CompletionPolicy =
  | { readonly kind: 'ack'; readonly signal: null; readonly evidence: 'acknowledged';
      readonly priorState: 'after-activation' | 'allow-current-state' | 'same-attempt';
      readonly requireAcknowledgementAfterEvidence: boolean }
  | { readonly kind: 'signal'; readonly signal: SignalName; readonly evidence: 'observed' | 'verified';
      readonly priorState: 'after-activation' | 'allow-current-state' | 'same-attempt';
      readonly requireAcknowledgementAfterEvidence: boolean };
export interface StepCopy { readonly title: string; readonly body: string }
export interface TourStep {
  readonly id: StepId;
  readonly version: number;
  readonly target: TargetId;
  readonly routeKey: RouteKey;
  readonly scope: 'shell' | 'bound-panel';
  readonly copyKey: string;
  readonly copy: Readonly<Record<'ru' | 'en', StepCopy>>;
  readonly completion: CompletionPolicy;
  readonly handoff: boolean;
  readonly optional: boolean;
  readonly requires: readonly CapabilityId[];
  readonly onUnavailable: 'block' | 'not-applicable';
  readonly missingTarget: 'block-and-offer-retry-or-pause';
  readonly notes: string;
  readonly testId: string;
}
export interface TourDefinition {
  readonly id: TourId;
  readonly slug: string;
  readonly version: number;
  readonly title: string;
  readonly goal: string;
  readonly why: string;
  readonly trigger: string; // Authoring metadata; not executable logic or UI copy.
  readonly entryTriggers: readonly TriggerId[];
  readonly titleKey: string;
  readonly goalKey: string;
  readonly whyKey: string;
  readonly requires: readonly CapabilityId[];
  readonly owner: string;
  readonly evidence: readonly string[];
  readonly priority: 'P0' | 'P1' | 'P2';
  readonly steps: readonly TourStep[];
}
export type TourCapability =
  | { readonly state: 'ready' }
  | { readonly state: 'pending' | 'unavailable' | 'denied'; readonly reason: SafeReason };
export type CapabilitySnapshot = Readonly<Partial<Record<CapabilityId, TourCapability>>>;
export interface TourSignalBase {
  readonly name: SignalName;
  readonly binding: TourBinding; // Runtime only; never serialize to diagnostics.
  readonly operationToken?: string;
  readonly operationStartedAt?: number;
  readonly eventToken: string;
  readonly at: number;
}
export type TourSignal = TourSignalBase & (
  | { readonly level: 'observed'; readonly origin: 'native-event' | 'native-commit' | 'ui-observation' }
  | { readonly level: 'verified'; readonly origin: 'native-event' | 'native-commit' }
);
export interface TourTargetRegistration {
  readonly registrationToken: string;
  readonly id: TargetId;
  readonly scope: 'shell' | 'bound-panel';
  readonly context: TourScope; // DOM targets exist independently of an attempt/runToken.
  readonly variant: 'regular' | 'compact' | 'rail';
  readonly element: HTMLElement;
}
export interface TargetRegistry {
  register(target: TourTargetRegistration): () => void;
  resolve(id: TargetId, binding: TourBinding):
    { status: 'ready'; target: TourTargetRegistration }
    | { status: 'blocked'; reason: SafeReason };
  subscribe(listener: () => void): () => void;
}
export interface StepProgress {
  readonly stepId: StepId;
  readonly stepVersion: number;
  readonly shownAt?: number;
  readonly acknowledgedAt?: number;
  readonly observedAt?: number;
  readonly verifiedAt?: number;
  readonly skippedAt?: number;
  readonly notApplicableReason?: SafeReason;
}
export interface TourProgress {
  readonly schemaVersion: 1;
  readonly scopeKey: string;
  readonly tourId: TourId;
  readonly tourVersion: number;
  readonly revision: number;
  readonly status: 'not-started' | 'in-progress' | 'completed-learning' | 'partial' | 'dismissed';
  readonly steps: Readonly<Partial<Record<StepId, StepProgress>>>;
  readonly dismissedUntilVersion?: number;
}
export interface TourAttempt {
  readonly id: string;
  readonly tourId: TourId;
  readonly binding: TourBinding; // Strip binding IDs when persisting attempts.
  readonly phase: Phase;
  readonly stepId: StepId;
  readonly startedAt: number;
  readonly reason?: SafeReason;
  readonly operationToken?: string;
}
export type PersistResult<T> =
  | { readonly status: 'saved'; readonly value: T }
  | { readonly status: 'memory-only'; readonly value: T; readonly reason: 'storage-unavailable' }
  | { readonly status: 'failed'; readonly reason: 'storage-unavailable' };
export type ProgressMutation =
  | { readonly kind: 'evidence'; readonly stepId: StepId; readonly stepVersion: number;
      readonly level: EvidenceLevel | 'shown'; readonly at: number }
  | { readonly kind: 'skip'; readonly stepId: StepId; readonly stepVersion: number; readonly at: number }
  | { readonly kind: 'not-applicable'; readonly stepId: StepId; readonly stepVersion: number; readonly reason: SafeReason }
  | { readonly kind: 'dismiss'; readonly tourVersion: number }
  | { readonly kind: 'finish'; readonly status: 'completed-learning' | 'partial' };
export interface ProgressRepository {
  read(scopeKey: string, tourId: TourId): Promise<PersistResult<TourProgress | null>>;
  apply(scopeKey: string, tour: TourDefinition, mutation: ProgressMutation): Promise<PersistResult<TourProgress>>;
  resetScope(scopeKey: string): Promise<PersistResult<void>>;
}
export interface WindowLease {
  readonly ownerWindowId: string;
  readonly fence: number;
  readonly expiresAt: number;
}
export interface LeaseRepository {
  acquire(profileId: string, ownerWindowId: string, now: number): Promise<WindowLease | null>;
  renew(profileId: string, lease: WindowLease, now: number): Promise<WindowLease | null>;
  release(profileId: string, lease: WindowLease): Promise<void>;
}
export interface EngineSnapshot {
  readonly enabled: boolean;
  readonly shellReady: boolean;
  readonly navigationReady: boolean;
  readonly navigationRevision: number;
  readonly foreground: boolean;
  readonly blockers: readonly SafeReason[];
  readonly capabilities: CapabilitySnapshot;
}
export interface AttemptStepEvidence {
  readonly shownAt?: number;
  readonly acknowledgedAt?: number;
  readonly level?: EvidenceLevel;
  readonly at?: number;
}
export interface RuntimeState {
  readonly snapshot?: EngineSnapshot;
  readonly stepActivatedAt?: number;
  readonly seenEventTokens?: readonly string[];
  readonly attemptEvidence: Readonly<Partial<Record<StepId, AttemptStepEvidence>>>;
  readonly definition: TourDefinition | null;
  readonly phase: Phase;
  readonly attempt: TourAttempt | null;
  readonly progress: TourProgress | null;
}
export type TourInput =
  | { readonly type: 'START'; readonly tour: TourDefinition; readonly binding: TourBinding;
      readonly progress: TourProgress | null; readonly startMode: 'new' | 'resume' | 'replay';
      readonly fromStepId?: StepId; readonly at: number }
  | { readonly type: 'SNAPSHOT'; readonly snapshot: EngineSnapshot }
  | { readonly type: 'SIGNAL'; readonly signal: TourSignal }
  | { readonly type: 'VIEW_READY'; readonly runToken: string; readonly stepId: StepId; readonly navigationRevision: number }
  | { readonly type: 'TARGET_READY'; readonly runToken: string; readonly stepId: StepId }
  | { readonly type: 'ACK' | 'BACK' | 'SKIP' | 'RETRY'; readonly runToken: string; readonly stepId: StepId; readonly at: number }
  | { readonly type: 'HANDOFF_OPEN' | 'HANDOFF_CLOSED'; readonly runToken: string; readonly stepId: StepId }
  | { readonly type: 'PAUSE'; readonly runToken: string; readonly reason: SafeReason }
  | { readonly type: 'DISMISS'; readonly runToken: string }
  | { readonly type: 'TIMEOUT'; readonly runToken: string; readonly stepId: StepId };
export type TourEffect =
  | { readonly type: 'RESOLVE_VIEW'; readonly routeKey: RouteKey; readonly binding: TourBinding }
  | { readonly type: 'LOCATE'; readonly targetId: TargetId; readonly binding: TourBinding }
  | { readonly type: 'PRESENT'; readonly step: TourStep; readonly binding: TourBinding }
  | { readonly type: 'HIDE' }
  | { readonly type: 'STORE'; readonly scopeKey: string; readonly tour: TourDefinition; readonly mutation: ProgressMutation }
  | { readonly type: 'ANNOUNCE'; readonly copyKey: string }
  | { readonly type: 'ARM_TIMEOUT'; readonly runToken: string; readonly stepId: StepId; readonly milliseconds: number }
  | { readonly type: 'CANCEL_TIMEOUT' }
  | { readonly type: 'CLEANUP' };
export interface Transition { readonly state: RuntimeState; readonly effects: readonly TourEffect[] }
export type TransitionFunction = (state: RuntimeState, input: TourInput) => Transition;
export interface LearningHooksPort {
  emit(signal: TourSignal): void;
  start(tourId: TourId, options?: { readonly mode: 'new' | 'resume' | 'replay'; readonly fromStepId?: StepId }): void;
  pause(reason: SafeReason): void;
}
