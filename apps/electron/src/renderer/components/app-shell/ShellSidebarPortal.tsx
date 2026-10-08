import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { handleSidebarTreeKeyDown } from './sidebar-keyboard'

/** Active panel navigators share the primary sidebar; other panels retain their own navigation. */
export const ShellSidebarContext = React.createContext<HTMLElement | null>(null)

export function useShellSidebarTarget(): HTMLElement | null {
  const target = React.useContext(ShellSidebarContext)
  return target
}

export function ShellSidebarPortal({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) {
  const target = useShellSidebarTarget()
  if (target) {
    return createPortal(
      <div onKeyDown={handleSidebarTreeKeyDown} className="flex min-h-0 flex-col gap-1 px-2 py-2" data-contextual-sidebar="true" data-testid={(props as { 'data-testid'?: string })['data-testid']}>
        {children}
      </div>, target,
    )
  }
  return <nav {...props} className={cn('flex flex-col', className)}>{children}</nav>
}
