import { cn } from "@/lib/utils"
import inkBlack from "@/assets/rox-avatar-ink-black.png"
import inkWhite from "@/assets/rox-avatar-ink-white.png"

interface CraftAgentsSymbolProps {
  className?: string
}

/**
 * Rox brand mark: the current ink avatar artwork, drawn without a plate or tile
 * behind it. The component is theme-aware on its own — it renders the black-ink
 * art on light surfaces and swaps to the white-ink art when the document root
 * carries the `dark` class, so callers MUST NOT apply `dark:invert` themselves.
 * Export name kept so splash/onboarding imports stay stable.
 */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return (
    <>
      <img
        src={inkBlack}
        alt="Rox"
        className={cn("dark:hidden", className)}
        style={{ objectFit: "contain", aspectRatio: "1 / 1", background: "transparent" }}
        draggable={false}
      />
      <img
        src={inkWhite}
        alt=""
        aria-hidden="true"
        className={cn("hidden dark:block", className)}
        style={{ objectFit: "contain", aspectRatio: "1 / 1", background: "transparent" }}
        draggable={false}
      />
    </>
  )
}