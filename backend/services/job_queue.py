"""
Job Queue Service - Redis-backed asynchronous job processing.

Embeddingi sa cache'owane w Redis, wiec recluster z innymi parametrami
nie wymaga ponownego obliczania embeddingów (najdrozszy krok).

Klucze Redis:
  tdh:job:{job_id}              -> JobInfo (hash)
  tdh:job:{job_id}:result       -> ClusteringResult (JSON string)
  tdh:embeddings:{job_id}       -> numpy embeddings (bytes)
  tdh:texts:{job_id}            -> teksty (JSON list)
  tdh:active_jobs               -> set of active job IDs
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import time
import uuid
from datetime import datetime, timezone

import numpy as np
import redis.asyncio as aioredis

from config import (
    REDIS_URL,
    REDIS_PREFIX,
    EMBEDDING_CACHE_TTL,
    JOB_TTL,
    RESULT_TTL,
    MAX_CONCURRENT_JOBS,
)

logger = logging.getLogger(__name__)


class JobQueueService:
    """Redis-based async job queue for clustering pipeline."""

    _instance: JobQueueService | None = None
    _redis: aioredis.Redis | None = None

    @classmethod
    def get_instance(cls) -> JobQueueService:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(
                REDIS_URL,
                decode_responses=False,  # binary for numpy
            )
        return self._redis

    def _key(self, *parts: str) -> str:
        return REDIS_PREFIX + ":".join(parts)

    # ---- Job lifecycle ----

    async def create_job(
        self,
        texts: list[str],
        config: dict,
    ) -> str:
        """Create a new clustering job, store texts, return job_id."""
        r = await self._get_redis()

        # Check concurrency limit
        active = await r.scard(self._key("active_jobs"))
        if active and int(active) >= MAX_CONCURRENT_JOBS:
            raise RuntimeError(
                f"Osiagnieto limit jednoczesnych zadan ({MAX_CONCURRENT_JOBS}). "
                "Poczekaj na zakonczenie poprzednich."
            )

        job_id = str(uuid.uuid4())[:12]
        now = datetime.now(timezone.utc).isoformat()

        job_info = {
            "jobId": job_id,
            "status": "queued",
            "progress": 0.0,
            "currentStep": "Oczekiwanie w kolejce...",
            "createdAt": now,
            "updatedAt": now,
            "config": json.dumps(config),
            "textCount": len(texts),
            "error": "",
        }

        pipe = r.pipeline()
        pipe.hset(self._key("job", job_id), mapping={
            k: str(v) if not isinstance(v, str) else v
            for k, v in job_info.items()
        })
        pipe.expire(self._key("job", job_id), JOB_TTL)

        # Store texts
        pipe.set(
            self._key("texts", job_id),
            json.dumps(texts, ensure_ascii=False).encode("utf-8"),
        )
        pipe.expire(self._key("texts", job_id), JOB_TTL)

        pipe.sadd(self._key("active_jobs"), job_id)
        await pipe.execute()

        logger.info(f"Job {job_id} created: {len(texts)} texts, config={config}")
        return job_id

    async def update_job(
        self,
        job_id: str,
        status: str | None = None,
        progress: float | None = None,
        current_step: str | None = None,
        error: str | None = None,
    ) -> None:
        """Update job status in Redis."""
        r = await self._get_redis()
        updates: dict[str, str] = {
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        if status:
            updates["status"] = status
        if progress is not None:
            updates["progress"] = str(progress)
        if current_step:
            updates["currentStep"] = current_step
        if error is not None:
            updates["error"] = error

        await r.hset(self._key("job", job_id), mapping=updates)

    async def get_job(self, job_id: str) -> dict | None:
        """Get job info from Redis."""
        r = await self._get_redis()
        data = await r.hgetall(self._key("job", job_id))
        if not data:
            return None

        result = {}
        for k, v in data.items():
            key = k.decode() if isinstance(k, bytes) else k
            val = v.decode() if isinstance(v, bytes) else v
            result[key] = val

        # Parse config back to dict
        if "config" in result:
            try:
                result["config"] = json.loads(result["config"])
            except json.JSONDecodeError:
                result["config"] = {}

        # Parse numeric fields
        if "progress" in result:
            result["progress"] = float(result["progress"])
        if "textCount" in result:
            result["textCount"] = int(result["textCount"])

        return result

    async def complete_job(self, job_id: str, result: dict) -> None:
        """Mark job complete, store result, remove from active set."""
        r = await self._get_redis()

        pipe = r.pipeline()
        pipe.hset(self._key("job", job_id), mapping={
            "status": "completed",
            "progress": "100",
            "currentStep": "Zakonczono",
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        })
        pipe.set(
            self._key("job", job_id, "result"),
            json.dumps(result, ensure_ascii=False, default=str).encode("utf-8"),
        )
        pipe.expire(self._key("job", job_id, "result"), RESULT_TTL)
        pipe.srem(self._key("active_jobs"), job_id)
        await pipe.execute()

        logger.info(f"Job {job_id} completed")

    async def fail_job(self, job_id: str, error: str) -> None:
        """Mark job as failed."""
        r = await self._get_redis()
        pipe = r.pipeline()
        pipe.hset(self._key("job", job_id), mapping={
            "status": "failed",
            "error": error,
            "currentStep": "Blad",
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        })
        pipe.srem(self._key("active_jobs"), job_id)
        await pipe.execute()
        logger.error(f"Job {job_id} failed: {error}")

    async def get_result(self, job_id: str) -> dict | None:
        """Get completed job result."""
        r = await self._get_redis()
        raw = await r.get(self._key("job", job_id, "result"))
        if raw is None:
            return None
        return json.loads(raw)

    async def update_result(self, job_id: str, result: dict) -> None:
        """Update job result in Redis (for merge/split/rename/reclassify operations)."""
        r = await self._get_redis()
        await r.set(
            self._key("job", job_id, "result"),
            json.dumps(result, ensure_ascii=False, default=str).encode("utf-8"),
        )
        await r.expire(self._key("job", job_id, "result"), RESULT_TTL)
        logger.info(f"Job {job_id} result updated")

    async def get_texts(self, job_id: str) -> list[str] | None:
        """Get stored texts for a job."""
        r = await self._get_redis()
        raw = await r.get(self._key("texts", job_id))
        if raw is None:
            return None
        return json.loads(raw)

    async def delete_job(self, job_id: str) -> bool:
        """Delete a job and all associated data (texts, embeddings, result)."""
        r = await self._get_redis()
        
        # Check if job exists
        exists = await r.exists(self._key("job", job_id))
        if not exists:
            return False
        
        # Delete all job-related keys
        pipe = r.pipeline()
        pipe.delete(self._key("job", job_id))
        pipe.delete(self._key("job", job_id, "result"))
        pipe.delete(self._key("texts", job_id))
        pipe.delete(self._key("embeddings", job_id))
        pipe.srem(self._key("active_jobs"), job_id)
        await pipe.execute()
        
        logger.info(f"Job {job_id} deleted")
        return True

    # ---- Embedding cache ----

    async def cache_embeddings(self, job_id: str, embeddings: np.ndarray) -> None:
        """Cache numpy embeddings in Redis as bytes."""
        r = await self._get_redis()
        buf = io.BytesIO()
        np.save(buf, embeddings)
        buf.seek(0)

        pipe = r.pipeline()
        pipe.set(self._key("embeddings", job_id), buf.read())
        pipe.expire(self._key("embeddings", job_id), EMBEDDING_CACHE_TTL)
        await pipe.execute()

        size_mb = embeddings.nbytes / (1024 * 1024)
        logger.info(
            f"Cached embeddings for job {job_id}: "
            f"shape={embeddings.shape}, size={size_mb:.1f}MB"
        )

    async def get_cached_embeddings(self, job_id: str) -> np.ndarray | None:
        """Retrieve cached embeddings from Redis."""
        r = await self._get_redis()
        raw = await r.get(self._key("embeddings", job_id))
        if raw is None:
            return None

        buf = io.BytesIO(raw)
        embeddings = np.load(buf)
        logger.info(f"Loaded cached embeddings for job {job_id}: shape={embeddings.shape}")
        return embeddings

    async def has_cached_embeddings(self, job_id: str) -> bool:
        """Check if embeddings exist in cache."""
        r = await self._get_redis()
        return bool(await r.exists(self._key("embeddings", job_id)))

    # ---- List all known jobs ----

    async def list_jobs(self) -> list[dict]:
        """Return info for all active + recent jobs."""
        r = await self._get_redis()
        results = []

        # Active jobs
        active_ids = await r.smembers(self._key("active_jobs"))
        seen = set()
        for raw_id in active_ids:
            job_id = raw_id.decode() if isinstance(raw_id, bytes) else raw_id
            seen.add(job_id)
            info = await self.get_job(job_id)
            if info:
                results.append(info)

        # Scan for completed/failed jobs not in active set
        # Use SCAN to find tdh:job:* keys
        cursor = 0
        prefix = self._key("job", "")
        while True:
            cursor, keys = await r.scan(cursor, match=f"{prefix}*", count=100)
            for key_raw in keys:
                key = key_raw.decode() if isinstance(key_raw, bytes) else key_raw
                # Skip result sub-keys (tdh:job:xxx:result)
                parts = key.replace(prefix, "").split(":")
                if len(parts) != 1:
                    continue
                job_id = parts[0]
                if job_id in seen:
                    continue
                seen.add(job_id)
                info = await self.get_job(job_id)
                if info:
                    results.append(info)

            if cursor == 0:
                break

        # Sort newest first
        results.sort(
            key=lambda j: j.get("createdAt", ""),
            reverse=True,
        )
        return results

    # ---- Health ----

    async def health_check(self) -> dict:
        try:
            r = await self._get_redis()
            await r.ping()
            active = await r.scard(self._key("active_jobs"))
            return {
                "status": "up",
                "activeJobs": int(active) if active else 0,
                "url": REDIS_URL.split("@")[-1] if "@" in REDIS_URL else REDIS_URL,
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}

    async def close(self) -> None:
        if self._redis:
            await self._redis.close()
            self._redis = None
