import { percentile } from './budgets'
import { redactString } from './redact'
import type { BenchmarkReport, InteractionKind, InteractionSample } from './types'
import { INTERACTION_KINDS } from './types'

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function kindLine(kind: InteractionKind, samples: InteractionSample[]): string {
  const durations = samples.map((s) => s.durationMs)
  const reloads = samples.filter((s) => s.collectionReload).length
  const n1 = samples.reduce((sum, s) => sum + s.nPlusOne.length, 0)
  return [
    `| ${kind} | ${samples.length} | ${avg(durations).toFixed(2)} | ${percentile(durations, 50).toFixed(2)} | ${percentile(durations, 95).toFixed(2)} | ${reloads} | ${n1} |`,
  ].join('')
}

export function formatBenchmarkReport(report: BenchmarkReport): string {
  const lines: string[] = []
  lines.push('# ROX performance report')
  lines.push('')
  lines.push(`Generated: ${redactString(report.generatedAt)}`)
  lines.push(`Result: ${report.passed ? 'PASS' : 'FAIL'}`)
  lines.push('')

  for (const run of report.runs) {
    lines.push(`## ${run.fixture}`)
    lines.push('')
    lines.push(`Sessions: ${run.sessionCount} · Notes: ${run.noteCount}`)
    if (run.bundle.durationMs > 0) {
      lines.push(`Bundle/minify (separate track): ${run.bundle.durationMs.toFixed(1)}ms${run.bundle.hung ? ' HUNG' : ''}`)
    }
    lines.push('')
    lines.push('| Interaction | n | avg ms | p50 | p95 | reloads | n+1 |')
    lines.push('|---|---:|---:|---:|---:|---:|---:|')
    for (const kind of INTERACTION_KINDS) {
      const samples = run.samples.filter((s) => s.kind === kind)
      if (samples.length === 0) continue
      lines.push(kindLine(kind, samples))
    }
    lines.push('')
  }

  if (report.violations.length > 0) {
    lines.push('## Budget violations')
    lines.push('')
    for (const violation of report.violations) {
      lines.push(`- ${violation.rule}: actual ${violation.actual} / budget ${violation.budget} — ${violation.message}`)
    }
    lines.push('')
  } else {
    lines.push('No budget violations.')
    lines.push('')
  }

  lines.push('Interaction budgets are isolated from bundle/minify hangs.')
  lines.push('')
  return lines.join('\n')
}
