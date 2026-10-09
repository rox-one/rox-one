/**
 * W1-10 (#1507) — axe runner.
 *
 * `runAxeAudit(html)` is a dependency-free structural audit over an HTML
 * string (img alt, button names, input labels, html lang); results are
 * marked `engine: 'builtin'`. Element rules apply to any audit root; the
 * document-level `html-lang` rule applies only when the HTML is a whole
 * document (`<html>` present), since the driver captures a surface fragment.
 *
 * axe-core is deliberately NOT used here: `axe.run()` needs a live DOM
 * (document / element context), and Bun has none, so feeding it an HTML
 * string would throw the moment axe-core became resolvable (e.g. pulled in
 * transitively by Playwright). Real axe-core runs only inside the wave-2
 * browser driver, against the rendered page; until then the axe gate is
 * pending (see gates/visual-axe.ts and the package README).
 */

export interface AxeViolation {
  rule: string
  selector: string
  message: string
}

export interface AxeAuditResult {
  /** 'axe-core' is reserved for results produced by the wave-2 browser driver. */
  engine: 'axe-core' | 'builtin'
  violations: AxeViolation[]
  pass: boolean
}

function builtinAudit(html: string): AxeViolation[] {
  const violations: AxeViolation[] = []
  const imgWithoutAlt = [...html.matchAll(/<img(?![^>]*\salt=)[^>]*>/gi)]
  for (const m of imgWithoutAlt) {
    violations.push({ rule: 'image-alt', selector: 'img', message: `img without alt: ${m[0].slice(0, 80)}` })
  }
  const emptyButtons = [...html.matchAll(/<button[^>]*>\s*<\/button>/gi)]
  for (const m of emptyButtons) {
    violations.push({ rule: 'button-name', selector: 'button', message: `empty button: ${m[0].slice(0, 80)}` })
  }
  const inputs = [...html.matchAll(/<input(?![^>]*\s(aria-label|aria-labelledby|id)=)[^>]*>/gi)]
  for (const m of inputs) {
    violations.push({ rule: 'input-label', selector: 'input', message: `input without label binding: ${m[0].slice(0, 80)}` })
  }
  // `html-lang` describes the document element: it only applies when the audit
  // root is a whole document. The wave-2 driver captures the product surface
  // (the preview-frame subtree, a fragment), where axe-core reports the rule
  // inapplicable rather than violated — so it is checked here only when the
  // audited HTML actually contains an `<html>` element.
  if (/<html[\s>]/i.test(html) && !/<html[^>]*\slang=/i.test(html)) {
    violations.push({ rule: 'html-lang', selector: 'html', message: 'html element is missing a lang attribute' })
  }
  return violations
}

export async function runAxeAudit(html: string): Promise<AxeAuditResult> {
  const violations = builtinAudit(html)
  return { engine: 'builtin', violations, pass: violations.length === 0 }
}
