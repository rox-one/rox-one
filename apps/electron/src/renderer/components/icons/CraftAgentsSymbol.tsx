import roxLogo from "@/assets/rox-logo.png"

interface CraftAgentsSymbolProps {
  className?: string
}

/** Rox mark — kept export name so existing onboarding/splash imports stay stable. */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return (
    <img
      src={roxLogo}
      alt="Rox"
      className={className}
    />
  )
}
