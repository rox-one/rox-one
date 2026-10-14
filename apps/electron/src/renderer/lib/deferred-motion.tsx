/**
 * Renderer re-export of the shared lazy motion host. Boot-reachable shell
 * files import from here so the source-level contract can name one path;
 * Island/BrowserControls import the same module via relative path in
 * packages/ui so Vite emits a single dynamic `motion/react` chunk.
 *
 * Relative import (not `@rox/ui/lazy-motion`): bun test does not apply the
 * Vite worktree export map, and the hoisted node_modules/@rox/ui may point
 * at another checkout.
 */
export {
  AnimatePresence,
  DeferredMotionConfig,
  PresenceDiv,
  loadMotion,
  motion,
  useIsPresent,
  useMotionModule,
} from '../../../../../packages/ui/src/lib/lazy-motion'
