"""Environment -> cognee configuration. Secrets are read from env and never logged."""
from __future__ import annotations

import os
from dataclasses import dataclass, field

DEFAULT_ENDPOINT = "https://api.rox.one/v1"
DEFAULT_MODEL = "rox/r1-max"  # Rox R1 Max on the api.rox.one gateway
DEFAULT_FALLBACK_MODEL = "rox/fast"  # gateway cheap tier (DeepSeek V4.1 Flash class); override via env
DEFAULT_EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
DEFAULT_EMBEDDING_DIMS = 384


@dataclass(frozen=True)
class SidecarConfig:
    root: str
    llm_endpoint: str = DEFAULT_ENDPOINT
    llm_model: str = DEFAULT_MODEL
    llm_fallback_model: str = DEFAULT_FALLBACK_MODEL
    llm_api_key: str = field(default="", repr=False)
    embedding_model: str = DEFAULT_EMBEDDING_MODEL
    embedding_dims: int = DEFAULT_EMBEDDING_DIMS

    @staticmethod
    def from_env(env: "os._Environ[str] | dict[str, str]" = os.environ) -> "SidecarConfig":
        root = env.get("ROX_COGNEE_ROOT", "").strip()
        if not root:
            raise ValueError("ROX_COGNEE_ROOT is required")
        return SidecarConfig(
            root=os.path.abspath(os.path.expanduser(root)),
            llm_endpoint=env.get("ROX_COGNEE_LLM_ENDPOINT") or DEFAULT_ENDPOINT,
            llm_model=env.get("ROX_COGNEE_LLM_MODEL") or DEFAULT_MODEL,
            llm_fallback_model=env.get("ROX_COGNEE_LLM_FALLBACK_MODEL") or DEFAULT_FALLBACK_MODEL,
            llm_api_key=env.get("ROX_COGNEE_LLM_API_KEY", ""),
            embedding_model=env.get("ROX_COGNEE_EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL,
            embedding_dims=int(env.get("ROX_COGNEE_EMBEDDING_DIMS") or DEFAULT_EMBEDDING_DIMS),
        )

    def cognee_env(self) -> dict[str, str]:
        """Process env cognee reads at import time (set BEFORE importing cognee)."""
        return {
            "SYSTEM_ROOT_DIRECTORY": os.path.join(self.root, "system"),
            "DATA_ROOT_DIRECTORY": os.path.join(self.root, "data"),
            "LLM_PROVIDER": "custom",
            "LLM_ENDPOINT": self.llm_endpoint,
            "LLM_MODEL": f"openai/{self.llm_model}",
            "LLM_API_KEY": self.llm_api_key,
            "EMBEDDING_PROVIDER": "fastembed",
            "EMBEDDING_MODEL": self.embedding_model,
            "EMBEDDING_DIMENSIONS": str(self.embedding_dims),
            # Local, single-user, no telemetry, no access-control multi-tenancy.
            "TELEMETRY_DISABLED": "1",
            "ENV": "prod",
            "ENABLE_BACKEND_ACCESS_CONTROL": "false",
            "HF_HUB_DISABLE_TELEMETRY": "1",
        }
