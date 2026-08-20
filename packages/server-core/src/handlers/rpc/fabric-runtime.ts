/**
 * Process-local Connection Fabric runtime (main / server only).
 */
import { join } from 'node:path'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import {
  ConnectionWorkGraph,
  CredentialRefRegistry,
  ImportService,
  InProcessCredentialBroker,
  JsonAccessGrantStore,
  LocalMemorySecretProvider,
  createOsDiscoveryHost,
  createP0Importers,
  InfisicalFabricProvider,
  createInfisicalImporter,
} from '@craft-agent/core/platform'

export interface FabricRuntime {
  readonly directory: string
  readonly graph: ConnectionWorkGraph
  readonly grants: JsonAccessGrantStore
  readonly provider: LocalMemorySecretProvider
  readonly importers: ReturnType<typeof createP0Importers>
  readonly importService: ImportService
  readonly broker: InProcessCredentialBroker
  readonly registry: CredentialRefRegistry
  readonly infisical: InfisicalFabricProvider
}

let cached: FabricRuntime | undefined

export function resetFabricRuntime(): void {
  cached = undefined
}

export function getFabricRuntime(): FabricRuntime {
  const directory = join(process.env.CRAFT_CONFIG_DIR || CONFIG_DIR, 'connection-fabric')
  if (cached?.directory === directory) return cached

  const graph = new ConnectionWorkGraph({ directory })
  const grants = new JsonAccessGrantStore({ directory })
  const registry = new CredentialRefRegistry({ directory })
  const provider = new LocalMemorySecretProvider()
  const host = createOsDiscoveryHost({
    homeDir: process.env.HOME,
    env: process.env,
    cwd: process.cwd(),
  })
  const p0Importers = createP0Importers(host, provider)
  const infisical = new InfisicalFabricProvider({
    token: process.env.INFISICAL_TOKEN,
    projectId: process.env.INFISICAL_PROJECT_ID,
    environment: process.env.INFISICAL_ENVIRONMENT,
    secretPath: process.env.INFISICAL_SECRET_PATH,
    baseUrl: process.env.INFISICAL_BASE_URL,
  })
  // LocalMemorySecretProvider remains the default P0 import target; Infisical is
  // registered so CF-8 is a Connection provider, not only a health probe.
  const importService = new ImportService({
    context: 'main',
    workspaceId: 'local',
    requestedBy: 'operator',
    registry,
    providers: { [provider.id]: provider, [infisical.id]: infisical },
    importers: {
      ...p0Importers,
      infisical: createInfisicalImporter(infisical),
    },
  })
  const broker = new InProcessCredentialBroker({
    grants,
    providers: { [provider.id]: provider, [infisical.id]: infisical },
    resolveRef: async (id) => registry.get(id),
  })

  cached = {
    directory,
    graph,
    grants,
    provider,
    importers: p0Importers,
    importService,
    broker,
    registry,
    infisical,
  }
  return cached
}
