import type { SVGProps } from 'react'

export interface SeIconProps extends SVGProps<SVGSVGElement> {
  /**
   * Icon size. Only used when className doesn't include size classes.
   * Prefer Tailwind className="size-4" / "icon-caption" in the shell.
   */
  size?: number | string
}
