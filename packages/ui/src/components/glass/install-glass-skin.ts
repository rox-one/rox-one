import { applyGlassTier } from '../../lib/glass-capability'
import { EDGE_MAP } from './edge-map'

export const SKIN_FILTER_ID = 'rox-glass-skin-refraction'

let installed: (() => void) | null = null

/**
 * App-root glass install, called once from a lazy chunk: loads the Arc Glass
 * skin CSS, sets html[data-glass] (live), and mounts one shared refraction
 * filter for the skin's static slots. Idempotent; returns the uninstall.
 */
export function installGlassSkin(doc: Document = document): () => void {
  if (installed) return installed
  // Un-awaited: the skin only restyles; a failed CSS chunk leaves the plain look.
  import('./arc-glass-skin.css').catch(() => {})
  const releaseTier = applyGlassTier(doc.documentElement)
  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = doc.createElementNS(svgNS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden')
  svg.innerHTML =
    `<filter id="${SKIN_FILTER_ID}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">` +
    `<feImage href="${EDGE_MAP}" x="0%" y="0%" width="100%" height="100%" preserveAspectRatio="none" result="map"/>` +
    '<feDisplacementMap in="SourceGraphic" in2="map" scale="12" xChannelSelector="R" yChannelSelector="G"/></filter>'
  doc.body.appendChild(svg)
  installed = () => {
    releaseTier()
    svg.remove()
    installed = null
  }
  return installed
}
