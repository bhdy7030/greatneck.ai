from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # API keys (LiteLLM reads these from env automatically)
    anthropic_api_key: str = ""
    openai_api_key: str = ""

    # Paths
    knowledge_dir: Path = Path(__file__).parent.parent / "knowledge"
    chroma_dir: Path = Path(__file__).parent.parent / "knowledge" / "chroma_db"

    # CORS
    cors_origins: str = "http://localhost:3000"

    # Agent model config — LiteLLM requires provider/ prefix
    # Philosophy: planning uses the best model (hardest cognitive task),
    # well-defined execution uses mid-tier, complex tasks escalate to top-tier.
    model_router: str = "anthropic/claude-haiku-4-5-20251001"       # simple classification
    model_reasoning: str = "anthropic/claude-opus-4-20250514"       # complex specialist tasks
    model_specialist: str = "anthropic/claude-sonnet-4-20250514"    # well-defined specialist tasks (with plan)
    model_vision: str = "anthropic/claude-opus-4-20250514"          # image analysis
    model_simple: str = "anthropic/claude-haiku-4-5-20251001"       # community lookups
    model_planner: str = "anthropic/claude-opus-4-20250514"         # query decomposition (critical thinking)
    model_critic: str = "anthropic/claude-sonnet-4-20250514"        # response validation

    # Embedding model (used by ChromaDB)
    embedding_model: str = "default"  # ChromaDB's built-in

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
