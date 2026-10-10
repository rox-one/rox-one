/**
 * Utility functions for @rox/ui
 */

import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Named z-index layers registered in `styles/tokens/z.css` (`--z-index-*`).
 * tailwind-merge only knows numeric `z-*` values by default, so without this
 * `cn('z-popover', 'z-island')` keeps both classes and the CSS source order
 * (alphabetical), not the caller, decides which one wins.
 */
export const ROX_Z_LAYERS = [
  'base',
  'raised',
  'sticky',
  'chrome',
  'sash',
  'tour-vignette',
  'popover',
  'scrim',
  'modal',
  'toast',
  'fullscreen',
  'menu-backdrop',
  'island',
  'island-popover',
  'tooltip',
  'splash',
] as const

/**
 * Role-based font-size steps registered in `styles/tokens/type.css`
 * (`--text-*`). tailwind-merge would otherwise classify an unknown
 * `text-<name>` as a text colour and drop e.g. `text-foreground`.
 */
export const ROX_TEXT_SIZES = [
  'caption',
  'small',
  'body',
  'reading',
  'title',
  'title-sm',
  'display',
  'data',
  'prose',
  'title-md',
  'stat',
  'hero',
  'floor',
  'mark',
] as const

/** tailwind-merge instance that understands the Rox token utilities. */
export const roxTwMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...ROX_TEXT_SIZES],
    },
    classGroups: {
      z: [{ z: [...ROX_Z_LAYERS] }],
    },
  },
})

/**
 * Merge class names with Tailwind CSS conflict resolution
 */
export function cn(...inputs: ClassValue[]) {
  return roxTwMerge(clsx(inputs))
}
