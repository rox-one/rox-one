# Actual Windows restart failure and bounded diagnostics

GitHub Actions run `37148566925`, Windows job `111277447731`, tested desktop revision `26441ca2949c4fa8c01c44cee6b9734fe4c8dfd1` with actual Electron 39.2.7 and DPAPI. Write phase completed. Native readonly fsync returned EPERM; writable fsync succeeded. Read phase after a new Electron process failed at `account_read` with `ROX_SECURE_STORE_READ_FAILED`. Windows acceptance remains failed. The safe artifact is retained at `pocket-sso-windows-vault-repair-evidence/windows-native-26441ca-failed.json`, SHA256 `c11b5dceecdd5c915ba2f67842e430a31482977bb7031085a921f79f351ee119`.

The completed Windows job uploaded its diagnostic artifact. The remaining queued macOS job was cancelled by the lead after preserving that artifact; local actual Keychain restart proof already passed. No unrelated workflow was cancelled.

The next probe checks that encrypted bytes survived process restart before decrypting them. Store failures now carry only one bounded stage code (open, inspect, read, decrypt, parse); the original public error message is unchanged. Raw OS errors, file paths, ciphertext and tokens are discarded. A regression demonstrated that the previous implementation lacked stage metadata; the updated implementation passes 9 tests / 67 assertions across store, durable write and diagnostic modules. Electron project typecheck exits 0. Actual local Electron Keychain write/read/clear after this diagnostic change passes.

This change diagnoses the remaining Windows failure; it does not claim to repair or accept Windows restart yet. Native Windows rerun must identify the failed stage and then prove successful write/read/clear before release.
