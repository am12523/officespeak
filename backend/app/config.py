"""Central configuration, read from environment variables."""
import os

# --- LLM provider selection -------------------------------------------------
# "gemini" (default — Google AI Studio keys have a genuinely free tier)
# or "anthropic".
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini").lower()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
ANTHROPIC_VERSION = "2023-06-01"

MAX_TOKENS = int(os.getenv("MAX_TOKENS", "2048"))

ACTIVE_MODEL = GEMINI_MODEL if LLM_PROVIDER == "gemini" else ANTHROPIC_MODEL

# --- Database ---------------------------------------------------------------
# SQLite by default so the project runs with zero setup;
# point DATABASE_URL at Postgres in production (docker-compose does this).
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./officespeak.db")

# --- Cost accounting (USD per million tokens) --------------------------------
# Defaults: 0 for Gemini's free tier; Anthropic Sonnet-class pricing otherwise.
# Override via env when pricing changes or you move off the free tier.
_default_in = "0" if LLM_PROVIDER == "gemini" else "3.0"
_default_out = "0" if LLM_PROVIDER == "gemini" else "15.0"
PRICE_INPUT_PER_MTOK = float(os.getenv("PRICE_INPUT_PER_MTOK", _default_in))
PRICE_OUTPUT_PER_MTOK = float(os.getenv("PRICE_OUTPUT_PER_MTOK", _default_out))

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")
