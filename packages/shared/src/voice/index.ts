export {
  VOICE_PREFS_VERSION,
  DEFAULT_WAKE_PHRASE,
  STT_ENGINES,
  TTS_ENGINES,
  AUDIO_RETENTION_POLICIES,
  LOCAL_ARCHIVE_POLICIES,
  getDefaultVoicePrefs,
  isSttEngine,
  isTtsEngine,
  isAudioRetention,
  isLocalArchivePolicy,
  isModelHealthStatus,
  type SttEngine,
  type TtsEngine,
  type AudioRetention,
  type LocalArchivePolicy,
  type ModelHealthStatus,
  type AudioDevice,
  type VoicePrefs,
  type VoiceHealth,
  type TranscribeInput,
  type TranscribeResult,
  type SpeakInput,
  type SpeakResult,
  type TranscribeAdapter,
  type SpeakAdapter,
  type EnhancementMode,
  type HotkeyMode,
  type OverlayPosition,
} from './types.ts'

export {
  usesCloudStt,
  shouldUploadAudio,
  resolveAudioRetention,
  canStartWakeListening,
  withWakeWordConsent,
  describeLocalSttBackend,
  buildVoiceHealth,
  isVoiceActive,
  type WakeListenDecision,
} from './policy.ts'

export {
  VoicePrivacyError,
  transcribeWithPolicy,
  speakWithPolicy,
  assertEditableTranscript,
} from './transcribe.ts'

export {
  VOICE_PREFS_FILE,
  getVoicePrefsPath,
  normalizeVoicePrefs,
  loadVoicePrefs,
  saveVoicePrefs,
} from './storage.ts'

export {
  VOICE_GATEWAY_BASE_URL,
  VOICE_PUBLIC_CLIENT_ID,
  ROCKS_T1_MODEL_ID,
  ROCKS_T1_DISPLAY_NAME,
  ROCKS_T1_UPSTREAM_MODEL,
  SPARK_PROCESS_ALIAS,
  COMPOUND_FALLBACK_MODEL,
  VOICE_ENDPOINTS,
  voiceUrl,
} from './contracts.ts'

export {
  LAST_KNOWN_GOOD_CAPABILITIES,
  languageBadgeCount,
  parseCapabilities,
  shouldShow74LanguageBadge,
  rocksT1RouteNote,
  type VoiceCapabilities,
} from './capabilities.ts'

export { VoiceIdentityClient, memoryIdentityStore, VoiceIdentityError } from './identity.ts'
export { RoxTranscriptionAdapter, RoxTranscriptionError } from './adapters/rox-transcription.ts'
export { normalizeVerboseJson, validateAudioLimits, AudioValidationError, type NormalizedTranscript } from './adapters/audio-result.ts'
export { VoiceHost, type VoiceHostEvent } from './host.ts'
export { createVoiceJob, applyJobEvent, advanceJob, type VoiceJob } from './job-machine.ts'
export { detectHotkeyCapabilities, canBindAccelerator, RIGHT_OPTION_PRESET, DEFAULT_TOGGLE_ACCELERATOR } from './hotkey-types.ts'
export { overlayShouldStealFocus, overlayVisible, overlayFromCapture, type OverlayState } from './overlay-types.ts'
export { loadHistoryIndex, saveHistoryIndex, setFavorite, deleteRecording, exportRecording, historyPage } from './history-store.ts'
export { compilePrompt, PROCESSOR_SYSTEM_CONTRACT } from './processing/compiler.ts'
export { IMPROVE_MODULES, canonicalizeModules } from './processing/profiles.ts'
export { runProcessing } from './processing/run.ts'
export { resolveLanguages } from './processing/language-policy.ts'
export { runEnrichment } from './enrichment/run.ts'
export { buildQueryPlan, redactSecrets } from './enrichment/query-plan.ts'
export { isBlockedUrl } from './enrichment/source-policy.ts'
export { catalogTemplate } from './models/catalog.ts'
export { validateManifestShape, LOCAL_MODEL_FAMILIES } from './models/manifest-schema.ts'
export { writeAtomicFile, verifySha256, safeJoin } from './models/download.ts'
export { WhisperLargeV3TurboAdapter } from './local/whisper-adapter.ts'
export { NemotronStreamingAdapter } from './local/nemotron-adapter.ts'
export { GigaamE2eRnntAdapter } from './local/gigaam-adapter.ts'
export { LocalModelError } from './local/adapter.ts'
export {
  classifyEvidence,
  collectEvidenceInput,
  probeVoiceGateway,
  reportEvidence,
  type EvidenceClass,
  type EvidenceInput,
  type EvidenceReport,
  type GatewayProbe,
} from './acceptance.ts'
export {
  createConfiguredLocalTranscribeAdapter,
  createLocalAsrAdapter,
  createProductionLocalTranscribeAdapter,
  createProductionVoiceHttp,
  hasVoiceCredentials,
  isFixtureOnlyEvidence,
  localAdapterManifest,
  localWeightsFixtureEnabled,
  resolveLocalAsrFamily,
  resolveVoiceGatewayMode,
  voiceGatewayBaseUrl,
  VoiceGatewayUnavailableError,
  type VoiceGatewayMode,
} from './runtime.ts'
export { voiceFlagEnabled, voiceV2Enabled } from './flags.ts'
