import roxLogo from "@/assets/rox-logo.png"

interface CraftAppIconProps {
  className?: string
  size?: number
}

/** Rox mark (website favicon / email logo): transparent portrait, no plate or tile. */
export function CraftAppIcon({ className, size = 64 }: CraftAppIconProps) {
  return (
    <img
      src={roxLogo}
      alt="Rox"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain", aspectRatio: "1 / 1", background: "transparent" }}
      draggable={false}
    />
  )
}
