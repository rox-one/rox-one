import roxLogo from "@/assets/rox-logo.png"

interface CraftAppIconProps {
  className?: string
  size?: number
}

/** Rox mark (website favicon / email logo). */
export function CraftAppIcon({ className, size = 64 }: CraftAppIconProps) {
  return (
    <img
      src={roxLogo}
      alt="Rox"
      width={size}
      height={size}
      className={className}
    />
  )
}
