"""
Classification Router - SetFit training, prediction, model management.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from config import REDIS_URL, REDIS_PREFIX, MODELS_DIR, ENCODER_MODEL_NAME, LOCAL_ENCODER_PATH
from schemas import (
    TrainRequest,
    PredictRequest,
    RetrainRequest,
    TrainingJobInfo,
    ClassificationResult,
    ModelInfo,
)
from services.taxonomy_service import TaxonomyService
from services.model_registry import ModelRegistry

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)
router = APIRouter(tags=["classification"])

# Redis connection for classification jobs
_redis: aioredis.Redis | None = None


async def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


def _key(*parts: str) -> str:
    return REDIS_PREFIX + ":".join(parts)


async def _update_clf_job(job_id: str, **kwargs) -> None:
    r = await _get_redis()
    updates = {"updatedAt": datetime.now(timezone.utc).isoformat()}
    for k, v in kwargs.items():
        updates[k] = str(v) if not isinstance(v, str) else v
    await r.hset(_key("clf_job", job_id), mapping=updates)


async def _run_training_pipeline(job_id: str, categories: list[dict], texts: list[str] | None, req: TrainRequest):
    """Background training task."""
    from services import setfit_service

    try:
        # Loading model
        await _update_clf_job(job_id, status="loading_model", progress="10", currentStep="Ladowanie modelu...")

        backbone = req.backbone_model or ""

        # Training
        await _update_clf_job(job_id, status="training", progress="30", currentStep="Trening SetFit...")

        model, label_map, accuracy, accuracy_type, category_metrics = await setfit_service.train(
            categories=categories,
            backbone_model_path=backbone,
            num_iterations=req.num_iterations,
            batch_size=req.batch_size,
        )

        # Save model
        model_id = str(uuid.uuid4())[:12]
        model_name = req.model_name or f"Model {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        backbone_name = backbone or (LOCAL_ENCODER_PATH if LOCAL_ENCODER_PATH else ENCODER_MODEL_NAME)

        setfit_service.save_model(
            model=model,
            label_map=label_map,
            metadata={
                "name": model_name,
                "backbone": backbone_name,
                "categoryCount": len(categories),
                "accuracy": accuracy,
                "categories": categories,
            },
            model_id=model_id,
        )

        # Register in model registry
        total_examples = sum(len(c.get("examples", [])) for c in categories)
        registry = ModelRegistry.get_instance()
        await registry.register_model(
            model_id=model_id,
            name=model_name,
            backbone=backbone_name,
            categories=[c["name"] for c in categories],
            accuracy=accuracy,
            version=1,
            accuracy_type=accuracy_type,
            category_metrics=category_metrics,
            total_examples=total_examples,
        )

        # Predict on texts if provided
        result_data = None
        if texts:
            await _update_clf_job(job_id, status="predicting", progress="70", currentStep="Klasyfikacja tekstow...")
            docs, confidence_available = await setfit_service.predict(model, texts, label_map)
            result_data = {
                "documents": docs,
                "categories": categories,
                "totalDocuments": len(docs),
                "modelId": model_id,
                "accuracy": accuracy,
                "confidenceAvailable": confidence_available,
                "categoryMetrics": category_metrics,
                "iteration": 0,
            }

        # Complete
        r = await _get_redis()
        updates = {
            "status": "completed",
            "progress": "100",
            "currentStep": "Zakonczone",
            "modelId": model_id,
            "accuracy": str(accuracy),
            "accuracyType": accuracy_type,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        await r.hset(_key("clf_job", job_id), mapping=updates)

        if result_data:
            await r.set(
                _key("clf_job", job_id, "result"),
                json.dumps(result_data, ensure_ascii=False),
            )

        await r.srem(_key("active_clf_jobs"), job_id)
        logger.info(f"Classification job {job_id} completed. Model: {model_id}, Accuracy: {accuracy:.2%}")

    except Exception as e:
        logger.error(f"Classification job {job_id} failed: {e}", exc_info=True)
        r = await _get_redis()
        await r.hset(_key("clf_job", job_id), mapping={
            "status": "failed",
            "error": str(e),
            "currentStep": "Blad",
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        })
        await r.srem(_key("active_clf_jobs"), job_id)


# ---- Training ----


@router.post("/classify")
async def submit_training(req: TrainRequest):
    """Submit a SetFit training job (async)."""
    # Resolve categories
    categories = []
    if req.categories:
        categories = [c.model_dump() for c in req.categories]
    elif req.taxonomy_id:
        tax_svc = TaxonomyService.get_instance()
        tax = await tax_svc.get_taxonomy(req.taxonomy_id)
        if not tax:
            raise HTTPException(status_code=404, detail="Taxonomy not found")
        categories = tax.get("categories", [])

    if len(categories) < 2:
        raise HTTPException(status_code=400, detail="At least 2 categories required")

    total_examples = sum(len(c.get("examples", [])) for c in categories)
    if total_examples < 4:
        raise HTTPException(status_code=400, detail="At least 4 total training examples required")

    # Create job
    r = await _get_redis()
    job_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    job_info = {
        "jobId": job_id,
        "status": "queued",
        "progress": "0",
        "currentStep": "Oczekiwanie w kolejce...",
        "categoryCount": str(len(categories)),
        "createdAt": now,
        "updatedAt": now,
        "error": "",
        "modelId": "",
        "accuracy": "0",
    }

    pipe = r.pipeline()
    pipe.hset(_key("clf_job", job_id), mapping=job_info)
    pipe.sadd(_key("active_clf_jobs"), job_id)

    # Store texts if provided
    if req.texts:
        pipe.set(_key("clf_job", job_id, "texts"), json.dumps(req.texts, ensure_ascii=False))
    await pipe.execute()

    # Launch background training
    asyncio.create_task(_run_training_pipeline(job_id, categories, req.texts, req))

    return {"jobId": job_id, "status": "queued"}


@router.get("/classify/job/{job_id}")
async def get_training_status(job_id: str):
    """Get training job status."""
    r = await _get_redis()
    data = await r.hgetall(_key("clf_job", job_id))
    if not data:
        raise HTTPException(status_code=404, detail="Job not found")

    result = {}
    for k, v in data.items():
        result[k] = v

    # Parse numeric fields
    if "progress" in result:
        result["progress"] = float(result["progress"])
    if "categoryCount" in result:
        result["categoryCount"] = int(result["categoryCount"])
    if "accuracy" in result:
        result["accuracy"] = float(result["accuracy"])

    # Include result if completed
    if result.get("status") == "completed":
        raw_result = await r.get(_key("clf_job", job_id, "result"))
        if raw_result:
            result["result"] = json.loads(raw_result)

    return result


# ---- Prediction ----


@router.post("/classify/predict")
async def predict_with_model(req: PredictRequest):
    """Classify texts with a saved model."""
    from services import setfit_service

    if not req.model_id and not req.job_id:
        raise HTTPException(status_code=400, detail="model_id or job_id required")

    model_id = req.model_id
    if not model_id and req.job_id:
        # Get model_id from job
        r = await _get_redis()
        model_id = await r.hget(_key("clf_job", req.job_id), "modelId")
        if not model_id:
            raise HTTPException(status_code=404, detail="No model found for this job")

    try:
        model, label_map, metadata = setfit_service.load_model(model_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    docs, confidence_available = await setfit_service.predict(model, req.texts, label_map)

    categories = [{"id": str(k), "name": v, "examples": [], "description": ""} for k, v in label_map.items()]

    return {
        "documents": docs,
        "categories": categories,
        "totalDocuments": len(docs),
        "modelId": model_id,
        "accuracy": metadata.get("accuracy", 0),
        "confidenceAvailable": confidence_available,
    }


@router.post("/classify/batch")
async def batch_classify(req: PredictRequest):
    """Batch classification - same as predict but semantically different endpoint."""
    return await predict_with_model(req)


# ---- Active Learning: Retrain ----


async def _run_retrain_pipeline(
    job_id: str,
    source_model_id: str,
    corrections: list[dict],
    texts: list[str] | None,
    num_iterations: int,
):
    """Background retrain task — loads existing model categories, merges corrections, retrains."""
    from services import setfit_service

    try:
        await _update_clf_job(job_id, status="loading_model", progress="10", currentStep="Ladowanie modelu...")

        # Load original model metadata to get categories and backbone
        _, label_map, metadata = setfit_service.load_model(source_model_id)
        backbone = metadata.get("backbone", "")

        # Reconstruct categories from metadata
        # Read categories from the saved model's training data
        model_dir = MODELS_DIR / source_model_id
        meta_path = model_dir / "metadata.json"
        with open(meta_path, "r", encoding="utf-8") as f:
            saved_meta = json.load(f)

        categories = saved_meta.get("categories", [])
        if not categories:
            # Fallback: reconstruct from label_map
            categories = [
                {"id": str(k), "name": v, "examples": [], "description": ""}
                for k, v in label_map.items()
            ]

        # Merge corrections into categories as new examples
        corrections_count = 0
        cat_name_to_idx = {c["name"]: i for i, c in enumerate(categories)}
        for correction in corrections:
            cat_name = correction.get("correctedCategoryName", "")
            text = correction.get("text", "")
            if cat_name in cat_name_to_idx and text:
                idx = cat_name_to_idx[cat_name]
                if text not in categories[idx].get("examples", []):
                    categories[idx].setdefault("examples", []).append(text)
                    corrections_count += 1

        # Train
        await _update_clf_job(job_id, status="training", progress="30", currentStep="Dotrenowywanie modelu...")

        model, new_label_map, accuracy, accuracy_type, category_metrics = await setfit_service.train(
            categories=categories,
            backbone_model_path=backbone,
            num_iterations=num_iterations,
        )

        # Save as new version of the same model lineage
        new_model_id = str(uuid.uuid4())[:12]
        model_name = saved_meta.get("name", "Model") + " (retrained)"
        total_examples = sum(len(c.get("examples", [])) for c in categories)

        setfit_service.save_model(
            model=model,
            label_map=new_label_map,
            metadata={
                "name": model_name,
                "backbone": backbone,
                "categoryCount": len(categories),
                "accuracy": accuracy,
                "categories": categories,
                "parentModelId": source_model_id,
            },
            model_id=new_model_id,
        )

        # Get version number from parent
        registry = ModelRegistry.get_instance()
        parent_info = await registry.get_model_info(source_model_id)
        parent_version = parent_info.get("currentVersion", 1) if parent_info else 1

        await registry.register_model(
            model_id=new_model_id,
            name=model_name,
            backbone=backbone,
            categories=[c["name"] for c in categories],
            accuracy=accuracy,
            version=parent_version + 1,
            accuracy_type=accuracy_type,
            category_metrics=category_metrics,
            corrections_used=corrections_count,
            total_examples=total_examples,
            parent_model_id=source_model_id,
        )

        # Predict on texts if provided
        result_data = None
        if texts:
            await _update_clf_job(job_id, status="predicting", progress="70", currentStep="Klasyfikacja tekstow...")
            docs, confidence_available = await setfit_service.predict(model, texts, new_label_map)
            result_data = {
                "documents": docs,
                "categories": categories,
                "totalDocuments": len(docs),
                "modelId": new_model_id,
                "accuracy": accuracy,
                "confidenceAvailable": confidence_available,
                "categoryMetrics": category_metrics,
                "iteration": parent_version,
            }

        # Complete
        r = await _get_redis()
        updates = {
            "status": "completed",
            "progress": "100",
            "currentStep": "Zakonczone",
            "modelId": new_model_id,
            "accuracy": str(accuracy),
            "accuracyType": accuracy_type,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        await r.hset(_key("clf_job", job_id), mapping=updates)

        if result_data:
            await r.set(
                _key("clf_job", job_id, "result"),
                json.dumps(result_data, ensure_ascii=False),
            )

        await r.srem(_key("active_clf_jobs"), job_id)
        logger.info(
            f"Retrain job {job_id} completed. New model: {new_model_id}, "
            f"Accuracy: {accuracy:.2%}, Corrections: {corrections_count}"
        )

    except Exception as e:
        logger.error(f"Retrain job {job_id} failed: {e}", exc_info=True)
        r = await _get_redis()
        await r.hset(_key("clf_job", job_id), mapping={
            "status": "failed",
            "error": str(e),
            "currentStep": "Blad",
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        })
        await r.srem(_key("active_clf_jobs"), job_id)


@router.post("/classify/retrain")
async def submit_retrain(req: RetrainRequest):
    """Retrain a model with user corrections from active learning."""
    from services import setfit_service

    # Verify source model exists
    try:
        setfit_service.load_model(req.model_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Source model {req.model_id} not found")

    if len(req.corrections) == 0:
        raise HTTPException(status_code=400, detail="At least 1 correction required")

    # Create job
    r = await _get_redis()
    job_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    job_info = {
        "jobId": job_id,
        "status": "queued",
        "progress": "0",
        "currentStep": "Oczekiwanie w kolejce...",
        "categoryCount": "0",
        "createdAt": now,
        "updatedAt": now,
        "error": "",
        "modelId": "",
        "accuracy": "0",
    }

    pipe = r.pipeline()
    pipe.hset(_key("clf_job", job_id), mapping=job_info)
    pipe.sadd(_key("active_clf_jobs"), job_id)
    await pipe.execute()

    corrections_dicts = [c.model_dump(by_alias=True) for c in req.corrections]

    asyncio.create_task(_run_retrain_pipeline(
        job_id=job_id,
        source_model_id=req.model_id,
        corrections=corrections_dicts,
        texts=req.texts,
        num_iterations=req.num_iterations,
    ))

    return {"jobId": job_id, "status": "queued"}


# ---- Model management ----


@router.get("/models")
async def list_models():
    registry = ModelRegistry.get_instance()
    models = await registry.list_models()
    return {"models": models}


@router.get("/models/{model_id}")
async def get_model(model_id: str):
    registry = ModelRegistry.get_instance()
    info = await registry.get_model_info(model_id)
    if not info:
        raise HTTPException(status_code=404, detail="Model not found")
    return info


@router.delete("/models/{model_id}")
async def delete_model(model_id: str):
    registry = ModelRegistry.get_instance()
    deleted = await registry.delete_model(model_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Model not found")
    return {"modelId": model_id, "deleted": True}
