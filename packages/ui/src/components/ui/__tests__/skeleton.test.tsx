import { describe, expect, it } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { renderToStaticMarkup } from "react-dom/server"
import { Skeleton } from "../Skeleton"

describe("Skeleton", () => {
  it("renders a decorative block", () => {
    const html = renderToStaticMarkup(<Skeleton className="w-10" />)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain("rox-skeleton w-10")
  })
  it("renders N lines with the last one marked", () => {
    const html = renderToStaticMarkup(<Skeleton lines={3} />)
    expect(html.match(/class="rox-skeleton"/g)?.length).toBe(3)
    expect(html.match(/data-last=""/g)?.length).toBe(1)
  })
  it("shimmer is transform-only and stops under reduced motion / resizing", () => {
    const css = readFileSync(join(import.meta.dir, "../../../styles/index.css"), "utf8")
    const kf = css.slice(css.indexOf("@keyframes rox-skeleton-shimmer"))
    expect(kf.slice(0, kf.indexOf("}"))).toContain("transform")
    expect(css).toContain("html[data-resizing] .rox-skeleton::after { animation: none; }")
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.rox-skeleton::after \{ animation: none; \}/)
  })
})
