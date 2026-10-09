# Personal Drive and quota (W1-14, #1511 · package DRV)

Contracts in `@rox/core/drive`, payloads in `@rox/shared/drive`, reference
handlers in `@rox/server-core/drive`. The quota numbers are D-v2-8 / ADR-U17.

## Quota accounting (D-v2-8)

- Every account gets a drive at creation (R5): `drive.provision` writes the
  `drive` row plus the «Мой диск» root folder, `quota_bytes` =
  `workspace.settings.default_drive_quota` → default **1 TiB =
  1 099 511 627 776 bytes**, shown as «1 ТБ» (`formatDriveSize(bytes, 'ru')`).
- **Charged:** every stored version, trash until purge, chat attachments (to the
  **uploader**), meeting recordings (to the **organiser**), agent artifacts (to
  the agent's **owner**). Shared files count only against their owner.
  `chargePrincipal(reason, context)` is the single place that rule lives.
- **Admission** is `used + reserved + size ≤ quota`; a rejection is
  `QUOTA_EXCEEDED {used, limit, needed, free}`.
- `trash` / `restore` are informational (`delta_bytes = 0`, the bytes move into
  `trash_bytes`); only `purge` debits. `drive.used_bytes` equals
  `Σ storage_ledger.delta_bytes` and is updated in the same transaction.
- Thresholds 80 / 90 / 100 % raise `drive.quota_threshold_crossed` at most once
  per 7 days; the storage meter turns amber at 80 % and red at 95 %.
- `over_quota` and `frozen` block new uploads, never reads or deletes.

## Upload protocol (§16.2)

1. `drive.open_upload {folderId?, fileName, sizeExpected, contentType?, sha256?}`
   — admission, then an `upload_session` row and the multipart plan
   (`planUploadParts`: parts stay 8–64 MB, at most 10 000 of them, a small file
   is a single part). The reservation is `size_expected`. A `sha256` whose blob
   is already stored makes it an **instant upload**: no bytes travel, the ledger
   is charged anyway.
2. The client PUTs three parts at a time and persists progress in
   `upload_session.parts`.
3. `drive.complete_upload {uploadSessionId, sha256, parts?}` — verifies the
   uploaded bytes: every part reports its `sizeBytes`, the server sums them and
   refuses the command (`VALIDATION`, «unverified upload») unless the sum equals
   `size_expected`; a known blob is attested by its stored size instead. Then
   `file_object` + `file_version`, one `storage_ledger` `upload` entry, releases
   the reservation and queues the preview.
4. `drive.abort_upload {uploadSessionId}` releases the reservation immediately;
   a session past its 24 h deadline is expired (and released) before the next
   admission of that drive.

## Storage

Bytes are content-addressed (`blobs/sha256/{aa}/{bb}/{sha256}`). Dedupe saves
backend space and never the charge. On the workspace authority the `drive` and
`upload_session` collections map to the W1-05 tables (`516-drive-quota.sql`);
`file_version`, `storage_ledger` and `file_preview` have composite / identity
keys and stay in the reference companion snapshot until DRV writes them with its
own SQL. `apps/workspace-service/src/modules/drive/reference-handlers.ts` holds
the S3 half (`CreateMultipartUpload`, presigning, abort) behind a port, and
refuses an over-quota upload before touching storage.