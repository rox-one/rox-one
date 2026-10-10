/**
 * «Инлайн-одобрения» — story: `screen-inline-approval`.
 *
 * Deterministic fixture for the chat-continuum approval / credential cards.
 * The decks own their own optimistic commit, so the story just records the
 * response the continuum would receive and lets the `state` control drive the
 * externally imposed states (pending / disabled / error).
 */
import * as React from 'react'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { InlineApprovalCard, type InlineApprovalInputState } from '@/components/app-shell/chat-continuum/InlineApprovalCard'
import { InlineCredentialCard } from '@/components/app-shell/chat-continuum/InlineCredentialCard'
import type {
  PermissionRequest as PermissionRequestType,
  CredentialRequest as CredentialRequestType,
  CredentialResponse,
} from '../../shared/types'
import type { PermissionResponse } from '@/components/app-shell/input/structured/types'

const DEMO_PERMISSION: PermissionRequestType = {
  requestId: 'demo-permission',
  sessionId: 'demo-session',
  type: 'file_write',
  toolName: 'write_file',
  description:
    'Правка двух строк в src/sections/Pricing.tsx: число колонок берётся из конфига планов вместо жёсткого значения.',
  command:
    'write_file src/sections/Pricing.tsx\n  @@ 42,44 @@\n  − const plans = PLANS.slice(0, 2)\n  + const plans = PLANS.filter(plan => plan.visible)',
}

const DEMO_CREDENTIAL: CredentialRequestType = {
  requestId: 'demo-credential',
  sessionId: 'demo-session',
  sourceSlug: 'demo-source',
  sourceName: 'Datadog',
  type: 'credential',
  mode: 'bearer',
  description: 'Вставьте API-ключ источника, чтобы Rox мог читать метрики.',
  hint: 'Ключ создаётся в Organization Settings → API Keys.',
}

interface InlineApprovalDemoProps {
  approvalState: InlineApprovalInputState
  disabledCredential: boolean
}

function InlineApprovalDemo({ approvalState, disabledCredential }: InlineApprovalDemoProps) {
  const [permission, setPermission] = React.useState('—')
  const [credential, setCredential] = React.useState('—')

  const onPermission = React.useCallback((response: PermissionResponse) => {
    setPermission(`allowed=${response.allowed} · alwaysAllow=${response.alwaysAllow}`)
  }, [])
  const onCredential = React.useCallback((response: CredentialResponse) => {
    setCredential(response.cancelled ? 'cancelled' : 'submitted')
  }, [])

  return (
    <div
      className="h-full w-full overflow-auto bg-surface-canvas p-4 text-text-primary"
      data-testid="screen-inline-approval"
    >
      <div className="mx-auto max-w-[720px] space-y-3">
        <InlineApprovalCard
          request={DEMO_PERMISSION}
          onResponse={onPermission}
          state={approvalState}
          errorText={
            approvalState === 'error'
              ? 'Не удалось записать решение: сессия недоступна. Повторите или запретите запрос.'
              : undefined
          }
        />
        <InlineCredentialCard
          request={DEMO_CREDENTIAL}
          onResponse={onCredential}
          disabled={disabledCredential}
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated px-3 py-2 text-caption text-text-secondary">
          <span>
            permission → <span className="font-mono">{permission}</span>
          </span>
          <span>
            credential → <span className="font-mono">{credential}</span>
          </span>
        </div>
      </div>
    </div>
  )
}

export default definePlaygroundStory({
  id: 'screen-inline-approval',
  name: 'Континуум — инлайн-одобрения',
  category: 'Unified Shell',
  level: 'Screens',
  description:
    'G5: инлайн-карточки одобрения и учётных данных внутри хода. Cmd/Ctrl+Enter активирует «Разрешить», Tab останавливается на нём первым; после решения подвал кроссфейдится за 180 мс. Состояния pending/disabled/error задаются контролом.',
  component: InlineApprovalDemo,
  layout: 'full',
  previewOverflow: 'hidden',
  props: [
    {
      name: 'approvalState',
      description: 'Внешнее состояние карточки одобрения',
      control: {
        type: 'select',
        options: [
          { label: 'Ожидает', value: 'pending' },
          { label: 'Отключено', value: 'disabled' },
          { label: 'Ошибка', value: 'error' },
        ],
      },
      defaultValue: 'pending',
    },
    {
      name: 'disabledCredential',
      description: 'Заблокировать карточку учётных данных',
      control: { type: 'boolean' },
      defaultValue: false,
    },
  ],
  variants: [
    { name: 'Отключено', props: { approvalState: 'disabled' } },
    { name: 'Ошибка решения', props: { approvalState: 'error' } },
    { name: 'Всё заблокировано', props: { approvalState: 'disabled', disabledCredential: true } },
  ],
})