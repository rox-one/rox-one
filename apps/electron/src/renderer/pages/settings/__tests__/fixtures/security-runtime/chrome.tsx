import type { ReactNode } from 'react'
export function PanelHeader({ title, actions }: { title: string; actions: ReactNode }) { return <header className="flex items-center justify-between gap-3 border-b p-3"><h1>{title}</h1>{actions}</header> }
export function HeaderMenu() { return null }
