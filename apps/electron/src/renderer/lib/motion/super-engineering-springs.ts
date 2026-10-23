/**
 * Rox Engineering JS spring presets.
 *
 * Mirrors packages/ui motion tokens (`--ease-spring` / `--motion-spring`) and
 * the CSS overlay springs shipped in #2235–#2239. Prefer these exports over
 * one-off `{ stiffness, damping }` objects so SE stays one motion system.
 *
 * Call sites must still honor `usePrefersReducedMotion()` / performance
 * profile (duration: 0) — springs do not auto-zero.
 */

/** Rail / panel / compact-stack slides (WorktreeHoverCard, PiP, compact panels). */
export const SE_SPRING_PANEL = { type: 'spring' as const, stiffness: 380, damping: 42, mass: 0.8 }

/** Modal / dialog presence — CSS `--motion-spring` ≈ this (~0.35s settle). */
export const SE_SPRING_MODAL = { type: 'spring' as const, stiffness: 520, damping: 38, mass: 0.9 }

/** Lightweight tagline / accent copy. */
export const SE_SPRING_TAGLINE = { type: 'spring' as const, stiffness: 420, damping: 40, mass: 0.7 }

/**
 * List / nested-nav row presence. Alias of PANEL — do not invent a fourth curve.
 */
export const SE_SPRING_LIST = SE_SPRING_PANEL

/**
 * JS durations (seconds) matching CSS `--motion-*`. Use when framer-motion
 * needs a tween instead of a spring; still gate with reduced-motion → 0.
 */
export const SE_MOTION_SEC = {
  fast: 0.12,
  base: 0.18,
  disclosure: 0.18,
  overlay: 0.24,
} as const
