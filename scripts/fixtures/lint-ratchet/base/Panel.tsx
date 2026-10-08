import { cn } from './cn'

export function Panel({ open }: { open: boolean }) {
  return (
    <div className={cn('relative z-popover', open && 'z-50')}>
      <span className="z-island">menu</span>
    </div>
  )
}
