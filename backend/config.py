from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # API keys (LiteLLM reads these from env automatically)
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    gemini_api_key: str = ""
    tavily_api_key: str = ""

    # Paths
    knowledge_dir: Path = Path(__file__).parent.parent / "knowledge"
    chroma_dir: Path = Path(__file__).parent.parent / "knowledge" / "chroma_db"

    # CORS
    cors_origins: str = "http://localhost:3000,http://localhost:8001"

    # Agent model config — LiteLLM requires provider/ prefix
    # Philosophy: planning uses the best model (hardest cognitive task),
    # well-defined execution uses mid-tier, complex tasks escalate to top-tier.
    # Temporarily using Gemini while Anthropic API is overloaded (2026-03-04)
    # Original Anthropic models:
    #   router/simple: claude-haiku-4-5, specialist/critic: claude-sonnet-4, reasoning/vision/planner: claude-opus-4
    model_router: str = "gemini/gemini-3-flash-preview"             # simple classification
    model_reasoning: str = "gemini/gemini-3.1-pro-preview"     # complex specialist tasks
    model_specialist: str = "gemini/gemini-3.1-pro-preview"        # well-defined specialist tasks (with plan)
    model_vision: str = "gemini/gemini-3.1-pro-preview"            # image analysis
    model_simple: str = "gemini/gemini-3-flash-preview"             # community lookups
    model_planner: str = "gemini/gemini-3.1-pro-preview"           # query decomposition (critical thinking)
    model_critic: str = "gemini/gemini-3-flash-preview"            # response validation

    # Embedding model (used by ChromaDB)
    embedding_model: str = "default"  # ChromaDB's built-in

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8001/api/auth/google/callback"

    # JWT
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 72

    # Frontend URL (for OAuth redirect)
    frontend_url: str = "http://localhost:3000"

    # Admin emails (comma-separated) — auto-grant is_admin on login
    admin_emails: str = ""

    # Events
    eventbrite_api_key: str = ""
    cron_secret: str = ""

    model_config = {"env_file": ["../.env", ".env"], "env_file_encoding": "utf-8"}


settings = Settings()
