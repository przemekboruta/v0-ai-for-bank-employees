"""
Topic Discovery Hub - Cluster Router
Endpointy: POST /cluster, POST /cluster/refine, PATCH /cluster/rename,
           POST /cluster/merge, POST /cluster/split, POST /cluster/reclassify
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from schemas import (
    ClusterRequest,
    ClusterResponse,
    RefineRequest,
    RefineResponse,
    RenameRequest,
    RenameResponse,
    MergeRequest,
    SplitRequest,
    ReclassifyRequest,
    ErrorResponse,
    ErrorDetail,
)
from services.pipeline import PipelineService
from services.llm import LLMService
from config import MIN_TEXTS, MAX_TEXTS, MAX_TEXT_LENGTH

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cluster", tags=["clustering"])


def get_pipeline() -> PipelineService:
    return PipelineService()


# ================================================================
# POST /cluster  --  Glowna klasteryzacja
# ================================================================

@router.post(
    "",
    response_model=ClusterResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Uruchom pelny pipeline klasteryzacji",
    description=(
        "Przyjmuje liste tekstow i granularnosc (low/medium/high). "
        "Uruchamia: Encoder -> UMAP -> HDBSCAN -> Silhouette -> c-TF-IDF -> LLM labeling. "
        "Zwraca dokumenty z koordynatami 2D, topiki z etykietami i sugestie LLM."
    ),
)
async def cluster_texts(req: ClusterRequest):
    # Walidacja
    if len(req.texts) < MIN_TEXTS:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "TOO_FEW_TEXTS",
                "message": f"Wymagane minimum {MIN_TEXTS} tekstow, otrzymano {len(req.texts)}.",
            },
        )
    if len(req.texts) > MAX_TEXTS:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "TOO_MANY_TEXTS",
                "message": f"Maksimum {MAX_TEXTS} tekstow, otrzymano {len(req.texts)}.",
            },
        )

    # Przytnij zbyt dlugie teksty
    texts = [t[:MAX_TEXT_LENGTH] for t in req.texts]

    # Odfiltruj puste
    texts = [t.strip() for t in texts if t.strip()]
    if len(texts) < MIN_TEXTS:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "TOO_FEW_TEXTS",
                "message": f"Po odfiltr. pustych zostalo {len(texts)} tekstow (min. {MIN_TEXTS}).",
            },
        )

    try:
        pipeline = get_pipeline()
        result = await pipeline.run_full_pipeline(
            texts=texts,
            granularity=req.granularity,
            iteration=req.iteration,
        )
        return result

    except Exception as e:
        logger.exception(f"Pipeline error: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "code": "PIPELINE_ERROR",
                "message": f"Blad pipeline'u klasteryzacji: {str(e)}",
            },
        )


# ================================================================
# POST /cluster/refine  --  Sugestie LLM refinementu
# ================================================================

@router.post(
    "/refine",
    response_model=RefineResponse,
    responses={400: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
    summary="Generuj sugestie refinementu od LLM",
    description=(
        "Analizuje istniejace klastry i generuje sugestie ulepszen "
        "(merge, split, rename, reclassify). Nie zmienia danych -- zwraca tylko sugestie."
    ),
)
async def refine_clusters(req: RefineRequest):
    if not req.topics:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_INPUT",
                "message": "Pole 'topics' jest wymagane i musi zawierac co najmniej 1 topik.",
            },
        )

    try:
        llm = LLMService()

        # Konwertuj Pydantic -> dict
        topics_data = [t.model_dump(by_alias=True) for t in req.topics]
        prev_data = [s.model_dump(by_alias=True) for s in req.previous_suggestions]

        result = await llm.generate_refinement_suggestions(
            topics=topics_data,
            total_docs=len(req.documents),
            noise_count=sum(1 for d in req.documents if d.cluster_id == -1),
            focus_areas=req.focus_areas,
            previous_suggestions=prev_data,
        )
        return result

    except RuntimeError as e:
        if "OPENAI_API_KEY" in str(e):
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "LLM_NOT_CONFIGURED",
                    "message": str(e),
                },
            )
        raise HTTPException(
            status_code=503,
            detail={
                "code": "LLM_UNAVAILABLE",
                "message": f"Blad serwisu LLM: {str(e)}",
            },
        )
    except Exception as e:
        logger.exception(f"Refine error: {e}")
        raise HTTPException(
            status_code=503,
            detail={
                "code": "LLM_UNAVAILABLE",
                "message": f"Nie udalo sie uzyskac sugestii: {str(e)}",
            },
        )


# ================================================================
# PATCH /cluster/rename  --  Zmiana nazwy topiku
# ================================================================

@router.patch(
    "/rename",
    response_model=RenameResponse,
    responses={400: {"model": ErrorResponse}},
    summary="Zmien nazwe topiku",
)
async def rename_topic(req: RenameRequest):
    if not req.new_label or not req.new_label.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_INPUT",
                "message": "Pole 'newLabel' jest wymagane i nie moze byc puste.",
            },
        )
    if len(req.new_label) > 100:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_INPUT",
                "message": "Nazwa topiku nie moze przekraczac 100 znakow.",
            },
        )

    # W produkcji: audit log
    logger.info(f"Topic {req.topic_id} renamed to '{req.new_label.strip()}'")

    return {
        "topicId": req.topic_id,
        "oldLabel": "",  # w produkcji pobierz z bazy
        "newLabel": req.new_label.strip(),
        "updated": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ================================================================
# POST /cluster/merge  --  Laczenie klastrow
# ================================================================

@router.post(
    "/merge",
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Polacz 2+ klastrow w jeden",
    description=(
        "Przenosi dokumenty z klastrow zrodlowych do docelowego, "
        "przelicza centroid, koherencje i keywords."
    ),
)
async def merge_clusters(req: MergeRequest):
    if len(req.cluster_ids) < 2:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_INPUT",
                "message": "Potrzeba co najmniej 2 klastrow do polaczenia.",
            },
        )

    try:
        pipeline = get_pipeline()
        documents = [d.model_dump(by_alias=True) for d in req.documents]
        topics = [t.model_dump(by_alias=True) for t in req.topics]

        result = await pipeline.merge_clusters(
            cluster_ids=req.cluster_ids,
            new_label=req.new_label,
            documents=documents,
            topics=topics,
        )
        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "INVALID_INPUT", "message": str(e)})
    except Exception as e:
        logger.exception(f"Merge error: {e}")
        raise HTTPException(
            status_code=500,
            detail={"code": "PIPELINE_ERROR", "message": f"Nie udalo sie polaczyc klastrow: {str(e)}"},
        )


# ================================================================
# POST /cluster/split  --  Podzial klastra
# ================================================================

@router.post(
    "/split",
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Podziel klaster na podklastry",
    description="Dzieli klaster na 2+ podklastrow za pomoca KMeans na koordynatach 2D.",
)
async def split_cluster(req: SplitRequest):
    try:
        pipeline = get_pipeline()
        documents = [d.model_dump(by_alias=True) for d in req.documents]
        topics = [t.model_dump(by_alias=True) for t in req.topics]

        result = await pipeline.split_cluster(
            cluster_id=req.cluster_id,
            num_subclusters=req.num_subclusters,
            documents=documents,
            topics=topics,
        )
        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "INVALID_INPUT", "message": str(e)})
    except Exception as e:
        logger.exception(f"Split error: {e}")
        raise HTTPException(
            status_code=500,
            detail={"code": "PIPELINE_ERROR", "message": f"Nie udalo sie podzielic klastra: {str(e)}"},
        )


# ================================================================
# POST /cluster/reclassify  --  Przenoszenie dokumentow
# ================================================================

@router.post(
    "/reclassify",
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Przenies dokumenty miedzy klastrami",
)
async def reclassify_documents(req: ReclassifyRequest):
    if req.from_cluster_id == req.to_cluster_id:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_INPUT",
                "message": "Klaster zrodlowy i docelowy nie moga byc takie same.",
            },
        )

    try:
        pipeline = get_pipeline()
        documents = [d.model_dump(by_alias=True) for d in req.documents]
        topics = [t.model_dump(by_alias=True) for t in req.topics]

        result = await pipeline.reclassify_documents(
            document_ids=req.document_ids,
            from_cluster_id=req.from_cluster_id,
            to_cluster_id=req.to_cluster_id,
            documents=documents,
            topics=topics,
        )
        return result

    except Exception as e:
        logger.exception(f"Reclassify error: {e}")
        raise HTTPException(
            status_code=500,
            detail={"code": "PIPELINE_ERROR", "message": f"Nie udalo sie reklasyfikowac: {str(e)}"},
        )
