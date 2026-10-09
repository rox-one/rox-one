import { cn } from "@/lib/utils"
import inkBlack from "@/assets/rox-avatar-ink-black.png"
import inkWhite from "@/assets/rox-avatar-ink-white.png"

interface RoxTileMarkProps {
  className?: string
  /** Rendered size in CSS px. */
  size?: number
}

/**
 * Small Rox app mark for chrome (titlebar / app menu trigger): the bare ink
 * avatar on a transparent background (no plate). Theme-aware on its own — the
 * black-ink art is shown on light surfaces and the white-ink art when the
 * document root carries the `dark` class, so callers MUST NOT apply
 * `dark:invert` themselves.
 */
export function RoxTileMark({ className, size = 18 }: RoxTileMarkProps) {
  const style = { width: size, height: size, flexShrink: 0, background: "transparent" }
  return (
    <>
      <img
        src={inkBlack}
        alt="Rox"
        width={size}
        height={size}
        className={cn("dark:hidden", className)}
        style={style}
        draggable={false}
      />
      <img
        src={inkWhite}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className={cn("hidden dark:block", className)}
        style={style}
        draggable={false}
      />
    </>
  )
}