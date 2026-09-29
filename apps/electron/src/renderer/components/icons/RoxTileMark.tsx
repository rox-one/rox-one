import tile18 from "@/assets/rox-mark-tile-18.png"
import tile36 from "@/assets/rox-mark-tile-36.png"
import tile54 from "@/assets/rox-mark-tile-54.png"

interface RoxTileMarkProps {
  className?: string
  /** Rendered size in CSS px (assets are pixel-tuned for 18px at 1x/2x/3x). */
  size?: number
}

/**
 * Small Rox app mark for chrome (titlebar / app menu trigger): the app icon's
 * rounded-square plate with the portrait, rendered from size-tuned 1x/2x/3x
 * rasters so it stays crisp instead of downscaling the large avatar.
 */
export function RoxTileMark({ className, size = 18 }: RoxTileMarkProps) {
  return (
    <img
      src={tile36}
      srcSet={`${tile18} 1x, ${tile36} 2x, ${tile54} 3x`}
      alt="Rox"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, flexShrink: 0 }}
      draggable={false}
    />
  )
}
