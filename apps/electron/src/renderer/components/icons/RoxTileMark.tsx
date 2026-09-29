import mark18 from "@/assets/rox-mark-portrait-18.png"
import mark36 from "@/assets/rox-mark-portrait-36.png"
import mark54 from "@/assets/rox-mark-portrait-54.png"

interface RoxTileMarkProps {
  className?: string
  /** Rendered size in CSS px (assets are pixel-tuned for 18px at 1x/2x/3x). */
  size?: number
}

/**
 * Small Rox app mark for chrome (titlebar / app menu trigger): the bare
 * portrait on a transparent background (no plate), cropped to the head from
 * the transparent brand master and rendered from size-tuned 1x/2x/3x rasters
 * so it stays crisp instead of downscaling the large artwork.
 */
export function RoxTileMark({ className, size = 18 }: RoxTileMarkProps) {
  return (
    <img
      src={mark36}
      srcSet={`${mark18} 1x, ${mark36} 2x, ${mark54} 3x`}
      alt="Rox"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, flexShrink: 0, background: "transparent" }}
      draggable={false}
    />
  )
}
