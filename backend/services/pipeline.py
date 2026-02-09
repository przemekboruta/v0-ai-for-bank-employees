"""
Pipeline Service - Orchestrator with Redis job queue support.
Supports cached embeddings for instant reclustering.
"""

from __future__ import annotations

import asyncio
import logging
import time

import numpy as np

from services.encoder import EncoderService
from services.clustering import ClusteringService
from services.llm import LLMService
from services.job_queue import JobQueueService
from config import CLUSTER_COLORS

logger = logging.getLogger(__name__)


class PipelineService:
    """
    Orchestrates: Encoder -> DimReduce -> Cluster -> Coherence -> Keywords -> LLM
    With Redis job queue for async processing and embedding cache.
    """

    def __init__(self) -> None:
        self.encoder = EncoderService.get_instance()
        self.clustering = ClusteringService()
        self.llm = LLMService()
        self.jobs = JobQueueService.get_instance()

    async def submit_job(self, texts: list[str], config: dict) -> str:
        """Submit a new clustering job to the queue. Returns job_id."""
        job_id = await self.jobs.create_job(texts, config)
        asyncio.create_task(self._process_job(job_id))
        return job_id

    async def submit_recluster(self, source_job_id: str, config: dict) -> str:
        """
        Submit a reclustering job that reuses embeddings from a previous job.
        Much faster because embedding computation (the slowest step) is skipped.
        """
        texts = await self.jobs.get_texts(source_job_id)
        if texts is None:
            raise ValueError(f"Teksty dla joba {source_job_id} nie zostaly znalezione w cache")

        config["useCachedEmbeddings"] = True
        config["cachedJobId"] = source_job_id
        job_id = await self.jobs.create_job(texts, config)
        asyncio.create_task(self._process_job(job_id))
        return job_id

    async def _process_job(self, job_id: str) -> None:
        """Background task: run the full pipeline for a job."""
        try:
            job_info = await self.jobs.get_job(job_id)
            if not job_info:
                return

            config = job_info.get("config", {})
            texts = await self.jobs.get_texts(job_id)
            if not texts:
                await self.jobs.fail_job(job_id, "Teksty nie znalezione")
                return

            pipeline_start = time.time()
            algorithm = config.get("algorithm", "hdbscan")
            dim_reduction = config.get("dimReduction", "umap")
            dim_target = config.get("dimReductionTarget", 50)
            granularity = config.get("granularity", "medium")
            num_clusters = config.get("numClusters")
            min_cluster_size = config.get("minClusterSize", 5)
            cached_job_id = config.get("cachedJobId")
            use_cached = config.get("useCachedEmbeddings", False) and cached_job_id
            iteration = int(job_info.get("iteration", 0))
            seed = 42 + iteration

            # === Step 1: Embeddings (or cache) ===
            if use_cached:
                await self.jobs.update_job(
                    job_id, status="embedding", progress=5,
                    current_step="Ladowanie embeddingów z cache..."
                )
                embeddings = await self.jobs.get_cached_embeddings(cached_job_id)
                if embeddings is None:
                    # Cache miss -- recompute
                    logger.warning(f"Cache miss for {cached_job_id}, recomputing")
                    await self.jobs.update_job(
                        job_id, current_step="Cache miss -- generowanie embeddingów od nowa..."
                    )
                    embeddings = self.encoder.encode(texts)
                    await self.jobs.cache_embeddings(job_id, embeddings)
                else:
                    logger.info(f"Using cached embeddings from job {cached_job_id}")
                    # Copy to this job too for future reuse
                    await self.jobs.cache_embeddings(job_id, embeddings)
            else:
                await self.jobs.update_job(
                    job_id, status="embedding", progress=5,
                    current_step=f"Generowanie embeddingów ({len(texts)} tekstów)..."
                )
                embeddings = self.encoder.encode(texts)
                await self.jobs.cache_embeddings(job_id, embeddings)

            await self.jobs.update_job(job_id, progress=35)

            # === Step 2: Dimensionality reduction (pre-clustering) ===
            await self.jobs.update_job(
                job_id, status="reducing", progress=40,
                current_step=f"Redukcja wymiarów ({dim_reduction.upper()} -> {dim_target}D)..."
            )
            reduced = self.clustering.reduce_for_clustering(
                embeddings, method=dim_reduction, target_dims=dim_target, seed=seed
            )

            # Always reduce to 2D for visualization
            coords_2d = self.clustering.reduce_to_2d(embeddings, seed=seed)

            await self.jobs.update_job(job_id, progress=55)

            # === Step 3: Clustering ===
            await self.jobs.update_job(
                job_id, status="clustering", progress=60,
                current_step=f"Klasteryzacja ({algorithm.upper()})..."
            )
            labels, probabilities = self.clustering.cluster(
                reduced,
                algorithm=algorithm,
                granularity=granularity,
                num_clusters=num_clusters,
                min_cluster_size=min_cluster_size,
            )
            noise_count = int((labels == -1).sum())

            await self.jobs.update_job(job_id, progress=70)

            # === Step 4: Coherence + topics ===
            await self.jobs.update_job(
                job_id, progress=75,
                current_step="Obliczanie koherencji i budowanie topikow..."
            )
            coherence_scores = self.clustering.compute_coherence(reduced, labels)
            topics = self.clustering.build_topics(
                embeddings, coords_2d, labels, texts, coherence_scores
            )
            documents = self.clustering.build_documents(texts, labels, coords_2d)

            # === Step 5: LLM labeling ===
            await self.jobs.update_job(
                job_id, status="labeling", progress=80,
                current_step="LLM generuje etykiety i sugestie..."
            )
            topics = await self.llm.label_all_clusters(topics)
            refinement = await self.llm.generate_refinement_suggestions(
                topics=topics,
                total_docs=len(texts),
                noise_count=noise_count,
                focus_areas=["coherence", "granularity", "naming"],
            )

            # === Build clustering params for meta ===
            from config import GRANULARITY_CONFIG
            if algorithm == "hdbscan":
                clustering_params = GRANULARITY_CONFIG.get(granularity, {}).copy()
                clustering_params["min_cluster_size"] = max(
                    min_cluster_size, clustering_params.get("min_cluster_size", 5)
                )
            else:
                clustering_params = {
                    "n_clusters": num_clusters or {"low": 4, "medium": 7, "high": 12}.get(granularity, 7),
                    "min_cluster_size": min_cluster_size,
                }

            pipeline_duration = int((time.time() - pipeline_start) * 1000)

            result = {
                "documents": documents,
                "topics": topics,
                "llmSuggestions": refinement["suggestions"],
                "totalDocuments": len(texts),
                "noise": noise_count,
                "jobId": job_id,
                "meta": {
                    "pipelineDurationMs": pipeline_duration,
                    "encoderModel": self.encoder.model_name,
                    "algorithm": algorithm,
                    "dimReduction": dim_reduction,
                    "dimReductionTarget": dim_target,
                    "clusteringParams": clustering_params,
                    "llmModel": self.llm.model,
                    "iteration": iteration,
                    "usedCachedEmbeddings": bool(use_cached),
                },
            }

            await self.jobs.complete_job(job_id, result)

            logger.info(
                f"[Pipeline] Job {job_id} done in {pipeline_duration}ms: "
                f"{len(topics)} clusters, {noise_count} noise, "
                f"cached={'yes' if use_cached else 'no'}"
            )

        except Exception as e:
            logger.exception(f"[Pipeline] Job {job_id} failed: {e}")
            await self.jobs.fail_job(job_id, str(e))

    # ---- Synchronous ops (merge/split/reclassify) stay the same ----

    async def merge_clusters(
        self, cluster_ids: list[int], new_label: str,
        documents: list[dict], topics: list[dict],
    ) -> dict:
        if len(cluster_ids) < 2:
            raise ValueError("Potrzeba co najmniej 2 klastrow")

        target_id = min(cluster_ids)
        merge_set = set(cluster_ids)
        affected = 0
        for doc in documents:
            if doc.get("clusterId") in merge_set:
                doc["clusterId"] = target_id
                affected += 1

        merged_topics = [t for t in topics if t["id"] in merge_set]
        remaining = [t for t in topics if t["id"] not in merge_set]
        merged_docs = [d for d in documents if d.get("clusterId") == target_id]

        cx = sum(d["x"] for d in merged_docs) / len(merged_docs) if merged_docs else 50
        cy = sum(d["y"] for d in merged_docs) / len(merged_docs) if merged_docs else 50

        all_kw = []
        for t in merged_topics:
            all_kw.extend(t.get("keywords", []))
        all_samples = []
        for t in merged_topics:
            all_samples.extend(t.get("sampleTexts", []))

        total = sum(t.get("documentCount", 0) for t in merged_topics)
        wc = sum(t.get("coherenceScore", .5) * t.get("documentCount", 0) for t in merged_topics)
        coh = wc / total if total > 0 else .5

        new_topic = {
            "id": target_id, "label": new_label,
            "description": f"Polaczenie klastrow {cluster_ids}",
            "documentCount": len(merged_docs),
            "sampleTexts": all_samples[:5],
            "color": CLUSTER_COLORS[target_id % len(CLUSTER_COLORS)],
            "centroidX": round(cx, 2), "centroidY": round(cy, 2),
            "coherenceScore": round(coh, 3),
            "keywords": list(dict.fromkeys(all_kw))[:7],
        }
        final = sorted(remaining + [new_topic], key=lambda t: t["id"])
        noise = sum(1 for d in documents if d.get("clusterId") == -1)

        return {
            "documents": documents, "topics": final, "llmSuggestions": [],
            "totalDocuments": len(documents), "noise": noise,
            "mergeInfo": {
                "mergedClusterIds": cluster_ids, "newClusterId": target_id,
                "newLabel": new_label, "documentsAffected": affected,
            },
        }

    async def split_cluster(
        self, cluster_id: int, num_subclusters: int,
        documents: list[dict], topics: list[dict],
    ) -> dict:
        cluster_docs = [d for d in documents if d.get("clusterId") == cluster_id]
        other_docs = [d for d in documents if d.get("clusterId") != cluster_id]

        if len(cluster_docs) < num_subclusters * 3:
            raise ValueError(f"Za malo dokumentow ({len(cluster_docs)})")

        coords = np.array([[d["x"], d["y"]] for d in cluster_docs])
        kmeans = KMeans(n_clusters=num_subclusters, random_state=42, n_init=10)
        sub_labels = kmeans.fit_predict(coords)

        max_id = max(t["id"] for t in topics) if topics else 0
        new_ids = [max_id + 1 + i for i in range(num_subclusters)]
        old_topic = next((t for t in topics if t["id"] == cluster_id), None)

        for doc, sl in zip(cluster_docs, sub_labels):
            doc["clusterId"] = new_ids[sl]

        remaining = [t for t in topics if t["id"] != cluster_id]
        new_topics = []
        for i, nid in enumerate(new_ids):
            sub = [d for d in cluster_docs if d.get("clusterId") == nid]
            if not sub:
                continue
            cx = sum(d["x"] for d in sub) / len(sub)
            cy = sum(d["y"] for d in sub) / len(sub)
            base = old_topic["label"] if old_topic else f"Klaster {cluster_id}"
            new_topics.append({
                "id": nid, "label": f"{base} (podgrupa {i+1})",
                "description": f"Podgrupa {i+1} z '{base}'",
                "documentCount": len(sub),
                "sampleTexts": [d["text"] for d in sub[:5]],
                "color": CLUSTER_COLORS[nid % len(CLUSTER_COLORS)],
                "centroidX": round(cx, 2), "centroidY": round(cy, 2),
                "coherenceScore": 0.7,
                "keywords": old_topic.get("keywords", [])[:5] if old_topic else [],
            })

        final = sorted(remaining + new_topics, key=lambda t: t["id"])
        all_docs = other_docs + cluster_docs
        noise = sum(1 for d in all_docs if d.get("clusterId") == -1)

        return {
            "documents": all_docs, "topics": final, "llmSuggestions": [],
            "totalDocuments": len(all_docs), "noise": noise,
            "splitInfo": {
                "originalClusterId": cluster_id,
                "newClusterIds": [t["id"] for t in new_topics],
                "numSubclusters": num_subclusters,
                "documentsAffected": len(cluster_docs),
            },
        }

    async def reclassify_documents(
        self, document_ids: list[str], from_id: int, to_id: int,
        documents: list[dict], topics: list[dict],
    ) -> dict:
        ids_set = set(document_ids)
        affected = 0
        for doc in documents:
            if doc["id"] in ids_set and doc.get("clusterId") == from_id:
                doc["clusterId"] = to_id
                affected += 1
        for t in topics:
            t["documentCount"] = sum(1 for d in documents if d.get("clusterId") == t["id"])
        noise = sum(1 for d in documents if d.get("clusterId") == -1)
        return {
            "documents": documents, "topics": topics, "llmSuggestions": [],
            "totalDocuments": len(documents), "noise": noise,
            "reclassifyInfo": {
                "documentIds": document_ids, "fromClusterId": from_id,
                "toClusterId": to_id, "documentsAffected": affected,
            },
        }
