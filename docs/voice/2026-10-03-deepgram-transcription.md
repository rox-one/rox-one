# Deepgram transcription

The cloud transcription default is Deepgram's Nova-3 general prerecorded family, resolved deterministically without a catalog round-trip. Requests use `version=latest`, `diarize_model=latest`, `paragraphs=true`, `utterances=true`, punctuation and smart formatting. Automatic language detection remains the default; an explicit recognition language is forwarded when selected.

Requested model selection: `DEEPGRAM_MODEL` pins any explicit model; otherwise the pinned default is `nova-3`. The live model catalog is consulted only when no `DEEPGRAM_MODEL` pin is configured *and* `DEEPGRAM_ALLOW_MODEL_UPGRADE` is set to a truthy value (`1`/`true`/`yes`/`on`), in which case the newest released general batch Nova family is requested (streaming-only Flux, retired and medical-specific models are excluded). Production call sites therefore spread `deepgramTranscriptionOptions(process.env)` into the adapter, so the opt-in stays reachable; an explicit pin always suppresses the upgrade. An upgrade is never implicit; if the catalog is unavailable the request falls back to `nova-3`. The actual ASR architecture/revision and diarizer architecture are retained as provenance in the transcript (`model`, `modelRevision`, `diarizationModel`).

Official documentation read on 2026-10-03:

- [Model options](https://developers.deepgram.com/docs/model): Nova-3 is the current general prerecorded family; Flux targets conversational voice agents.
- [Model metadata](https://developers.deepgram.com/guides/fundamentals/model-metadata): `/v1/models` supplies canonical names and batch availability.
- [Version](https://developers.deepgram.com/docs/version): `version=latest` resolves the newest selected-family revision.
- [Diarization](https://developers.deepgram.com/docs/diarization): `diarize_model=latest` selects the latest batch diarizer (currently v2). Deprecated `diarize=true` pins v1; combining both parameters is rejected.
- [Paragraphs](https://developers.deepgram.com/docs/paragraphs): speaker changes influence paragraph divisions.
- [Language detection](https://developers.deepgram.com/docs/language-detection): automatic detection chooses the best available model for the detected language, with actual model identity returned in metadata.

Shared keys remain in backend-only service configuration. Cloud upload consent is separate from microphone permission and key availability. The composer provides first-use consent before capture; accepting clears the legacy privacy-migration gate. Saved consent and explicit local-engine preferences remain intact.

`voice:stop` returns the exact diarized transcript stored by the host. The composer consumes that result once, replacing its previous second `voice:transcribe` request for identical audio. New text is appended to the current draft, including paragraph breaks. Cancellation aborts requests and late results cannot change a subsequent capture. Meeting transcripts retain speaker labels, paragraph timestamps, corrected revisions and readable Markdown; a Deepgram recording does not require local ffmpeg/Whisper.

Synthetic verification:

- Shared voice and Electron meeting suites: 96 passed, zero failures, including adapter parameter/error/timeline checks, host cancellation and queue retry/provenance checks.
- Production composer DOM in Chromium: four passed, zero failures. These cover single-request consumption, current-draft preservation, consent before capture, decline and unmount fences.
- Shared and Electron source lint: zero errors. Shared typecheck passed; final integration typechecks cover the concurrent native/remote bridge changes separately.

No personal recording, microphone or secret was read by these tests. A real Deepgram transcription remains unverified while the execution environment rejects provider HTTP requests at its destination policy; synthetic provider responses do not establish key validity or live transcription success.
