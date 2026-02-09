"""
Topic Discovery Hub - Cluster Router
Endpoints: POST /cluster (submit job), GET /cluster/job/{id},
           POST /cluster/recluster, POST /cluster/refine,
           PATCH /cluster/rename, POST /cluster/merge,
           POST /cluster/split, POST /cluster/reclassify
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from schemas import (
    ClusterRequest,
    ReclusterRequest,
    RefineRequest,
    RefineResponse,
    RenameRequest,
    RenameResponse,
    MergeRequest,
    SplitRequest,
    ReclassifyRequest,
    ErrorResponse,
)
from services.pipeline import PipelineService
from services.job_queue import JobQueueService
from services.llm import LLMService
from config import MIN_TEXTS, MAX_TEXTS, MAX_TEXT_LENGTH

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cluster", tags=["clustering"])


def get_pipeline() -> PipelineService:
    return PipelineService()


# ================================================================
# POST /cluster  --  Submit clustering job (async)
# ================================================================

@router.post(
    "",
    summary="Submit a new clustering job",
    description=(
        "Accepts texts and config, submits to the job queue. "
        "Returns job_id immediately. Poll GET /cluster/job/{id} for status."
    ),
)
async def submit_cluster_job(req: ClusterRequest):
    if len(req.texts) < MIN_TEXTS:
        raise HTTPException(status_code=400, detail={
            "code": "TOO_FEW_TEXTS",
            "message": f"Min {MIN_TEXTS} texts, got {len(req.texts)}.",
        })
    if len(req.texts) > MAX_TEXTS:
        raise HTTPException(status_code=400, detail={
            "code": "TOO_MANY_TEXTS",
            "message": f"Max {MAX_TEXTS} texts, got {len(req.texts)}.",
        })

    texts = [t[:MAX_TEXT_LENGTH].strip() for t in req.texts if t.strip()]
    if len(texts) < MIN_TEXTS:
        raise HTTPException(status_code=400, detail={
            "code": "TOO_FEW_TEXTS",
            "message": f"After filtering: {len(texts)} texts (min {MIN_TEXTS}).",
        })

    try:
        config = req.config.model_dump(by_alias=True)
        config["iteration"] = req.iteration
        pipeline = get_pipeline()
        job_id = await pipeline.submit_job(texts, config)
        return {"jobId": job_id, "status": "queued"}
    except RuntimeError as e:
        raise HTTPException(status_code=429, detail={
            "code": "QUEUE_FULL", "message": str(e),
        })
    except Exception as e:
        logger.exception(f"Submit error: {e}")
        raise HTTPException(status_code=500, detail={
            "code": "PIPELINE_ERROR", "message": str(e),
        })


# ================================================================
# GET /cluster/job/{job_id}  --  Poll job status
# ================================================================

@router.get(
    "/job/{job_id}",
    summary="Get job status and result",
    description="Poll this endpoint to check job progress. When completed, result is included.",
)
async def get_job_status(job_id: str):
    jobs = JobQueueService.get_instance()
    job_info = await jobs.get_job(job_id)
    if not job_info:
        raise HTTPException(status_code=404, detail={
            "code": "JOB_NOT_FOUND",
            "message": f"Job {job_id} not found or expired.",
        })

    response = {**job_info}

    # If completed, include the result
    if job_info.get("status") == "completed":
        result = await jobs.get_result(job_id)
        if result:
            response["result"] = result

    return response


# ================================================================
# POST /cluster/recluster  --  Re-cluster with cached embeddings
# ================================================================

@router.post(
    "/recluster",
    summary="Re-cluster using cached embeddings from a previous job",
    description=(
        "Reuses embeddings from a previous job (skipping the expensive encoding step). "
        "Allows changing algorithm, num_clusters, granularity, etc."
    ),
)
async def recluster(req: ReclusterRequest):
    jobs = JobQueueService.get_instance()

    has_cache = await jobs.has_cached_embeddings(req.job_id)
    if not has_cache:
        raise HTTPException(status_code=404, detail={
            "code": "EMBEDDINGS_NOT_CACHED",
            "message": f"No cached embeddings for job {req.job_id}. Run a full cluster first.",
        })

    try:
        pipeline = get_pipeline()
        config = req.config.model_dump(by_alias=True)
        new_job_id = await pipeline.submit_recluster(req.job_id, config)
        return {"jobId": new_job_id, "status": "queued", "cachedFrom": req.job_id}
    except Exception as e:
        logger.exception(f"Recluster error: {e}")
        raise HTTPException(status_code=500, detail={
            "code": "PIPELINE_ERROR", "message": str(e),
        })


# ================================================================
# POST /cluster/refine
# ================================================================

@router.post("/refine", response_model=RefineResponse, summary="LLM refinement suggestions")
async def refine_clusters(req: RefineRequest):
    if not req.topics:
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_INPUT", "message": "Topics required.",
        })
    try:
        llm = LLMService()
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
        raise HTTPException(status_code=503, detail={
            "code": "LLM_UNAVAILABLE", "message": str(e),
        })
    except Exception as e:
        logger.exception(f"Refine error: {e}")
        raise HTTPException(status_code=503, detail={
            "code": "LLM_UNAVAILABLE", "message": str(e),
        })


# ================================================================
# PATCH /cluster/rename
# ================================================================

@router.patch("/rename", response_model=RenameResponse, summary="Rename a topic")
async def rename_topic(req: RenameRequest):
    if not req.new_label or not req.new_label.strip():
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_INPUT", "message": "newLabel required.",
        })
    logger.info(f"Topic {req.topic_id} renamed to '{req.new_label.strip()}'")
    return {
        "topicId": req.topic_id, "oldLabel": "",
        "newLabel": req.new_label.strip(), "updated": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ================================================================
# POST /cluster/merge
# ================================================================

@router.post("/merge", summary="Merge clusters")
async def merge_clusters(req: MergeRequest):
    if len(req.cluster_ids) < 2:
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_INPUT", "message": "Need 2+ clusters.",
        })
    try:
        pipeline = get_pipeline()
        docs = [d.model_dump(by_alias=True) for d in req.documents]
        tops = [t.model_dump(by_alias=True) for t in req.topics]
        return await pipeline.merge_clusters(req.cluster_ids, req.new_label, docs, tops)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "INVALID_INPUT", "message": str(e)})
    except Exception as e:
        logger.exception(f"Merge error: {e}")
        raise HTTPException(status_code=500, detail={"code": "PIPELINE_ERROR", "message": str(e)})


# ================================================================
# POST /cluster/split
# ================================================================

@router.post("/split", summary="Split a cluster")
async def split_cluster(req: SplitRequest):
    try:
        pipeline = get_pipeline()
        docs = [d.model_dump(by_alias=True) for d in req.documents]
        tops = [t.model_dump(by_alias=True) for t in req.topics]
        return await pipeline.split_cluster(req.cluster_id, req.num_subclusters, docs, tops)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "INVALID_INPUT", "message": str(e)})
    except Exception as e:
        logger.exception(f"Split error: {e}")
        raise HTTPException(status_code=500, detail={"code": "PIPELINE_ERROR", "message": str(e)})


# ================================================================
# POST /cluster/reclassify
# ================================================================

@router.post("/reclassify", summary="Reclassify documents between clusters")
async def reclassify_documents(req: ReclassifyRequest):
    if req.from_cluster_id == req.to_cluster_id:
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_INPUT", "message": "Source and target must differ.",
        })
    try:
        pipeline = get_pipeline()
        docs = [d.model_dump(by_alias=True) for d in req.documents]
        tops = [t.model_dump(by_alias=True) for t in req.topics]
        return await pipeline.reclassify_documents(
            req.document_ids, req.from_cluster_id, req.to_cluster_id, docs, tops,
        )
    except Exception as e:
        logger.exception(f"Reclassify error: {e}")
        raise HTTPException(status_code=500, detail={"code": "PIPELINE_ERROR", "message": str(e)})
