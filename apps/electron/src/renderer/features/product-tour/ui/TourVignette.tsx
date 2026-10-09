/**
 * Decorative edge vignette for the product-tour demo mode (D10). It is a pure
 * presentation layer: no pointer events, hidden from assistive technology, and
 * reduced motion keeps the static gradient (`.tour-vignette` in the shared theme).
 */
export function TourVignette() {
  // eslint-disable-next-line rox/prefer-primitives -- decorative, non-interactive vignette layer (aria-hidden, pointer-events-none); the overlay primitives are modal (scrim, portal, focus trap) which would add semantics this layer must not have.
  return <div data-product-tour-vignette="" aria-hidden="true" className="tour-vignette pointer-events-none fixed inset-0 z-tour-vignette motion-reduce:animate-none" />
}