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
  type SpeakAdapter,
  type SpeakInput,
  type SpeakResult,
  type TextTransmission,
  type AudioRetention,
  type LocalArchivePolicy,
  type ModelHealthStatus,
  type AudioDevice,
  type VoicePrefs,
  type VoiceHealth,
  type TranscribeInput,
  type TranscribeAdapter,
  type TranscribeResult,
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
  DEEPGRAM_MODEL_UPGRADE_ENV,
  resolveDeepgramModel,
  deepgramModelUpgradeEnabled,
  deepgramTranscriptionOptions,
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
export { RoxTranscriptionAdapter, RoxTranscriptionError, type TranscriptionRequest } from './adapters/rox-transcription.ts'
export { createEdgeSpeakAdapter, EdgeTtsError } from './adapters/edge-tts.ts'
export { normalizeVerboseJson, validateAudioLimits, AudioValidationError, type NormalizedTranscript } from './adapters/audio-result.ts'
export { VoiceHost, type VoiceHostEvent } from './host.ts'
export { createVoiceJob, applyJobEvent, advanceJob, type VoiceJob } from './job-machine.ts'
export { detectHotkeyCapabilities, canBindAccelerator, RIGHT_OPTION_PRESET, DEFAULT_TOGGLE_ACCELERATOR } from './hotkey-types.ts'
export { overlayShouldStealFocus, overlayVisible, overlayFromCapture, type OverlayState, type OverlayPhase } from './overlay-types.ts'
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
export * from './meeting-capture.ts';
export * from './meeting-stream.ts';
export * from './transcript-reducer.ts';
export { DeepgramTranscriptionAdapter, DEEPGRAM_TRANSCRIPTION_MODEL, DEEPGRAM_TRANSCRIPTION_NAME, normalizeDeepgramTranscript } from './adapters/deepgram-transcription.ts'
export {
  TALK_EVENT_TYPES,
  isTalkEventType,
  TalkEventSequencer,
  TalkSessionController,
  createTalkEventMergeState,
  mergeTalkEvent,
  type TalkEvent,
  type TalkEventType,
  type TalkEventDraft,
  type TalkEventScope,
  type TalkMode,
  type TalkTransport,
  type TalkBrain,
  type TalkEventMergeState,
} from './talk-events.ts'
export {
  REALTIME_SESSION_TRANSITIONS,
  REALTIME_AUDIO_QUEUE_MAX_CHUNKS,
  REALTIME_AUDIO_QUEUE_MAX_BYTES,
  REALTIME_AUDIO_QUEUE_TTL_MS,
  canTransitionRealtimeSession,
  createRealtimeVoiceAudioQueue,
  RealtimeVoiceSessionLifecycle,
  type RealtimeVoiceSessionState,
  type RealtimeVoiceAudioQueue,
  type RealtimeSessionSnapshot,
  type RealtimeSendResult,
  type RealtimeTimerScheduler,
  type RealtimeVoiceSessionLifecycleOptions,
} from './realtime-bridge.ts'
export type {
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCallbacks,
  RealtimeVoiceBridgeConfig,
  RealtimeVoiceRole,
} from './realtime-bridge-types.ts'
export {
  VoiceProviderError,
  createVoiceProviderRegistry,
  getRealtimeVoiceProvider,
  getSpeechProvider,
  listRealtimeVoiceProviders,
  listSpeechProviders,
  resolveConfiguredRealtimeVoiceProvider,
  resolveConfiguredSpeechProvider,
  type RealtimeBrowserSession,
  type RealtimeBrowserSessionRequest,
  type RealtimeVoiceProvider,
  type SpeechProvider,
  type SpeechSynthesisInput,
  type SpeechSynthesisResult,
  type SpeechSynthesisStreamResult,
  type VoiceProviderCapabilities,
  type VoiceProviderErrorCode,
  type VoiceProviderInfo,
  type VoiceProviderKind,
  type VoiceProviderRegistry,
  type VoiceProviderSource,
} from './provider-registry.ts'
export {
  createRealtimeTranscriptionSession,
  type RealtimeSocket,
  type RealtimeSocketHandlers,
  type RealtimeSocketOpener,
  type RealtimeTranscriptionEvent,
  type RealtimeTranscriptionEventKind,
  type RealtimeTranscriptionSession,
  type RealtimeTranscriptionSessionOptions,
} from './realtime-transcription.ts'
export {
  MAX_WAKE_TRIGGERS,
  MAX_WAKE_TRIGGER_UNITS,
  isVoiceWakeRouting,
  normalizeWakeTrigger,
  normalizeWakeList,
  defaultVoiceWakeList,
  toWakeChangedPayload,
  matchesWakeTrigger,
  type VoiceWakeList,
  type VoiceWakeChangedPayload,
  type VoiceWakeTrigger,
  type VoiceWakeRouting,
} from './wake-list.ts'
export { createOpenAiRealtimeVoiceProvider, createOpenAiRealtimeTranscriptionSession, createOpenAiSpeechProvider, openGlobalWebSocket, encodeAudioAppend, parseServerEvent, decodeOpenAiTranscriptionEvent, OPENAI_PROVIDER_ID, OPENAI_REALTIME_MODEL, OPENAI_TRANSCRIPTION_MODEL, OPENAI_CAPABILITIES, type OpenAiRealtimeOptions, type OpenAiProviderOptions } from './realtime-providers/openai.ts'
export { synthesizeSpeech, createEdgeSpeechProvider, speechResultFromSpeakResult, MAX_SPEECH_TEXT_BYTES } from './tts/synthesis.ts'
export { createTtsStream, iterateTtsChunks, sliceAudioChunks, DEFAULT_TTS_CHUNK_BYTES, type TtsStream, type TtsStreamChunk } from './tts/streaming.ts'
export { resolveTtsProviderId, TTS_PROVIDER_PRECEDENCE, type TtsProviderInputs } from './tts/resolution.ts'
export type { OpenAiRealtimeServerEvent } from './realtime-providers/openai.ts'
export {
  PODCAST_JOB_TRANSITIONS,
  MAX_PODCAST_ROLES,
  MIN_PODCAST_ROLES,
  PodcastPipelineError,
  createPodcastJob,
  applyPodcastJobEvent,
  advancePodcastJob,
  isPodcastRoleId,
  type PodcastJob,
  type PodcastJobState,
  type PodcastJobError,
  type PodcastErrorCode,
  type PodcastEngine,
  type PodcastEngineAvailability,
  type PodcastEnginesResult,
  type PodcastRoleId,
  type PodcastRoleGender,
  type PodcastRoleTemplate,
  type PodcastSourceInput,
  type PodcastStartInput,
  type PodcastStartResult,
  type PodcastCancelInput,
  type PodcastCancelResult,
  type PodcastEpisodesInput,
  type PodcastEpisode,
  type PodcastEpisodesResult,
  type PodcastEpisodeAudioInput,
  type PodcastEpisodeAudioChunk,
  type PodcastEpisodeAudioUrlInput,
  type PodcastEpisodeAudioUrlResult,
} from './podcast-job.ts'
