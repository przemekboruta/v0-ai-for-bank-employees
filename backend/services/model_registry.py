"""
Model Registry - Manage saved SetFit models (Redis metadata + filesystem).

Klucze Redis:
  tdh:model:{id}   -> hash { name, backbone, categoryCount, accuracy, savedAt, ... }
  tdh:models        -> set of model IDs
"""

from __future__ import annotations

import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path

import redis.asyncio as aioredis

from config import REDIS_URL, REDIS_PREFIX, MODELS_DIR

logger = logging.getLogger(__name__)


class ModelRegistry:
    _instance: ModelRegistry | None = None
    _redis: aioredis.Redis | None = None

    @classmethod
    def get_instance(cls) -> ModelRegistry:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(REDIS_URL, decode_responses=True)
        return self._redis

    def _key(self, *parts: str) -> str:
        return REDIS_PREFIX + ":".join(parts)

    async def register_model(
        self,
        model_id: str,
        name: str,
        backbone: str,
        categories: list[str],
        accuracy: float,
        version: int = 1,
        accuracy_type: str = "training",
        category_metrics: list[dict] | None = None,
        corrections_used: int = 0,
        total_examples: int = 0,
        parent_model_id: str | None = None,
    ) -> dict:
        r = await self._get_redis()
        now = datetime.now(timezone.utc).isoformat()

        info = {
            "modelId": model_id,
            "name": name,
            "backbone": backbone,
            "categoryCount": str(len(categories)),
            "categories": json.dumps(categories, ensure_ascii=False),
            "accuracy": str(accuracy),
            "savedAt": now,
            "currentVersion": str(version),
            "parentModelId": parent_model_id or "",
        }

        # Store version entry
        version_entry = {
            "version": version,
            "modelId": model_id,
            "accuracy": accuracy,
            "accuracyType": accuracy_type,
            "categoryMetrics": category_metrics,
            "correctionsUsed": corrections_used,
            "totalExamples": total_examples,
            "savedAt": now,
        }

        pipe = r.pipeline()
        pipe.hset(self._key("model", model_id), mapping=info)
        pipe.sadd(self._key("models"), model_id)
        # Store version in a list for this model lineage
        lineage_key = self._key("model_versions", parent_model_id or model_id)
        pipe.rpush(lineage_key, json.dumps(version_entry, ensure_ascii=False))
        await pipe.execute()

        logger.info(f"Model {model_id} registered: {name} (v{version})")
        return {
            "modelId": model_id,
            "name": name,
            "backbone": backbone,
            "categoryCount": len(categories),
            "categories": categories,
            "accuracy": accuracy,
            "savedAt": now,
            "currentVersion": version,
        }

    async def list_models(self) -> list[dict]:
        r = await self._get_redis()
        ids = await r.smembers(self._key("models"))
        results = []
        for model_id in ids:
            info = await self.get_model_info(model_id)
            if info:
                results.append(info)
        results.sort(key=lambda m: m.get("savedAt", ""), reverse=True)
        return results

    async def get_model_info(self, model_id: str) -> dict | None:
        r = await self._get_redis()
        data = await r.hgetall(self._key("model", model_id))
        if not data:
            return None

        categories = []
        if "categories" in data:
            try:
                categories = json.loads(data["categories"])
            except json.JSONDecodeError:
                pass

        # Load version history
        parent_id = data.get("parentModelId", "") or model_id
        lineage_key = self._key("model_versions", parent_id)
        raw_versions = await r.lrange(lineage_key, 0, -1)
        versions = []
        for rv in raw_versions:
            try:
                versions.append(json.loads(rv))
            except json.JSONDecodeError:
                pass
        versions.sort(key=lambda v: v.get("version", 0), reverse=True)

        return {
            "modelId": data.get("modelId", model_id),
            "name": data.get("name", ""),
            "backbone": data.get("backbone", ""),
            "categoryCount": int(data.get("categoryCount", "0")),
            "categories": categories,
            "accuracy": float(data.get("accuracy", "0")),
            "savedAt": data.get("savedAt", ""),
            "currentVersion": int(data.get("currentVersion", "1")),
            "versions": versions,
        }

    async def delete_model(self, model_id: str) -> bool:
        r = await self._get_redis()
        exists = await r.exists(self._key("model", model_id))
        if not exists:
            return False

        pipe = r.pipeline()
        pipe.delete(self._key("model", model_id))
        pipe.srem(self._key("models"), model_id)
        await pipe.execute()

        # Delete filesystem files
        model_dir = MODELS_DIR / model_id
        if model_dir.exists():
            shutil.rmtree(model_dir)

        logger.info(f"Model {model_id} deleted")
        return True

    async def close(self) -> None:
        if self._redis:
            await self._redis.close()
            self._redis = None
