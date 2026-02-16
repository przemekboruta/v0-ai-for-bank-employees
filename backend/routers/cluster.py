"""
Topic Discovery Hub - Cluster Router
Endpoints: POST /cluster (submit job), GET /cluster/job/{id},
           POST /cluster/recluster, POST /cluster/refine,
           PATCH /cluster/rename, POST /cluster/merge,
           POST /cluster/reclassify
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
    ReclassifyRequest,
    GenerateLabelsRequest,
    GenerateLabelsResponse,
    ErrorResponse,
)
from services.pipeline import PipelineService
from services.job_queue import JobQueueService
from services.llm import LLMService
from config import MIN_TEXTS, MAX_TEXTS, MAX_TEXT_LENGTH, ENCODER_MODELS

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
    jobs = JobQueueService.get_instance()

    # Check if using cached job (cachedJobId in config)
    if req.config.cached_job_id:
        # Get texts from cache
        cached_texts = await jobs.get_texts(req.config.cached_job_id)
        if cached_texts is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "CACHED_JOB_NOT_FOUND",
                    "message": f"Cached job {req.config.cached_job_id} not found or expired.",
                },
            )

        # Validate number of texts from cache
        if len(cached_texts) < MIN_TEXTS:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "TOO_FEW_TEXTS",
                    "message": f"Cached job has {len(cached_texts)} texts (min {MIN_TEXTS}).",
                },
            )
        if len(cached_texts) > MAX_TEXTS:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "TOO_MANY_TEXTS",
                    "message": f"Cached job has {len(cached_texts)} texts (max {MAX_TEXTS}).",
                },
            )

        # Use texts from cache
        texts = cached_texts
    else:
        # Normal validation for provided texts
        if len(req.texts) < MIN_TEXTS:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "TOO_FEW_TEXTS",
                    "message": f"Min {MIN_TEXTS} texts, got {len(req.texts)}.",
                },
            )
        if len(req.texts) > MAX_TEXTS:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "TOO_MANY_TEXTS",
                    "message": f"Max {MAX_TEXTS} texts, got {len(req.texts)}.",
                },
            )

        texts = [t[:MAX_TEXT_LENGTH].strip() for t in req.texts if t.strip()]
        if len(texts) < MIN_TEXTS:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "TOO_FEW_TEXTS",
                    "message": f"After filtering: {len(texts)} texts (min {MIN_TEXTS}).",
                },
            )

    try:
        config = req.config.model_dump(by_alias=True)
        config["iteration"] = req.iteration
        pipeline = get_pipeline()
        job_id = await pipeline.submit_job(texts, config)
        return {"jobId": job_id, "status": "queued"}
    except RuntimeError as e:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "QUEUE_FULL",
                "message": str(e),
            },
        )
    except Exception as e:
        logger.exception(f"Submit error: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "code": "PIPELINE_ERROR",
                "message": str(e),
            },
        )


# ================================================================
# GET /cluster/encoders  --  List available encoder models
# ================================================================


@router.get(
    "/encoders",
    summary="List available encoder models",
    description="Returns model names that can be used as encoderModel in job config.",
)
async def list_encoders():
    models = [c["model"] for c in ENCODER_MODELS]
    return {"models": models}


# ================================================================
# GET /cluster/jobs  --  List all jobs
# ================================================================


@router.get(
    "/jobs",
    summary="List all known jobs",
    description="Returns a list of all jobs (active and completed) from Redis.",
)
async def list_jobs():
    jobs = JobQueueService.get_instance()
    all_jobs = await jobs.list_jobs()
    return {"jobs": all_jobs}


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
        raise HTTPException(
            status_code=404,
            detail={
                "code": "JOB_NOT_FOUND",
                "message": f"Job {job_id} not found or expired.",
            },
        )

    response = {**job_info}

    # If completed, include the result
    if job_info.get("status") == "completed":
        result = await jobs.get_result(job_id)
        if result:
            response["result"] = result

    return response


# ================================================================
# DELETE /cluster/job/{job_id}  --  Delete a job
# ================================================================


@router.delete(
    "/job/{job_id}",
    summary="Delete a job",
    description="Delete a job and all associated data (texts, embeddings, result).",
)
async def delete_job(job_id: str):
    jobs = JobQueueService.get_instance()
    deleted = await jobs.delete_job(job_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "JOB_NOT_FOUND",
                "message": f"Job {job_id} not found or expired.",
            },
        )
    return {"jobId": job_id, "deleted": True}


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
        raise HTTPException(
            status_code=404,
            detail={
                "code": "EMBEDDINGS_NOT_CACHED",
                "message": f"No cached embeddings for job {req.job_id}. Run a full cluster first.",
            },
        )

    try:
        pipeline = get_pipeline()
        config = req.config.model_dump(by_alias=True)
        new_job_id = await pipeline.submit_recluster(req.job_id, config)
        return {"jobId": new_job_id, "status": "queued", "cachedFrom": req.job_id}
    except Exception as e:
        logger.exception(f"Recluster error: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "code": "PIPELINE_ERROR",
                "message": str(e),
            },
        )


# ================================================================
# POST /cluster/refine
# ================================================================


@router.post("/refine", response_model=RefineResponse, summary="LLM refinement suggestions")
async def refine_clusters(req: RefineRequest):
    if not req.topics:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_INPUT",
                "message": "Topics required.",
            },
        )
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
        raise HTTPException(
            status_code=503,
            detail={
                "code": "LLM_UNAVAILABLE",
                "message": str(e),
            },
        )
    except Exception as e:
        logger.exception(f"Refine error: {e}")
        raise HTTPException(
            status_code=503,
            detail={
                "code": "LLM_UNAVAILABLE",
                "message": str(e),
            },
        )


# ================================================================
# PATCH /cluster/rename
# ================================================================


@router.patch("/rename", response_model=RenameResponse, summary="Rename a topic")
async def rename_topic(req: RenameRequest):
    if not req.new_label or not req.new_label.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_INPUT",
                "message": "newLabel required.",
            },
        )

    # Update result in Redis if job_id provided
    if req.job_id:
        jobs = JobQueueService.get_instance()
        result = await jobs.get_result(req.job_id)
        if result:
            # Preserve jobId and meta from existing result
            old_label = ""
            # Update topic label in result
            for topic in result.get("topics", []):
                if topic.get("id") == req.topic_id:
                    old_label = topic.get("label", "")
                    topic["label"] = req.new_label.strip()
                    logger.info(
                        f"Topic {req.topic_id} renamed from '{old_label}' to '{req.new_label.strip()}' in job {req.job_id}"
                    )
                    break

            # Ensure jobId and meta are preserved
            result["jobId"] = result.get("jobId") or req.job_id
            if "meta" not in result:
                result["meta"] = {}

            # Save updated result
            await jobs.update_result(req.job_id, result)
            return {
                "topicId": req.topic_id,
                "oldLabel": old_label,
                "newLabel": req.new_label.strip(),
                "updated": True,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

    logger.info(f"Topic {req.topic_id} renamed to '{req.new_label.strip()}'")
    return {
        "topicId": req.topic_id,
        "oldLabel": "",
        "newLabel": req.new_label.strip(),
        "updated": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ================================================================
# POST /cluster/merge
# ================================================================


@router.post("/merge", summary="Merge clusters")
async def merge_clusters(req: MergeRequest):
    if len(req.cluster_ids) < 2:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_INPUT",
                "message": "Need 2+ clusters.",
            },
        )
    try:
        pipeline = get_pipeline()
        docs = [d.model_dump(by_alias=True) for d in req.documents]
        tops = [t.model_dump(by_alias=True) for t in req.topics]
        return await pipeline.merge_clusters(req.cluster_ids, req.new_label, docs, tops, req.job_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "INVALID_INPUT", "message": str(e)})
    except Exception as e:
        logger.exception(f"Merge error: {e}")
        raise HTTPException(status_code=500, detail={"code": "PIPELINE_ERROR", "message": str(e)})


# ================================================================
# POST /cluster/reclassify
# ================================================================


@router.post("/reclassify", summary="Reclassify documents from multiple clusters into new clusters")
async def reclassify_documents(req: ReclassifyRequest):
    if len(req.from_cluster_ids) < 1:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_INPUT",
                "message": "At least one source cluster ID required.",
            },
        )
    if req.num_clusters < 1:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_INPUT",
                "message": "Number of clusters must be at least 1.",
            },
        )
    try:
        pipeline = get_pipeline()
        docs = [d.model_dump(by_alias=True) for d in req.documents]
        tops = [t.model_dump(by_alias=True) for t in req.topics]
        return await pipeline.reclassify_documents(
            req.from_cluster_ids,
            req.num_clusters,
            docs,
            tops,
            req.job_id,
        )
    except Exception as e:
        logger.exception(f"Reclassify error: {e}")
        raise HTTPException(status_code=500, detail={"code": "PIPELINE_ERROR", "message": str(e)})


# ================================================================
# POST /cluster/generate-labels
# ================================================================


@router.post(
    "/generate-labels", response_model=GenerateLabelsResponse, summary="Generate LLM labels for selected topics"
)
async def generate_labels(req: GenerateLabelsRequest):
    if not req.topic_ids:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_INPUT",
                "message": "At least one topic ID required.",
            },
        )
    try:
        llm = LLMService()
        jobs = JobQueueService.get_instance()

        # Get texts and embeddings if job_id provided
        texts = None
        all_embeddings = None
        if req.job_id:
            texts = await jobs.get_texts(req.job_id)
            all_embeddings = await jobs.get_cached_embeddings(req.job_id)

        # Get documents for selected topics
        docs_data = [d.model_dump(by_alias=True) for d in req.documents]
        topics_data = [t.model_dump(by_alias=True) for t in req.topics]

        updated_topics = []
        for topic in topics_data:
            if topic["id"] not in req.topic_ids:
                updated_topics.append(topic)
                continue

            # Get documents for this topic
            topic_docs = [d for d in docs_data if d.get("clusterId") == topic["id"]]
            if not topic_docs:
                updated_topics.append(topic)
                continue

            # Get texts for this topic
            topic_texts = []
            if texts:
                topic_texts = [d["text"] for d in topic_docs]
            else:
                topic_texts = [d.get("text", "") for d in topic_docs]

            # Extract keywords
            from services.clustering import ClusteringService

            clustering = ClusteringService()
            keywords = clustering.extract_keywords(topic_texts)

            # Get sample texts
            samples = topic["sampleTexts"][:10] if topic.get("sampleTexts") else topic_texts[:10]

            # Generate label using LLM
            labeled = await llm.label_cluster(
                cluster_id=topic["id"],
                doc_count=len(topic_docs),
                coherence=topic.get("coherenceScore", 0.7),
                sample_texts=samples,
                keywords=keywords,
            )

            # Update topic with new label
            updated_topic = topic.copy()
            updated_topic["label"] = labeled.get("label", topic["label"])
            updated_topic["description"] = labeled.get("description", topic.get("description", ""))
            updated_topics.append(updated_topic)

        # Update result in Redis if job_id provided
        if req.job_id:
            result = await jobs.get_result(req.job_id)
            if result:
                result["topics"] = updated_topics
                result["jobId"] = result.get("jobId") or req.job_id
                if "meta" not in result:
                    result["meta"] = {}
                await jobs.update_result(req.job_id, result)

        return {
            "updatedTopics": updated_topics,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.exception(f"Generate labels error: {e}")
        raise HTTPException(status_code=500, detail={"code": "LLM_ERROR", "message": str(e)})
