# Vendored snapshot — Cookbooks Lab sidecar

This directory is a **read-only vendored snapshot** of the external Cookbooks
laboratory. Nothing here is edited in this repository; changes flow only through
the laboratory's own repository and a re-run of the sync command below.

## Source

| Field | Value |
|---|---|
| Source tree | `/Users/t/Projects/2026-10-13-rox-cookbooks-notebooks` |
| Upstream repo | `rox-one/rox-cookbooks-notebooks` |
| Snapshot date | 2026-10-15 |
| Source revision | **none available.** The upstream laboratory is a plain working copy: it carries **no VCS metadata** (no `.git`, no tag, no archive), so there is no commit SHA to pin. Integrity is therefore asserted by the **sha256 manifest** at the bottom of this file (regenerate + diff), not by a revision. |
| Interpreter used to validate | `/usr/bin/python3` 3.9.6 (lab runs on ≥ 3.9; cell execution needs ≥ 3.11 — an internal honest lab error, not a resolver gate) |

Because no revision exists to diff against, **the manifest is the snapshot's only
integrity record**: any drift in a vendored file — hand edit or re-sync — shows up
as a manifest diff and must be re-recorded deliberately. Re-verify by regenerating
the manifest and comparing it byte-for-byte with the block at the bottom of this
file (identical output = intact):

```sh
cd apps/electron/resources/cookbooks
find . -type f ! -name PROVENANCE.md | sort \
  | while read -r f; do printf '%s  %s\n' "$(shasum -a 256 "$f" | awk '{print $1}')" "${f#./}"; done
```

## Sync command

```sh
SRC=/Users/t/Projects/2026-10-13-rox-cookbooks-notebooks
DST=apps/electron/resources/cookbooks
mkdir -p "$DST/src" "$DST/scripts" "$DST/resources"
# `static/lab-*.html` are dormant alternate surfaces the sidecar never serves:
# `src/rox_cookbooks/host.py:26` renders `static/lab.html` ONLY. They are pruned
# here (4 files, 154,300 bytes ≈ 151 KiB of dead bundle weight) so a re-sync
# cannot reintroduce them.
rsync -a --exclude '__pycache__' --exclude 'lab-*.html' "$SRC/src/rox_cookbooks/" "$DST/src/rox_cookbooks/"
rsync -a "$SRC/resources/cookbooks/" "$DST/resources/cookbooks/"
cp "$SRC/scripts/serve_lab.py" "$DST/scripts/serve_lab.py"
cp "$SRC/scripts/electron_handshake_probe.py" "$DST/scripts/electron_handshake_probe.py"
cp "$SRC/docs/electron-integration.md" "$DST/ELECTRON-CONTRACT.md"
```

The snapshot is then exactly the file list in the manifest below — after a re-sync,
regenerate the manifest and re-record it (there is no upstream revision to diff).

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
8cd793bdbf4064de33248169b9319d263a70d19f2d7952c831a33594ebe14860  ELECTRON-CONTRACT.md
67e6251a631dd9cbb383317a994f47b9d67c78ac09424b86982be40c4795b63e  resources/cookbooks/catalog.json
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
765a094908deb976318972eb7d7f85997f147825b5150e3e64329ddc073ce3e6  src/rox_cookbooks/catalog.py
3655d558b34a592a558f60d65a6baabdedf3ef873418a9f920131bea2160faa1  src/rox_cookbooks/copies.py
d6cf92ba8b6fc75ab3dee6407ddf4dcc484aecf0aa5cbe4dbc0499e37ef30ba9  src/rox_cookbooks/host.py
43a95ac989a74c04065c2532dcb2bea458a1286897ebfd4b5dd72aed49b6e251  src/rox_cookbooks/__init__.py
2f2b4ebab19871d58b3b47a408b714b4f17e89f06daf0a27166b40bdfef382f7  src/rox_cookbooks/kernel.py
cbc3b59c57e9006a6ccc9e93d456322da3098c998187c9a4d0aa12f69a232581  src/rox_cookbooks/__main__.py
7a6adaf00321cd2c21824df8fddd40735b95dcde511379d32d4bf75622710256  src/rox_cookbooks/notebooks.py
77a378b23f58d67a0d02792114364a98ed8cdcd3f24d164e3cd5fe54c43526ae  src/rox_cookbooks/search.py
c9daa2548fa96ec1c15d5f84c5f16a75ab2e7c97937c70fe90acfbb7375be55b  src/rox_cookbooks/secrets.py
4a4d0b015ebe4498c6eea4c5dbc3d992408f37e4c6b1f25d3128f035912992ce  src/rox_cookbooks/static/lab.html
13381e7f31b5cc87eb302a75be24077d2fbcae5a46ece84f1cb7bafaab5457e0  src/rox_cookbooks/ui.py
```

Regenerate with:

```sh
cd apps/electron/resources/cookbooks && find . -type f ! -name PROVENANCE.md | sort \
  | while read -r f; do printf '%s  %s\n' "$(shasum -a 256 "$f" | awk '{print $1}')" "${f#./}"; done
```
