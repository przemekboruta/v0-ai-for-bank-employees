"""
Topic Discovery Hub - Health Router
Endpoint: GET /health
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter

from services.encoder import EncoderService
from services.clustering import ClusteringService
from services.llm import LLMService

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])

APP_VERSION = "1.0.0"


@router.get(
    "/health",
    summary="Healthcheck",
    description="Sprawdza dostepnosc komponentow: encoder, UMAP, HDBSCAN, LLM.",
)
async def health_check():
    encoder = EncoderService.get_instance()
    clustering = ClusteringService()
    llm = LLMService()

    encoder_health = encoder.health_check()
    clustering_health = clustering.health_check()
    llm_health = await llm.health_check()

    components = {
        "encoder": encoder_health,
        "umap": clustering_health.get("umap", {"status": "unknown"}),
        "hdbscan": clustering_health.get("hdbscan", {"status": "unknown"}),
        "llm": llm_health,
    }

    all_up = all(c.get("status") == "up" for c in components.values())
    any_error = any(c.get("status") == "error" for c in components.values())

    if all_up:
        overall = "healthy"
    elif any_error:
        overall = "unhealthy"
    else:
        overall = "degraded"

    return {
        "status": overall,
        "components": components,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": APP_VERSION,
    }
