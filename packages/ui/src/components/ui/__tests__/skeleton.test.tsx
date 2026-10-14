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
  it("clamps lines to an integer >= 1 and lines wins over circle", () => {
    expect(renderToStaticMarkup(<Skeleton lines={2.7} />).match(/class="rox-skeleton"/g)?.length).toBe(2)
    const zero = renderToStaticMarkup(<Skeleton lines={0} />)
    expect(zero).not.toContain("rox-skeleton-stack")
    expect(zero.match(/rox-skeleton/g)?.length).toBe(1)
    const both = renderToStaticMarkup(<Skeleton lines={3} circle />)
    expect(both).toContain("rox-skeleton-stack")
    expect(both).not.toContain("rox-skeleton--circle")
  })
  it("whole skeleton block lives inside @layer components and has no will-change", () => {
    const css = readFileSync(join(import.meta.dir, "../../../styles/index.css"), "utf8")
    const start = css.indexOf("@layer components {", css.indexOf("@layer components {") >= 0 ? css.lastIndexOf("@layer components {", css.indexOf(".rox-skeleton {")) : -1)
    expect(start).toBeGreaterThanOrEqual(0)
    let depth = 0, end = -1
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++
      else if (css[i] === "}" && --depth === 0) { end = i; break }
    }
    const layer = css.slice(start, end)
    const outside = css.slice(0, start) + css.slice(end)
    expect(layer).toContain(".rox-skeleton {")
    expect(layer).toContain("html[data-resizing] .rox-skeleton::after")
    expect(layer).toContain("prefers-reduced-motion: reduce")
    expect(outside).not.toContain("rox-skeleton")
    expect(layer).not.toContain("will-change")
  })
})
