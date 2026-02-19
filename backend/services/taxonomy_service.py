"""
Taxonomy Service - Redis-backed CRUD for category taxonomies.

Klucze Redis:
  tdh:taxonomy:{id}          -> hash { name, description, createdAt, updatedAt, categoryCount }
  tdh:taxonomy:{id}:cats     -> JSON [{ id, name, examples[], description }]
  tdh:taxonomies             -> set of taxonomy IDs
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

import redis.asyncio as aioredis

from config import REDIS_URL, REDIS_PREFIX, TAXONOMY_TTL

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).parent.parent / "templates"


class TaxonomyService:
    _instance: TaxonomyService | None = None
    _redis: aioredis.Redis | None = None

    @classmethod
    def get_instance(cls) -> TaxonomyService:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(REDIS_URL, decode_responses=True)
        return self._redis

    def _key(self, *parts: str) -> str:
        return REDIS_PREFIX + ":".join(parts)

    # ---- Taxonomy CRUD ----

    async def create_taxonomy(self, name: str, description: str = "") -> dict:
        r = await self._get_redis()
        tax_id = str(uuid.uuid4())[:12]
        now = datetime.now(timezone.utc).isoformat()

        info = {
            "taxonomyId": tax_id,
            "name": name,
            "description": description,
            "createdAt": now,
            "updatedAt": now,
            "categoryCount": "0",
        }

        pipe = r.pipeline()
        pipe.hset(self._key("taxonomy", tax_id), mapping=info)
        pipe.expire(self._key("taxonomy", tax_id), TAXONOMY_TTL)
        pipe.set(self._key("taxonomy", tax_id, "cats"), json.dumps([], ensure_ascii=False))
        pipe.expire(self._key("taxonomy", tax_id, "cats"), TAXONOMY_TTL)
        pipe.sadd(self._key("taxonomies"), tax_id)
        await pipe.execute()

        logger.info(f"Taxonomy {tax_id} created: {name}")
        return {**info, "categories": [], "categoryCount": 0}

    async def get_taxonomy(self, tax_id: str) -> dict | None:
        r = await self._get_redis()
        data = await r.hgetall(self._key("taxonomy", tax_id))
        if not data:
            return None

        cats_raw = await r.get(self._key("taxonomy", tax_id, "cats"))
        categories = json.loads(cats_raw) if cats_raw else []

        return {
            "taxonomyId": data.get("taxonomyId", tax_id),
            "name": data.get("name", ""),
            "description": data.get("description", ""),
            "categories": categories,
            "categoryCount": len(categories),
            "createdAt": data.get("createdAt", ""),
            "updatedAt": data.get("updatedAt", ""),
        }

    async def list_taxonomies(self) -> list[dict]:
        r = await self._get_redis()
        ids = await r.smembers(self._key("taxonomies"))
        results = []
        for tax_id in ids:
            info = await self.get_taxonomy(tax_id)
            if info:
                results.append(info)
        results.sort(key=lambda t: t.get("createdAt", ""), reverse=True)
        return results

    async def delete_taxonomy(self, tax_id: str) -> bool:
        r = await self._get_redis()
        exists = await r.exists(self._key("taxonomy", tax_id))
        if not exists:
            return False
        pipe = r.pipeline()
        pipe.delete(self._key("taxonomy", tax_id))
        pipe.delete(self._key("taxonomy", tax_id, "cats"))
        pipe.srem(self._key("taxonomies"), tax_id)
        await pipe.execute()
        logger.info(f"Taxonomy {tax_id} deleted")
        return True

    # ---- Category CRUD ----

    async def _save_categories(self, r: aioredis.Redis, tax_id: str, categories: list[dict]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        pipe = r.pipeline()
        pipe.set(self._key("taxonomy", tax_id, "cats"), json.dumps(categories, ensure_ascii=False))
        pipe.expire(self._key("taxonomy", tax_id, "cats"), TAXONOMY_TTL)
        pipe.hset(self._key("taxonomy", tax_id), mapping={
            "updatedAt": now,
            "categoryCount": str(len(categories)),
        })
        await pipe.execute()

    async def add_category(self, tax_id: str, name: str, examples: list[str] | None = None, description: str = "") -> dict:
        r = await self._get_redis()
        cats_raw = await r.get(self._key("taxonomy", tax_id, "cats"))
        categories = json.loads(cats_raw) if cats_raw else []

        cat_id = str(uuid.uuid4())[:8]
        category = {
            "id": cat_id,
            "name": name,
            "examples": examples or [],
            "description": description,
        }
        categories.append(category)
        await self._save_categories(r, tax_id, categories)
        logger.info(f"Category {cat_id} added to taxonomy {tax_id}: {name}")
        return category

    async def update_category(
        self, tax_id: str, cat_id: str,
        name: str | None = None, examples: list[str] | None = None, description: str | None = None
    ) -> dict | None:
        r = await self._get_redis()
        cats_raw = await r.get(self._key("taxonomy", tax_id, "cats"))
        categories = json.loads(cats_raw) if cats_raw else []

        for cat in categories:
            if cat["id"] == cat_id:
                if name is not None:
                    cat["name"] = name
                if examples is not None:
                    cat["examples"] = examples
                if description is not None:
                    cat["description"] = description
                await self._save_categories(r, tax_id, categories)
                return cat
        return None

    async def delete_category(self, tax_id: str, cat_id: str) -> bool:
        r = await self._get_redis()
        cats_raw = await r.get(self._key("taxonomy", tax_id, "cats"))
        categories = json.loads(cats_raw) if cats_raw else []

        new_cats = [c for c in categories if c["id"] != cat_id]
        if len(new_cats) == len(categories):
            return False
        await self._save_categories(r, tax_id, new_cats)
        logger.info(f"Category {cat_id} deleted from taxonomy {tax_id}")
        return True

    # ---- Import helpers ----

    async def import_from_clustering(self, tax_id: str, cluster_ids: list[int], clustering_result: dict) -> list[dict]:
        """Promote clusters to taxonomy categories: label -> name, sample_texts -> examples."""
        topics = clustering_result.get("topics", [])
        added = []
        for topic in topics:
            tid = topic.get("id")
            if tid not in cluster_ids:
                continue
            cat = await self.add_category(
                tax_id,
                name=topic.get("label", f"Klaster {tid}"),
                examples=topic.get("sampleTexts", [])[:10],
                description=topic.get("description", ""),
            )
            added.append(cat)
        return added

    async def import_template(self, tax_id: str, template_name: str) -> list[dict]:
        """Load categories from a JSON template file."""
        template_path = TEMPLATES_DIR / f"{template_name}.json"
        if not template_path.exists():
            raise FileNotFoundError(f"Template not found: {template_name}")

        with open(template_path, "r", encoding="utf-8") as f:
            template = json.load(f)

        added = []
        for cat_def in template.get("categories", []):
            cat = await self.add_category(
                tax_id,
                name=cat_def.get("name", ""),
                examples=cat_def.get("examples", []),
                description=cat_def.get("description", ""),
            )
            added.append(cat)
        return added

    async def close(self) -> None:
        if self._redis:
            await self._redis.close()
            self._redis = None
