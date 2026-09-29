import roxLogo from "@/assets/rox-logo.png"

interface CraftAgentsSymbolProps {
  className?: string
}

/** Rox mark (stippled portrait on the dark plate) — kept export name so existing onboarding/splash imports stay stable. */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return (
    <img
      src={roxLogo}
      alt="Rox"
      className={className}
      style={{ borderRadius: "22%", objectFit: "cover", aspectRatio: "1 / 1" }}
      draggable={false}
    />
  )
}
