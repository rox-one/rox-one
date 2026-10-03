# Windows installer and native store receipt

Source: `aa80de1b44d12a3fbbf425ce5aca8709617972ca`. GitHub Actions [Desktop Release Build37150994181](https://github.com/rox-one/rox-one/actions/runs/37150994181); actual [Windows job111284688368](https://github.com/rox-one/rox-one/actions/runs/37150994181/job/111284688368) completed successfully.

Pinned install, desktop build/package, real Electron39.2.7 DPAPI write/quit/read/clear and artifact upload passed. The native receipt confirms OS encryption availability, isolated profile, writable flush, stable wrapped key across process restart and recovered identity/account/logout/binding. It matches the independently downloaded native artifact exactly.

Downloaded `Rox-x64.exe` is283584315 bytes, SHA256 `cb36982e13c9caaaa92cc0ecf19864e8b0da02ec2ec0962c9cf73217f3f3b3eb`. Local bytes match the uploaded release manifest. Actions artifact11284286811 is `desktop-win32-x64`, ZIP size283643284, remote digest `sha256:6fb802dd8aaaf9e8619cee4bd98063813f27afdd163c20d6435c074f55cb9ebf`. The ZIP digest is the Actions server readback; the installer hash was computed from downloaded bytes. Separate native artifact11284471220 has digest `sha256:d73e1393e5234a462f100b1a530bf47216c5f4757debbc765a28b00ea7de45f5`.

This is an **unsigned candidate**, version0.11.8, not a published release. No actual installed GUI first launch, Pocket signup, cabinet sync or real provider charge is accepted from this package job. Mac package and validation jobs remain queued. A pre-existing `darwin.json` is included in the combined artifact; it is not evidence that a Mac job ran. Local actual Keychain restart has its own separate receipt.

Machine receipts are in `pocket-sso-windows-installer-evidence/`: native proof, artifact metadata, local installer hash/size, release manifest and update metadata. Installer binaries are outside Git. Desktop code/CI files have no differences from `aa80de1b` at this receipt; subsequent branch commits contain reports only.
