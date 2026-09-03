import { gatedFailures } from './evaluate'
import type { BenchmarkReport } from './types'

export function formatPerfReport(report: BenchmarkReport): string {
  const lines: string[] = [
    '# Rox renderer performance report',
    '',
    `Generated: ${report.generatedAt}`,
    `Sessions: ${report.fixture.sessionCount}`,
    `Vault notes: ${report.fixture.vaultNoteCount}`,
    `Long tasks recorded: ${report.longTasks}`,
    `React commits recorded: ${report.reactCommits}`,
    `Payload samples: ${report.payloadSamples}`,
    `Bundle/minify profile (separate clock): ${report.bundleProfileMs === null ? 'skipped' : `${report.bundleProfileMs.toFixed(2)}ms`}`,
    '',
    '| Mark | n | p50 | p95 | budget | gate | result |',
    '|---|---:|---:|---:|---:|---|---|',
  ]

  for (const verdict of report.verdicts) {
    const stats = report.stats[verdict.name]
    lines.push(
      `| ${verdict.name} | ${stats?.count ?? 0} | ${(stats?.p50Ms ?? 0).toFixed(2)}ms | ${verdict.p95Ms.toFixed(2)}ms | ${verdict.budgetMs}ms | ${verdict.gated ? 'CI' : 'info'} | ${verdict.passed ? 'pass' : 'FAIL'} |`,
    )
  }

  lines.push('', '## IPC totals', '')
  for (const [channel, count] of Object.entries(report.ipcTotals).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${channel}: ${count}`)
  }

  const failures = gatedFailures(report.verdicts)
  lines.push('', '## CI gates', '')
  if (failures.length === 0) {
    lines.push('All declared CI budgets passed.')
  } else {
    for (const failure of failures) {
      lines.push(`- FAIL ${failure.name}: ${failure.reasons.join('; ')}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}
