# Cookbook library pins (fixtures)

These v1 fixtures are original ROX teaching stubs, not copies of vendor
notebooks. Each stub is written from scratch for this repo; no vendor notebook
source, prose, or code is vendored. T7 ingest expands the catalog to **at least
two items per vendor** and records, per item, the license that applies if the
stub is later replaced by a pinned upstream revision.

## Vendor sources and licenses

| Vendor | Canonical sources | License to respect on ingest |
| --- | --- | --- |
| OpenAI | https://github.com/openai/openai-cookbook | MIT |
| Anthropic | https://github.com/anthropics/courses | vendor terms / Apache-2.0 where marked |
| Pinecone | https://github.com/pinecone-io/examples | MIT |
| Weaviate | https://github.com/weaviate/recipes | BSD-3-Clause |
| Langfuse | https://github.com/langfuse/langfuse-docs | MIT |
| LangChain | https://github.com/langchain-ai/langchain | MIT |

## Items shipped

| id | vendor | kind | license basis |
| --- | --- | --- | --- |
| openai-embeddings-intro | openai | ipynb | original ROX stub |
| openai-function-calling | openai | ipynb | original ROX stub |
| openai-vision-gpu-docker | openai | ipynb | original ROX stub (`unsupported`) |
| anthropic-prompt-playbook | anthropic | md | original ROX stub |
| anthropic-tool-use | anthropic | ipynb | original ROX stub |
| pinecone-rag-quickstart | pinecone | ipynb | original ROX stub |
| pinecone-hybrid-search | pinecone | ipynb | original ROX stub |
| weaviate-rag-quickstart | weaviate | ipynb | original ROX stub |
| weaviate-multi-tenancy | weaviate | ipynb | original ROX stub |
| langfuse-observe-llm | langfuse | ipynb | original ROX stub |
| langfuse-evaluation | langfuse | ipynb | original ROX stub |
| langchain-rag-chain | langchain | ipynb | original ROX stub |
| langchain-agents | langchain | ipynb | original ROX stub |

## Tags

`catalog.json` declares a tag vocabulary under the top-level `tags` key; every
`item.tags` entry MUST come from it (`catalog.validate_catalog` enforces this).
Tags that matter for the Lab:

- `unsupported` — the v1 local Python kernel cannot run the item. Used by
  `openai-vision-gpu-docker`, a dummy that needs an NVIDIA GPU and a Docker
  image (upstream workflow: `docker run --gpus all ... python finetune.py`).
  The Lab surfaces such items but disables Run (A9: no non-Python kernel is
  offered; no Docker/GPU execution in v1).

## Revisions

`catalog.json` `revision` is `2026-10-13-fixtures`. A later ingest pass will
replace stubs with pinned vendor revisions and record their commit SHAs in the
table above.
