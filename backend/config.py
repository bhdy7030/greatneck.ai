from pydantic import model_validator
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

    @model_validator(mode="after")
    def _derive_chroma_dir(self):
        """Ensure chroma_dir follows knowledge_dir when KNOWLEDGE_DIR is set."""
        if "CHROMA_DIR" not in __import__("os").environ:
            self.chroma_dir = self.knowledge_dir / "chroma_db"
        return self

    # CORS
    cors_origins: str = "http://localhost:3000,http://localhost:8001,https://greatneck.ai,https://askmura-frontend-461310212965.us-east1.run.app,capacitor://localhost,http://localhost"

    # Agent model config — LiteLLM requires provider/ prefix
    # Philosophy: planning uses the best model (hardest cognitive task),
    # well-defined execution uses mid-tier, complex tasks escalate to top-tier.
    # Temporarily using Gemini while Anthropic API is overloaded (2026-03-04)
    # Original Anthropic models:
    #   router/simple: claude-haiku-4-5, specialist/critic: claude-sonnet-4, reasoning/vision/planner: claude-opus-4
    model_router: str = "gemini/gemini-2.5-flash-lite"               # simple classification (fastest)
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

    # Apple Sign In
    apple_client_id: str = ""       # Services ID, e.g. com.greatneck.web.auth
    apple_team_id: str = ""
    apple_key_id: str = ""
    apple_private_key: str = ""     # Contents of .p8 file (use \n for newlines in env vars)
    apple_redirect_uri: str = "http://localhost:8001/api/auth/apple/callback"

    # JWT
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 1

    # Frontend URL (for OAuth redirect)
    frontend_url: str = "http://localhost:3000"

    # Admin emails (comma-separated) — auto-grant is_admin on login
    admin_emails: str = ""

    # Pro emails (comma-separated) — auto-grant pro tier on login
    pro_emails: str = ""

    # Tier limits
    anon_initial_queries: int = 10
    anon_extended_queries: int = 10
    free_promo_days: int = 14
    free_web_search: bool = True
    free_fast_mode_only: bool = False

    # Database (empty = SQLite fallback, set = PostgreSQL)
    database_url: str = ""

    # Redis (any provider — Upstash, GCP Memorystore, local Docker, etc.)
    redis_url: str = ""  # e.g. redis://localhost:6379 or rediss://default:token@host:6379
    redis_prefix: str = ""  # e.g. "dev:" or "prod:" — isolates environments sharing one Redis

    # Invite system
    invite_required: bool = True          # env INVITE_REQUIRED=false to disable
    invite_limit_per_user: int = 5        # max invites per non-admin

    # Events
    eventbrite_api_key: str = ""
    cron_secret: str = ""

    model_config = {"env_file": ["../.env", ".env"], "env_file_encoding": "utf-8"}


settings = Settings()
