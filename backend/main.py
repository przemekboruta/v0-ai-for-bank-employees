"""
Topic Discovery Hub - FastAPI Application
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import HOST, PORT, CORS_ORIGINS, ENCODER_MODEL_NAME, LLM_MODEL, REDIS_URL
from services.encoder import EncoderService
from services.job_queue import JobQueueService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 60)
    logger.info("Topic Discovery Hub - Backend Start")
    logger.info(f"  Encoder: {ENCODER_MODEL_NAME}")
    logger.info(f"  LLM:     {LLM_MODEL}")
    logger.info(f"  Redis:   {REDIS_URL}")
    logger.info(f"  CORS:    {CORS_ORIGINS}")
    logger.info("=" * 60)

    # Pre-load encoder
    logger.info("Loading encoder model...")
    encoder = EncoderService.get_instance()
    try:
        encoder.load()
        logger.info("Encoder loaded.")
    except Exception as e:
        logger.error(f"Encoder load error: {e}")

    # Check Redis
    jobs = JobQueueService.get_instance()
    redis_health = await jobs.health_check()
    if redis_health.get("status") == "up":
        logger.info(f"Redis connected: {redis_health}")
    else:
        logger.warning(f"Redis not available: {redis_health}")

    yield

    # Cleanup
    await jobs.close()
    logger.info("Server shutdown.")


app = FastAPI(
    title="Topic Discovery Hub API",
    description="Backend API for automatic topic discovery in text documents.",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from routers.cluster import router as cluster_router
from routers.export import router as export_router
from routers.health import router as health_router

app.include_router(cluster_router, prefix="/api")
app.include_router(export_router, prefix="/api")
app.include_router(health_router, prefix="/api")


@app.get("/", tags=["root"])
async def root():
    return {
        "service": "Topic Discovery Hub API",
        "version": "2.0.0",
        "docs": "/docs",
        "health": "/api/health",
    }


if __name__ == "__main__":
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True, log_level="info")
