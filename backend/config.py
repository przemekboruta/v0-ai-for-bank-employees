"""
Topic Discovery Hub - Configuration
"""

import os
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).parent / ".env"
if env_path.exists():
    load_dotenv(env_path)

# === Encoder ===
ENCODER_MODEL_NAME: str = os.getenv("ENCODER_MODEL_NAME", "answerdotai/ModernBERT-base")
ENCODER_BATCH_SIZE: int = int(os.getenv("ENCODER_BATCH_SIZE", "64"))
ENCODER_MAX_SEQ_LENGTH: int = int(os.getenv("ENCODER_MAX_SEQ_LENGTH", "512"))
ENCODER_DEVICE: str = os.getenv("ENCODER_DEVICE", "auto")

# === LLM (OpenAI / OpenAI-compatible) ===
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "").strip()  # opcjonalnie: np. Azure, proxy, lokalny endpoint
LLM_MODEL: str = os.getenv("LLM_MODEL", "gpt-4o")
LLM_TEMPERATURE: float = float(os.getenv("LLM_TEMPERATURE", "0.3"))
LLM_MAX_TOKENS: int = int(os.getenv("LLM_MAX_TOKENS", "2000"))
LLM_RETRY_COUNT: int = int(os.getenv("LLM_RETRY_COUNT", "3"))

# === Redis ===
REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
REDIS_PREFIX: str = os.getenv("REDIS_PREFIX", "tdh:")
EMBEDDING_CACHE_TTL: int = int(os.getenv("EMBEDDING_CACHE_TTL", str(7 * 24 * 3600)))  # 7 days
JOB_TTL: int = int(os.getenv("JOB_TTL", str(24 * 3600)))  # 24h
RESULT_TTL: int = int(os.getenv("RESULT_TTL", str(48 * 3600)))  # 48h

# === UMAP ===
UMAP_N_NEIGHBORS: int = int(os.getenv("UMAP_N_NEIGHBORS", "15"))
UMAP_MIN_DIST: float = float(os.getenv("UMAP_MIN_DIST", "0.1"))
UMAP_METRIC: str = os.getenv("UMAP_METRIC", "cosine")

# === HDBSCAN - mapowanie granularity ===
GRANULARITY_CONFIG: dict = {
    "low": {
        "min_cluster_size": 50,
        "min_samples": 15,
        "cluster_selection_epsilon": 0.5,
    },
    "medium": {
        "min_cluster_size": 20,
        "min_samples": 8,
        "cluster_selection_epsilon": 0.3,
    },
    "high": {
        "min_cluster_size": 8,
        "min_samples": 3,
        "cluster_selection_epsilon": 0.1,
    },
}

# === Limity ===
MIN_TEXTS: int = int(os.getenv("MIN_TEXTS", "10"))
MAX_TEXTS: int = int(os.getenv("MAX_TEXTS", "50000"))
MAX_TEXT_LENGTH: int = int(os.getenv("MAX_TEXT_LENGTH", "5000"))
PIPELINE_TIMEOUT_SECONDS: int = int(os.getenv("PIPELINE_TIMEOUT_SECONDS", "600"))
MAX_CONCURRENT_JOBS: int = int(os.getenv("MAX_CONCURRENT_JOBS", "3"))

# === Serwer ===
HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8000"))
CORS_ORIGINS: list[str] = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

# === Kolory klastrow ===
CLUSTER_COLORS: list[str] = [
    "hsl(210, 100%, 65%)", "hsl(175, 70%, 55%)", "hsl(40, 90%, 62%)",
    "hsl(340, 75%, 62%)", "hsl(265, 60%, 65%)", "hsl(150, 65%, 52%)",
    "hsl(20, 85%, 60%)", "hsl(195, 75%, 58%)", "hsl(300, 50%, 62%)",
    "hsl(55, 80%, 55%)", "hsl(0, 70%, 60%)", "hsl(120, 55%, 52%)",
]

# === Polskie stop words ===
POLISH_STOP_WORDS: list[str] = [
    "i", "w", "na", "z", "do", "nie", "sie", "o", "to", "jak",
    "ale", "za", "co", "jest", "od", "po", "ze", "czy", "tak",
    "go", "tego", "ja", "juz", "by", "tym", "tu", "te", "ten",
    "ta", "pan", "pani", "moje", "moj", "ktory", "ktora", "sa",
    "byl", "byla", "bylo", "byly", "bedzie", "mi", "sie", "sobie",
    "moze", "bardzo", "tylko", "jeszcze", "tez", "dla", "przy",
    "prosze", "dziekuje", "chcialabym", "chcialbym", "mam", "moge",
]
