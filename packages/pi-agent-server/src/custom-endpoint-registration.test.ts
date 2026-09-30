import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import {
  buildCustomEndpointModelDef,
  type CustomEndpointApi,
  type CustomEndpointModelEntry,
  type CustomEndpointModelOverrides,
} from './custom-endpoint-models.ts'

type Registration = {
  api: CustomEndpointApi
  authHeader: boolean
  baseUrl: string
  models: ReturnType<typeof buildCustomEndpointModelDef>[]
}
type Registry = { registerProvider(id: string, config: Registration): void }
type Register = (registry: Registry, api: CustomEndpointApi, baseUrl: string, models: CustomEndpointModelEntry[]) => void

function actualRegistration(): Register {
  // index.ts owns the live RPC loop. Extract its actual private registration
  // callback so this test runs that code without opening a provider or loop.
  const path = join(import.meta.dir, 'index.ts')
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'registerCustomEndpointModels',
  )
  if (!declaration) throw new Error('Missing actual custom endpoint registration callback')
  const compiled = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  const bind = new Function(
    'customEndpointModelIds', 'customModelOverrides', 'initConfig',
    'resolveCustomEndpointApiKey', 'buildCustomEndpointModelDef', 'debugLog',
    `${compiled}\nreturn registerCustomEndpointModels`,
  )
  return bind(
    new Set<string>(), new Map<string, CustomEndpointModelOverrides>(),
    { customEndpoint: { supportsImages: true } },
    () => 'registration-test-fixture', buildCustomEndpointModelDef, () => {},
  ) as Register
}

describe('actual custom endpoint provider registration', () => {
  for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages'] as const) {
    test(`preserves main ${api} reasoning and model defaults`, () => {
      const calls: { id: string; config: Registration }[] = []
      actualRegistration()({ registerProvider: (id, config) => { calls.push({ id, config }) } }, api,
        'https://registration.invalid/v1', [{ id: 'model-1', name: 'Model One', contextWindow: 262_144, supportsImages: false }],
      )
      expect(calls).toHaveLength(1)
      const call = calls[0]
      if (!call) throw new Error('Provider was not registered')
      expect(call.id).toBe('custom-endpoint')
      expect(call.config.api).toBe(api)
      expect(call.config.authHeader).toBe(true)
      const model = call.config.models[0]
      if (!model) throw new Error('Registered model is missing')
      expect(model.name).toBe('Model One')
      expect(model.contextWindow).toBe(262_144)
      expect(model.input).toEqual(['text'])
      expect(model.reasoning).toBe(api === 'openai-responses')
      expect(model.thinkingLevelMap).toEqual(api === 'openai-responses' ? { off: null, xhigh: 'xhigh' } : undefined)
    })
  }
})
