# Native overlay recording custody recovery

Source: late A7 `eeddeb5bd0af59b93fd121c10b8a7a52956ff0b7`; implementation and current-main qualification are named in verification.json.

The private native overlay passes its verified recording ID through the current managed-client router and protocol to the composer that owns that recording. Tagged stop/cancel never starts an idle composer, affects a foreign recording or controls a retired capture. Commands that precede START acknowledgement stay with the pending capture; cancel wins. Existing consent, generation fences, current draft whitespace, PTT, bounded audio frames and teaching attempt ownership remain.

A real two-composer baseline reproduces the second-microphone error; the recovered owner/router/renderer path passes eleven isolated browser cases. Thirty-two actual production Voice DOM cases, native command/owner/voice tests, current authenticated WS/protocol controls, full Electron types and main/all three preload builds pass. Exact source and log hashes, original failures and bounded acceptance are retained in verification.json and compressed logs. Controlled ports do not establish OS microphone/clipboard or hosted scanner acceptance.
