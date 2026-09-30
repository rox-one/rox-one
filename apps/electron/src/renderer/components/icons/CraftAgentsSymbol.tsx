import roxLogo from "@/assets/rox-logo.png"

interface CraftAgentsSymbolProps {
  className?: string
}

/** Rox mark: the transparent black-and-white portrait, drawn without a plate or tile behind it. Export name kept so splash/onboarding imports stay stable. */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return (
    <img
      src={roxLogo}
      alt="Rox"
      className={className}
      style={{ objectFit: "contain", aspectRatio: "1 / 1", background: "transparent" }}
      draggable={false}
    />
  )
}
