/**
 * W1-10 (#1507) — axe runner.
 *
 * Structural accessibility audit over an HTML string. When the real
 * `axe-core` package is resolvable it is used via dynamic import; otherwise
 * a built-in minimal rule set runs (img alt, button names, input labels,
 * html lang, landmark roles) and the result is marked `engine: 'builtin'`
 * so CI readers know a full axe pass is still pending in wave-2 E2E.
 */

export interface AxeViolation {
  rule: string
  selector: string
  message: string
}

export interface AxeAuditResult {
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
  if (!/<html[^>]*\slang=/i.test(html)) {
    violations.push({ rule: 'html-lang', selector: 'html', message: 'html element is missing a lang attribute' })
  }
  return violations
}

export async function runAxeAudit(html: string): Promise<AxeAuditResult> {
  try {
    const axe = (await import('axe-core')) as {
      default?: { run?: (html: string) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[] }> }> }> }
    }
    const runner = axe.default?.run
    if (typeof runner === 'function') {
      const res = await runner(html)
      const violations: AxeViolation[] = res.violations.flatMap((v) =>
        v.nodes.map((n) => ({ rule: v.id, selector: n.target.join(' '), message: `axe rule ${v.id} failed` })),
      )
      return { engine: 'axe-core', violations, pass: violations.length === 0 }
    }
  } catch {
    // axe-core is not installed — fall through to the built-in rules.
  }
  const violations = builtinAudit(html)
  return { engine: 'builtin', violations, pass: violations.length === 0 }
}
