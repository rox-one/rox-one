import { useState, type KeyboardEvent, type MouseEvent, type SyntheticEvent } from "react"
import { useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { SessionStatusMenu } from "@/components/ui/session-status-menu"
import { getStateIcon, getStateIconStyle } from "@/config/session-status-config"
import { useSessionListContext } from "@/context/SessionListContext"
import { kanbanEditorTargetAtom } from "@/atoms/kanban"
import type { SessionMeta } from "@/atoms/sessions"
import { navigate, routes } from "@/lib/navigate"
import { getSessionTitle, getSessionStatus } from "@/utils/session"
import { rememberCollectionView } from "./collection/collection-view-cycle"
import { sessionRowClickTarget } from "./session-row-click"

interface SessionStatusIconProps {
  item: SessionMeta
}

function stopRowSelect(e: SyntheticEvent) {
  e.preventDefault()
  e.stopPropagation()
}

export function SessionStatusIcon({ item }: SessionStatusIconProps) {
  const { t } = useTranslation()
  const ctx = useSessionListContext()
  const [open, setOpen] = useState(false)
  const status = getSessionStatus(item)
  const setKanbanEditorTarget = useSetAtom(kanbanEditorTargetAtom)

  const handleSelect = (state: import("@/config/session-status-config").SessionStatusId) => {
    setOpen(false)
    ctx.onSessionStatusChange(item.id, state)
  }

  const openBoardCard = (e: MouseEvent | KeyboardEvent) => {
    stopRowSelect(e)
    if (sessionRowClickTarget("status") !== "board") return
    rememberCollectionView("list")
    setKanbanEditorTarget({
      mode: "edit",
      sessionId: item.id,
      taskSlug: item.taskSlug,
      initialTitle: getSessionTitle(item),
    })
    navigate(routes.view.board(item.id))
  }

  const label = t("collection.row.openBoardCard")

  return (
    <Popover modal={true} open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          className={cn(
            "!h-5 !w-5 flex items-center justify-center rounded-full transition-colors cursor-pointer",
            "hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "[&>svg]:w-full [&>svg]:h-full [&>img]:w-full [&>img]:h-full [&>span]:text-base",
          )}
          style={getStateIconStyle(status, ctx.sessionStatuses)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          title={label}
          onPointerDown={(e: MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation()
          }}
          onMouseDown={(e: MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation()
          }}
          onClick={(e: MouseEvent<HTMLButtonElement>) => {
            if (e.button !== 0 && e.button !== undefined) return
            openBoardCard(e)
          }}
          onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
            if (e.key === "Enter" || e.key === " ") {
              openBoardCard(e)
            }
          }}
          onContextMenu={(e: MouseEvent<HTMLButtonElement>) => {
            stopRowSelect(e)
            setOpen(true)
          }}
        >
          {getStateIcon(status, ctx.sessionStatuses)}
        </button>
      </PopoverAnchor>
      <PopoverContent
        className="w-auto p-0 border-0 shadow-none bg-transparent"
        align="start"
        side="bottom"
        sideOffset={4}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <SessionStatusMenu
          activeState={status}
          onSelect={handleSelect}
          states={ctx.sessionStatuses}
          isArchived={item.isArchived}
          onArchive={ctx.onArchive ? () => { setOpen(false); ctx.onArchive!(item.id) } : undefined}
          onUnarchive={ctx.onUnarchive ? () => { setOpen(false); ctx.onUnarchive!(item.id) } : undefined}
        />
      </PopoverContent>
    </Popover>
  )
}
