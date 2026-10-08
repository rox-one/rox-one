import { useActionLabel, type ActionId } from '@/actions'
// W1-07 (#1504): flag-gated actions show (and rebind) once their flag is on.
import { useActionsByCategory } from '@/actions/useVisibleActions'

export function KeyboardShortcuts() {
  const actionsByCategory = useActionsByCategory()
  return (
    <div className="space-y-6">
      {Object.entries(actionsByCategory).map(([category, actions]) => (
        <section key={category}>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            {category}
          </h3>
          <div className="space-y-1">
            {actions.map(action => (
              <ShortcutRow key={action.id} actionId={action.id as ActionId} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ShortcutRow({ actionId }: { actionId: ActionId }) {
  const { label, description, hotkey } = useActionLabel(actionId)

  return (
    <div className="flex items-center justify-between py-1.5">
      <div>
        <div className="text-sm">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      {hotkey && (
        <kbd className="px-2 py-1 text-xs bg-muted rounded">{hotkey}</kbd>
      )}
    </div>
  )
}
