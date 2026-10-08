import { cn } from './cn'

export function Panel({ open }: { open: boolean }) {
  return (
    <div className={cn('relative z-popover', open && 'z-50')}>
      <span className="z-island">menu</span>
      <div className="absolute inset-x-0 z-10" />
      <div className={cn('fixed top-0', 'md:z-[60]')} />
    </div>
  )
}
