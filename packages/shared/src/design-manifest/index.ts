export {
  compileDesignManifest,
  DesignManifestValidationError,
  serializeDesignManifest,
  tryCompileDesignManifest,
  type DesignManifestCompileOptions,
} from './compiler.ts'
export {
  COMPONENT_ID_RE,
  DESIGN_MANIFEST_LIMITS,
  DESIGN_MANIFEST_VERSION,
  DesignManifestSchema,
  DesignModuleSchema,
  GridLayoutSchema,
  isJsonProps,
  JsonPropsSchema,
  type DesignManifest,
  type DesignManifestInput,
  type DesignModule,
  type GridLayout,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
} from './schema.ts'
