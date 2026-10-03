import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { dismissSidebarGuidance, isSidebarGuidanceDismissed, type SidebarGuidanceStore } from '../sidebar-guidance'
import { KEYS, type StorageKey } from '../../../lib/local-storage'
const source = readFileSync(join(import.meta.dir, '../SidebarChrome.tsx'), 'utf8')
const ast = ts.createSourceFile('SidebarChrome.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const page = ast.statements.find(x => ts.isFunctionDeclaration(x) && x.name?.text === 'SidebarChrome') as ts.FunctionDeclaration
const declarations = page.body!.statements.filter(ts.isVariableStatement).flatMap(x => [...x.declarationList.declarations])
const selected = ['guidanceDismissed', 'visiblePromoKind', 'onDismissGuidance']
const body = selected.map(name => { const d = declarations.find(x => ts.isIdentifier(x.name) && x.name.text === name); if (!d?.initializer) return `const ${name}=${name === 'visiblePromoKind' ? 'promoKind' : name === 'guidanceDismissed' ? 'false' : 'undefined'};`; return `const ${name}=${d.initializer.getText(ast)};` }).join('\n')
const program = ts.transpileModule(body + '\nreturn { visiblePromoKind, onDismissGuidance };', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
function fixture() {
 const values = new Map<string, unknown>(); const writes: string[] = []; let focused = 0
 const key = (name: string, scope?: string) => `${name}:${scope}`
 const store: SidebarGuidanceStore = {
  get: <T>(name: StorageKey, fallback: T, scope?: string): T => (values.get(key(name, scope)) ?? fallback) as T,
  set: (name, value, scope) => { const target = key(name, scope); values.set(target, value); writes.push(target) },
 }
 const container = { isConnected: true, dataset: { guidanceWorkspace: 'a' }, closest: () => null, querySelector: () => ({ focus: () => { focused++ } }) }
 const render = (workspaceId: string | undefined, promoKind: 'onboarding' | 'reminder' | null) => {
  container.dataset.guidanceWorkspace = workspaceId || '_default'
  const args = { workspaceId, promoKind, React: { useCallback: (fn: unknown) => fn }, invalidateGuidance: () => {}, profileContainerRef: { current: container },
   dismissSidebarGuidance: (id?: string) => dismissSidebarGuidance(id, store), isSidebarGuidanceDismissed: (id?: string) => isSidebarGuidanceDismissed(id, store) }
  return new Function(...Object.keys(args), program)(...Object.values(args)) as { visiblePromoKind: 'onboarding' | 'reminder' | null; onDismissGuidance: () => void }
 }
 return { values, writes, render, focused: () => focused }
}
describe('actual sidebar guidance dismissal', () => {
 test('dismissal persists only its workspace onboarding preference and returns focus to profile', () => {
  const f = fixture(); const a = f.render('a', 'onboarding'); expect(a.visiblePromoKind).toBe('onboarding'); a.onDismissGuidance()
  expect(f.writes).toEqual([`${KEYS.sidebarDismissedGuidance}:a`]); expect(f.focused()).toBe(1)
  expect(f.render('a', 'onboarding').visiblePromoKind).toBe(null); expect(f.render('b', 'onboarding').visiblePromoKind).toBe('onboarding')
  expect(f.render('a', 'reminder').visiblePromoKind).toBe('reminder')
 })
 test('captured old-workspace dismissal cannot hide new workspace guidance or steal its focus', () => {
  const f = fixture(); const a = f.render('a', 'onboarding'); f.render('b', 'onboarding'); a.onDismissGuidance()
  expect(f.render('b', 'onboarding').visiblePromoKind).toBe('onboarding'); expect(f.render('a', 'onboarding').visiblePromoKind).toBe(null); expect(f.focused()).toBe(0)
 })
 test('unbound workspace uses the retained default scope; truthy non-boolean preference is not dismissal', () => {
  const f = fixture(); f.values.set(`${KEYS.sidebarDismissedGuidance}:a`, 'true')
  expect(f.render('a', 'onboarding').visiblePromoKind).toBe('onboarding')
  f.render(undefined, 'onboarding').onDismissGuidance(); expect(f.writes).toEqual([`${KEYS.sidebarDismissedGuidance}:_default`])
  expect(f.render(undefined, 'onboarding').visiblePromoKind).toBe(null)
 })
 test('current flat PromoSlot wires the actual dismissal only for onboarding; localized dismiss key already exists', () => {
  expect(source).toContain("onDismiss={visiblePromoKind === 'onboarding' ? onDismissGuidance : undefined}")
  const promo = readFileSync(join(import.meta.dir, '../PromoSlot.tsx'), 'utf8')
  expect(promo).toContain('onClick={onDismiss}'); expect(promo).toContain("t('common.dismiss')")
 })
})
