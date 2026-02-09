"""
Topic Discovery Hub - FastAPI Application
==========================================
Serwer backendowy dla narzedzia klasteryzacji tematycznej.

Pipeline: ModernBERT encoder -> UMAP -> HDBSCAN -> Silhouette -> c-TF-IDF -> OpenAI LLM

Uruchomienie:
    cd backend
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Dokumentacja API:
    http://localhost:8000/docs     (Swagger UI)
    http://localhost:8000/redoc    (ReDoc)
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import HOST, PORT, CORS_ORIGINS, ENCODER_MODEL_NAME, LLM_MODEL
from services.encoder import EncoderService

# Konfiguracja logowania
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


# ===== Lifecycle =====

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Laduje model encoder przy starcie serwera.
    Model jest singleton -- ladowany raz i wspoldzielony miedzy requestami.
    """
    logger.info("=" * 60)
    logger.info("Topic Discovery Hub - Backend Start")
    logger.info(f"  Encoder: {ENCODER_MODEL_NAME}")
    logger.info(f"  LLM:     {LLM_MODEL}")
    logger.info(f"  CORS:    {CORS_ORIGINS}")
    logger.info("=" * 60)

    # Pre-load encoder model
    logger.info("Ladowanie modelu encoder (moze potrwac kilka sekund)...")
    encoder = EncoderService.get_instance()
    try:
        encoder.load()
        logger.info("Model encoder zaladowany pomyslnie.")
    except Exception as e:
        logger.error(f"Blad ladowania modelu: {e}")
        logger.warning("Serwer uruchomiony bez wstepnie zaladowanego modelu.")

    yield

    # Cleanup
    logger.info("Zamykanie serwera...")


# ===== App =====

app = FastAPI(
    title="Topic Discovery Hub API",
    description=(
        "Backend API dla narzedzia automatycznego wykrywania kategorii "
        "tematycznych w dokumentach tekstowych. Przeznaczony dla pracownikow "
        "contact center bankowego."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS -- pozwala Next.js frontend laczyc sie z backendem
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== Routers =====

from routers.cluster import router as cluster_router
from routers.export import router as export_router
from routers.health import router as health_router

app.include_router(cluster_router, prefix="/api")
app.include_router(export_router, prefix="/api")
app.include_router(health_router, prefix="/api")


# ===== Root =====

@app.get("/", tags=["root"])
async def root():
    return {
        "service": "Topic Discovery Hub API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/api/health",
    }


# ===== Entrypoint =====

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=HOST,
        port=PORT,
        reload=True,
        log_level="info",
    )
