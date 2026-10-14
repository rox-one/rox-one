#!/usr/bin/env bun
/**
 * WP1 startup-closure report. Reads the per-chunk module report written by the renderer build when
 * ROX_BUNDLE_REPORT=<file> is set (vite.config.ts `rox-bundle-report`) and prints index.html's eager
 * closure: every chunk reachable through STATIC imports from the main.tsx dynamic entry plus the html
 * entry, its size, and the heaviest source modules/packages inside it.
 *
 * Usage:
 *   ROX_BUNDLE_REPORT=dist-report.json bun run electron:build:renderer
 *   bun scripts/bench/startup-closure-report.ts dist-report.json [--top 40] [--json out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'

interface ChunkReport {
  fileName: string
  isEntry: boolean
  isDynamicEntry: boolean
  imports: string[]
  dynamicImports: string[]
  modules: Record<string, number>
}

export function startupClosure(chunks: ChunkReport[]): ChunkReport[] {
  const byName = new Map(chunks.map(c => [c.fileName, c]))
  const roots = chunks.filter(c =>
    (c.isEntry && c.fileName.startsWith('assets/main-') && !Object.keys(c.modules).some(m => m.endsWith('/main.tsx')))
    || (c.isDynamicEntry && Object.keys(c.modules).some(m => m.endsWith('src/renderer/main.tsx'))))
  const seen = new Set<string>()
  const stack = roots.map(r => r.fileName)
  while (stack.length) {
    const f = stack.pop()!
    if (seen.has(f)) continue
    seen.add(f)
    stack.push(...(byName.get(f)?.imports ?? []))
  }
  return [...seen].map(f => byName.get(f)!).filter(Boolean)
}

export function packageOf(id: string): string {
  const nm = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(id)
  if (nm) return nm[1]
  const m = /^(packages\/[^/]+|apps\/electron\/src\/renderer\/(?:[^/]+\/){0,2})/.exec(id)
  return m ? m[1] : id
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const file = args.find(a => !a.startsWith('--')) ?? 'dist-report.json'
  const top = Number(args[args.indexOf('--top') + 1]) || 40
  const chunks = (JSON.parse(readFileSync(file, 'utf8')) as { chunks: ChunkReport[] }).chunks
  const closure = startupClosure(chunks)
  const mods = closure.flatMap(c => Object.entries(c.modules).map(([id, bytes]) => ({ id, bytes, chunk: c.fileName })))
  const total = mods.reduce((s, m) => s + m.bytes, 0)
  const pkgs = new Map<string, number>()
  for (const m of mods) pkgs.set(packageOf(m.id), (pkgs.get(packageOf(m.id)) ?? 0) + m.bytes)
  console.log(`startup closure: ${closure.length} chunks, ${mods.length} modules, ${total} rendered bytes (pre-minify)`)
  console.log('\nchunks:')
  for (const c of closure.map(c => ({ f: c.fileName, b: Object.values(c.modules).reduce((s, n) => s + n, 0) })).sort((a, b) => b.b - a.b)) console.log(`  ${String(c.b).padStart(9)}  ${c.f}`)
  console.log(`\ntop ${top} packages/dirs:`)
  for (const [p, b] of [...pkgs].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`  ${String(b).padStart(9)}  ${p}`)
  console.log(`\ntop ${top} modules:`)
  for (const m of mods.sort((a, b) => b.bytes - a.bytes).slice(0, top)) console.log(`  ${String(m.bytes).padStart(9)}  ${m.id}  [${m.chunk}]`)
  const jsonOut = args.indexOf('--json')
  if (jsonOut >= 0) writeFileSync(args[jsonOut + 1], JSON.stringify({ total, chunks: closure.map(c => c.fileName), packages: Object.fromEntries(pkgs) }, null, 1))
}
