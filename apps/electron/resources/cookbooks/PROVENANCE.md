# Vendored snapshot — Cookbooks Lab sidecar

This directory is a **read-only vendored snapshot** of the external Cookbooks
laboratory. Nothing here is edited in this repository; changes flow only through
the laboratory's own repository and a re-run of the sync command below.

## Source

| Field | Value |
|---|---|
| Source tree | `/Users/t/Projects/2026-10-13-rox-cookbooks-notebooks` |
| Upstream repo | `rox-one/rox-cookbooks-notebooks` |
| Snapshot date | 2026-10-14 |
| Source revision | source tree carries no `.git` (working copy, revision not recorded upstream here) |
| Interpreter used to validate | `/usr/bin/python3` 3.9.6 (lab runs on ≥ 3.9; cell execution needs ≥ 3.11 — an internal honest lab error, not a resolver gate) |

## Sync command

```sh
SRC=/Users/t/Projects/2026-10-13-rox-cookbooks-notebooks
DST=apps/electron/resources/cookbooks
mkdir -p "$DST/src" "$DST/scripts" "$DST/resources"
rsync -a --exclude '__pycache__' "$SRC/src/rox_cookbooks/" "$DST/src/rox_cookbooks/"
rsync -a "$SRC/resources/cookbooks/" "$DST/resources/cookbooks/"
cp "$SRC/scripts/serve_lab.py" "$DST/scripts/serve_lab.py"
cp "$SRC/scripts/electron_handshake_probe.py" "$DST/scripts/electron_handshake_probe.py"
cp "$SRC/docs/electron-integration.md" "$DST/ELECTRON-CONTRACT.md"
```

The **relative layout is load-bearing** and must not be flattened:

- `scripts/serve_lab.py` resolves `ROOT = parents[1]` → this directory, then
  inserts `ROOT/src` on `sys.path`, so the package must stay at
  `src/rox_cookbooks/`.
- `src/rox_cookbooks/catalog.py` resolves its resource root as
  `parents[2]/resources/cookbooks` → `resources/cookbooks/`, so the 13 catalog
  items must stay under `resources/cookbooks/`.

Verified by `python3 scripts/electron_handshake_probe.py` → `[SUMMARY] 0 failed`
(12/12 checks, 13 catalog items).

## sha256 manifest

```
cdcbd01dfe7f60a14f6995db7bba291289e9241e697bdc89f244a3946b80a6ad  ELECTRON-CONTRACT.md
4e9030a4e3c305131fadc672bd100d56de57d54a81c9159c4f96f347180b8f77  resources/cookbooks/catalog.json
8f0579ea5450ee9edc4d2efbba5ddc8a8ba2842be70f009068b7821e3a2acedc  resources/cookbooks/LICENSE-NOTES.md
a4d1b9e08cbcb35a7b89e2b0612a674370303aa4a2c38f24c8474e10d2f9e91b  resources/cookbooks/vendors/anthropic/prompt-playbook.md
18b3f900c1bcdb1a50f1523517395ee073638dff0bd214e8e902878d61801d8e  resources/cookbooks/vendors/anthropic/tool-use.ipynb
1ba7bc7aa2a1916bc40cce3d7fb6386497b018888e4e2a29fe5503107f952500  resources/cookbooks/vendors/langchain/agents.ipynb
d43dca90e35f632b5c0db6bfd742ed36473904f1401e8263d2e2598258abebad  resources/cookbooks/vendors/langchain/rag-chain.ipynb
d2dd8ea0ed9be0cd6206d29ae968f383cfb63627e745c2226e9ecf62baddd297  resources/cookbooks/vendors/langfuse/evaluation.ipynb
b609b5d57a7a0135c5a97d287fe340ab9b0e6945463e2eacfd34a6090d5112db  resources/cookbooks/vendors/langfuse/observe-llm.ipynb
4829d65967f739419b32780989b7fbfc968cf11f6657de3c61496dc70c400c16  resources/cookbooks/vendors/openai/embeddings-intro.ipynb
7add081b9350f9f1428d098260580e55ef088387ec9aeb58b016f10850919c5a  resources/cookbooks/vendors/openai/function-calling.ipynb
c28dcadffa736a2d1f0dea820a921648af3f663a5035e64cfe6af56f0daf116a  resources/cookbooks/vendors/openai/vision-gpu-docker.ipynb
f1243478f9cc28e70ceaab7e40abc0563142cad2a9a78e0b035358a462663fd0  resources/cookbooks/vendors/pinecone/hybrid-search.ipynb
3bbb9328cd7e2026077f90db825311337a83e12c9e4a7d6795d2d4bab1d43a70  resources/cookbooks/vendors/pinecone/rag-quickstart.ipynb
1e5b8a8f3cac4b4767899af523196ef855e4081ae9096a1f3aefcde60e76e1dd  resources/cookbooks/vendors/weaviate/multi-tenancy.ipynb
04f1cc65f261d3a0148941b64dd594ef92dd4abae4b59de15332fbca1d831850  resources/cookbooks/vendors/weaviate/rag-quickstart.ipynb
616093dc9df1a297dd9b7ffb4ebcc9ed7559ef511ee73b82e879c71b883b52bd  scripts/electron_handshake_probe.py
41a79e7433527247f1e8e948b3b165e8f3e50e6eda89a1f0ed608ad476faee43  scripts/serve_lab.py
9f58bf940b97e65837dfe7afc8febdba0947f96d7e18d668c701b0d33a63de5c  src/rox_cookbooks/catalog.py
3655d558b34a592a558f60d65a6baabdedf3ef873418a9f920131bea2160faa1  src/rox_cookbooks/copies.py
f9289557ef4a418192c811dd9f8080dba223b042762b2c24a1a52b5d5ae1c922  src/rox_cookbooks/host.py
43a95ac989a74c04065c2532dcb2bea458a1286897ebfd4b5dd72aed49b6e251  src/rox_cookbooks/__init__.py
1d4178650597339f47ec120d0c9b87d5d7467b4dbd01555a97497a010caac0ac  src/rox_cookbooks/kernel.py
cbc3b59c57e9006a6ccc9e93d456322da3098c998187c9a4d0aa12f69a232581  src/rox_cookbooks/__main__.py
eaba767d1f30e36aa3e1427799c4001c795744aca2e5f7f985f06e1069614d92  src/rox_cookbooks/notebooks.py
77a378b23f58d67a0d02792114364a98ed8cdcd3f24d164e3cd5fe54c43526ae  src/rox_cookbooks/search.py
9bf567a606f7ddd56088eed653276791be5b21fe962f683686a49d55ad635e95  src/rox_cookbooks/secrets.py
48f9d939d16be7eafcf3833253d87d167238b3e1a6ffeb13a5fa079e3c9acc47  src/rox_cookbooks/static/lab-gaseta.html
4a4d0b015ebe4498c6eea4c5dbc3d992408f37e4c6b1f25d3128f035912992ce  src/rox_cookbooks/static/lab.html
6482f198091df337aa345b5b6dd991537ce3838c7f9a019b0e2cf49a28c8563a  src/rox_cookbooks/static/lab-premium.html
4a4d0b015ebe4498c6eea4c5dbc3d992408f37e4c6b1f25d3128f035912992ce  src/rox_cookbooks/static/lab-pult.html
d720803b3ad37b1f4eea137fc3fd1eb11da859937103a073e1ffe4e66df3f616  src/rox_cookbooks/static/lab-v5.html
69507583cbf93269291578771a809942d38bc2f3f86c312b66bf070bd306f557  src/rox_cookbooks/ui.py
```

Regenerate with:

```sh
cd apps/electron/resources/cookbooks && find . -type f ! -name PROVENANCE.md | sort \
  | while read -r f; do printf '%s  %s\n' "$(shasum -a 256 "$f" | awk '{print $1}')" "${f#./}"; done
```
