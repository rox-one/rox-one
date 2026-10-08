/**
 * W1-03 (#1500) — Workspace command service: the `workspace` authority's
 * CommandExecutor (registry + Postgres store + authorizer + post-commit
 * relay) behind the HTTP route.
 */

import type { AuthenticatedActor } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import type { Authorizer, CommandReceipt, CommandRegistry } from '../../../../../packages/core/src/commands/index.ts'
import type { DomainEvent } from '../../../../../packages/core/src/events/index.ts'
import { CommandExecutor } from '../../../../../packages/server-core/src/commands/executor.ts'
import { createCommandRegistry } from '../../../../../packages/server-core/src/commands/registry.ts'
import type { CommandStore } from '../../../../../packages/server-core/src/commands/store.ts'
import type { WorkspaceCommandHttpAuthority } from './routes.ts'

export interface WorkspaceCommandServiceOptions {
  store: CommandStore
  /** Defaults to the full catalogue + `system.ping`; module flags off. */
  registry?: CommandRegistry
  authorizer?: Authorizer
  /** Post-commit publication (the events relay). */
  publish?: (events: DomainEvent[]) => void | Promise<void>
  onError?: (error: unknown) => void
}

export class WorkspaceCommandService implements WorkspaceCommandHttpAuthority {
  readonly executor: CommandExecutor
  readonly registry: CommandRegistry

  constructor(options: WorkspaceCommandServiceOptions) {
    this.registry = options.registry ?? createCommandRegistry()
    this.executor = new CommandExecutor({
      registry: this.registry,
      store: options.store,
      authority: 'workspace',
      ...(options.authorizer ? { authorizer: options.authorizer } : {}),
      ...(options.publish ? { publish: options.publish } : {}),
      ...(options.onError ? { onPublishError: options.onError, onHandlerError: options.onError, onStoreError: options.onError } : {}),
    })
  }

  execute(actor: AuthenticatedActor, workspaceId: string, envelope: unknown): Promise<CommandReceipt> {
    return this.executor.execute({ workspaceId, actor: { principalId: actor.principalId, kind: 'user' }, envelope })
  }
}
