/* eslint-disable rox/no-hardcoded-z-index */
/* eslint rox/no-hardcoded-z-index: off */
import { cn } from './cn'

export function Directives() {
  return (
    <div>
      {/* file-wide disable and inline config above: still counted */}
      <div className="z-10" />
      {/* eslint-disable-next-line rox/no-hardcoded-z-index */}
      <div className="z-20" />
      {/* eslint-disable-next-line */}
      <div className="z-30" />
      {/* eslint-disable-next-line rox/no-hardcoded-z-index -- */}
      <div className="z-40" />
      {/* eslint-disable-next-line rox/no-raw-color -- wrong rule named */}
      <div className="z-50" />
      {/* eslint-disable-next-line rox/no-hardcoded-z-index -- drag ghost must beat the island layer; tracked in #1568 */}
      <div className="z-[9999]" />
      <div className={cn('z-[60]')} /> {/* eslint-disable-line rox/no-hardcoded-z-index -- vendor widget contract */}
    </div>
  )
}
