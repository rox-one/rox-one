# OEM kernel extraResources

This directory holds the staged OEM kernel payload rsynced by
`apps/electron/scripts/stage-oem-kernel.sh` from
`$OEM_KERNEL_PAYLOAD_DIR/<plat>/` (knowledge-engine, `stage/`,
`appearance/`, and any other unpacked files).

Binaries and UI trees are gitignored. Only `.gitkeep` and this README are tracked.
Do not commit tarballs or unpacked kernel UI here.
