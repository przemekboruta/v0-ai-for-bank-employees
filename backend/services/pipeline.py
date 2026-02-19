"""
Pipeline Service - Orchestrator with Redis job queue support.
Supports cached embeddings for instant reclustering.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

import numpy as np
from sklearn.cluster import KMeans

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

    async def _encode_with_progress(self, job_id: str, texts: list[str], config: dict) -> np.ndarray:
        """
        Encode texts in executor with progress updates.
        If config has encoderModel (and optionally encoderPrefix), use that single model; else default.
        """
        import queue
        import threading

        progress_queue: queue.Queue = queue.Queue()
        result_queue: queue.Queue = queue.Queue()
        error_queue: queue.Queue = queue.Queue()
        encoder_model = config.get("encoderModel") or config.get("encoder_model")
        encoder_prefix = config.get("encoderPrefix") or config.get("encoder_prefix") or ""

        def encode_task():
            """Run encoding in thread with progress callbacks."""
            try:

                def progress_callback(batch_num: int, total_batches: int, processed: int, total: int):
                    """Callback to report progress."""
                    progress_queue.put((batch_num, total_batches, processed, total))

                if encoder_model:
                    result = self.encoder.encode_single_model(
                        texts,
                        model_name=encoder_model,
                        prefix=encoder_prefix,
                        progress_callback=progress_callback,
                    )
                else:
                    result = self.encoder.encode(texts, progress_callback=progress_callback)
                result_queue.put(result)
            except Exception as e:
                error_queue.put(e)

        # Start encoding in thread
        encode_thread = threading.Thread(target=encode_task, daemon=True)
        encode_thread.start()

        # Monitor progress and update job status
        last_progress = 5

        while True:
            # Check for completion
            if not encode_thread.is_alive():
                if not error_queue.empty():
                    raise error_queue.get()
                if not result_queue.empty():
                    return result_queue.get()

            # Update progress from queue
            try:
                while True:
                    batch_num, total_batches, processed, total = progress_queue.get_nowait()
                    # Progress from 5% to 35% during embedding
                    progress = 5 + int(30 * processed / total) if total > 0 else 5
                    if progress != last_progress:
                        await self.jobs.update_job(
                            job_id,
                            progress=progress,
                            current_step=f"Generowanie embeddingów: {processed}/{total} tekstów ({batch_num}/{total_batches} batchy)...",
                        )
                        last_progress = progress
            except queue.Empty:
                pass

            # Small sleep to avoid busy waiting
            await asyncio.sleep(0.1)

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
            # When user set "orientacyjna liczba kategorii" for HDBSCAN, tune min_cluster_size to aim for ~that many clusters + noise
            hdbscan_target = config.get("hdbscanTargetClusters")
            if algorithm == "hdbscan" and hdbscan_target is not None and len(texts) > 0:
                # Smaller min_cluster_size -> more clusters. Heuristic: aim for ~target clusters.
                from config import GRANULARITY_CONFIG
                base = GRANULARITY_CONFIG.get(granularity, {}).get("min_cluster_size", 20)
                inferred = max(3, min(50, len(texts) // max(1, int(hdbscan_target) * 2)))
                min_cluster_size = min(base, inferred)
                logger.info(f"HDBSCAN target ~{hdbscan_target} clusters -> min_cluster_size={min_cluster_size}")
            cached_job_id = config.get("cachedJobId")
            use_cached = config.get("useCachedEmbeddings", False) and cached_job_id
            iteration = int(job_info.get("iteration", 0))
            seed = 42 + iteration

            # === Step 1: Embeddings (or cache) ===
            if use_cached:
                await self.jobs.update_job(
                    job_id, status="embedding", progress=5, current_step="Ładowanie embeddingów z cache..."
                )
                embeddings = await self.jobs.get_cached_embeddings(cached_job_id)
                if embeddings is None:
                    # Cache miss -- recompute
                    logger.warning(f"Cache miss for {cached_job_id}, recomputing")
                    await self.jobs.update_job(job_id, current_step="Cache miss -- generowanie embeddingów od nowa...")
                    # Run encoding in executor with progress updates
                    embeddings = await self._encode_with_progress(job_id, texts, config)
                    await self.jobs.cache_embeddings(job_id, embeddings)
                else:
                    logger.info(f"Using cached embeddings from job {cached_job_id}")
                    # Copy to this job too for future reuse
                    await self.jobs.cache_embeddings(job_id, embeddings)
            else:
                await self.jobs.update_job(
                    job_id,
                    status="embedding",
                    progress=5,
                    current_step=f"Generowanie embeddingów ({len(texts)} tekstów)...",
                )
                # Run encoding in executor with progress updates
                embeddings = await self._encode_with_progress(job_id, texts, config)
                await self.jobs.cache_embeddings(job_id, embeddings)

            await self.jobs.update_job(job_id, progress=35)

            # === Step 2: BERTopic (UMAP + clustering) + 2D for viz ===
            await self.jobs.update_job(
                job_id,
                status="reducing",
                progress=40,
                current_step="Klasteryzacja BERTopic (UMAP + " + algorithm.upper() + ")...",
            )
            labels, probabilities, topic_model = await asyncio.to_thread(
                lambda: self.clustering.fit_bertopic(
                    texts,
                    embeddings,
                    algorithm=algorithm,
                    granularity=granularity,
                    num_clusters=num_clusters,
                    min_cluster_size=min_cluster_size,
                    seed=seed,
                )
            )
            noise_count = int((labels == -1).sum())

            # Always reduce to 2D for visualization (on original embeddings)
            coords_2d = await asyncio.to_thread(
                lambda: self.clustering.reduce_to_2d(embeddings, seed=seed)
            )

            await self.jobs.update_job(job_id, progress=60)

            # === Step 3: Coherence + topics (keywords/samples from BERTopic) ===
            await self.jobs.update_job(
                job_id, progress=70, current_step="Obliczanie koherencji i budowanie topikow..."
            )
            coherence_scores = await asyncio.to_thread(
                lambda: self.clustering.compute_coherence(embeddings, labels)
            )
            topics = await asyncio.to_thread(
                lambda: self.clustering.build_topics(
                    embeddings, coords_2d, labels, texts, coherence_scores, topic_model=topic_model
                )
            )
            documents = await asyncio.to_thread(
                lambda: self.clustering.build_documents(texts, labels, coords_2d)
            )

            # === Step 5: LLM labeling ===
            await self.jobs.update_job(
                job_id, status="labeling", progress=80, current_step="LLM generuje etykiety i sugestie..."
            )
            topics = await self.llm.label_all_clusters(topics)

            # Add noise as a full topic when HDBSCAN produced noise (clusterId -1)
            if noise_count > 0:
                noise_docs = [d for d in documents if d.get("clusterId") == -1]
                n = len(noise_docs)
                cx = sum(d["x"] for d in noise_docs) / n if n else 50.0
                cy = sum(d["y"] for d in noise_docs) / n if n else 50.0
                samples = [d["text"][:200] for d in noise_docs[:5]]
                topics.append({
                    "id": -1,
                    "label": "Szum",
                    "description": "Dokumenty nieskategoryzowane (outliers).",
                    "documentCount": n,
                    "sampleTexts": samples,
                    "color": "hsl(0, 0%, 55%)",
                    "centroidX": round(cx, 2),
                    "centroidY": round(cy, 2),
                    "coherenceScore": 0,
                    "keywords": [],
                })
                topics = sorted(topics, key=lambda t: t["id"])

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
                    "encoderModel": self.encoder.get_display_name(
                        config.get("encoderModel") or config.get("encoder_model"),
                        config.get("encoderPrefix") or config.get("encoder_prefix"),
                    ),
                    "algorithm": algorithm,
                    "dimReduction": dim_reduction,
                    "dimReductionTarget": dim_target,
                    "clusteringParams": clustering_params,
                    "llmModel": self.llm.model,
                    "iteration": iteration,
                    "usedCachedEmbeddings": bool(use_cached),
                    "completedAt": datetime.now(timezone.utc).isoformat(),
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
        self,
        cluster_ids: list[int],
        new_label: str,
        documents: list[dict],
        topics: list[dict],
        job_id: str | None = None,
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
        wc = sum(t.get("coherenceScore", 0.5) * t.get("documentCount", 0) for t in merged_topics)
        coh = wc / total if total > 0 else 0.5

        new_topic = {
            "id": target_id,
            "label": new_label,
            "description": f"Polaczenie klastrow {cluster_ids}",
            "documentCount": len(merged_docs),
            "sampleTexts": all_samples[:5],
            "color": CLUSTER_COLORS[target_id % len(CLUSTER_COLORS)],
            "centroidX": round(cx, 2),
            "centroidY": round(cy, 2),
            "coherenceScore": round(coh, 3),
            "keywords": list(dict.fromkeys(all_kw))[:7],
        }
        final = sorted(remaining + [new_topic], key=lambda t: t["id"])
        noise = sum(1 for d in documents if d.get("clusterId") == -1)

        result = {
            "documents": documents,
            "topics": final,
            "llmSuggestions": [],
            "totalDocuments": len(documents),
            "noise": noise,
            "mergeInfo": {
                "mergedClusterIds": cluster_ids,
                "newClusterId": target_id,
                "newLabel": new_label,
                "documentsAffected": affected,
            },
        }

        # Update result in Redis if job_id provided
        if job_id:
            # Get existing result to preserve jobId and meta
            existing_result = await self.jobs.get_result(job_id)
            if existing_result:
                result["jobId"] = existing_result.get("jobId") or job_id
                result["meta"] = existing_result.get("meta", {})
            else:
                result["jobId"] = job_id
                result["meta"] = {}
            await self.jobs.update_result(job_id, result)

        return result

    async def reclassify_documents(
        self,
        from_ids: list[int],
        num_clusters: int,
        documents: list[dict],
        topics: list[dict],
        job_id: str | None = None,
        generate_labels: bool = True,
    ) -> dict:
        from_set = set(from_ids)

        # Automatically find all documents from source clusters
        docs_to_reclassify = [d for d in documents if d.get("clusterId") in from_set]
        other_docs = [d for d in documents if d.get("clusterId") not in from_set]

        if len(docs_to_reclassify) < num_clusters * 3:
            raise ValueError(f"Za mało dokumentów ({len(docs_to_reclassify)}) dla {num_clusters} klastrów")

        # Get embeddings and run KMeans
        new_labels = None
        if job_id:
            try:
                all_embeddings = await self.jobs.get_cached_embeddings(job_id)
                texts = await self.jobs.get_texts(job_id)

                if all_embeddings is not None and texts is not None:
                    # Map document IDs to indices
                    doc_id_to_idx = {doc["id"]: i for i, doc in enumerate(documents)}
                    # Get indices of documents to reclassify
                    reclassify_indices = [
                        doc_id_to_idx[doc["id"]] for doc in docs_to_reclassify if doc["id"] in doc_id_to_idx
                    ]
                    # Get embeddings for documents to reclassify
                    reclassify_embeddings = all_embeddings[reclassify_indices]

                    # Run KMeans on embeddings
                    kmeans = KMeans(n_clusters=num_clusters, random_state=42, n_init=10)
                    new_labels = await asyncio.to_thread(kmeans.fit_predict, reclassify_embeddings)
            except Exception as e:
                logger.warning(f"Failed to use embeddings for reclassify, using 2D coords: {e}")

        # Fallback to 2D coords if no embeddings
        if new_labels is None:
            coords = np.array([[d["x"], d["y"]] for d in docs_to_reclassify])
            kmeans = KMeans(n_clusters=num_clusters, random_state=42, n_init=10)
            new_labels = await asyncio.to_thread(kmeans.fit_predict, coords)

        # Generate new cluster IDs
        max_id = max(t["id"] for t in topics) if topics else 0
        new_ids = [max_id + 1 + i for i in range(num_clusters)]

        # Assign documents to new clusters
        for doc, label in zip(docs_to_reclassify, new_labels):
            doc["clusterId"] = new_ids[label]

        # Remove old topics
        remaining_topics = [t for t in topics if t["id"] not in from_set]

        # Compute coherence for all clusters (same as initial pipeline) when we have embeddings
        coherence_scores: dict[int, float] = {}
        if job_id:
            try:
                all_embeddings = await self.jobs.get_cached_embeddings(job_id)
                if all_embeddings is not None and len(all_embeddings) > 0:
                    # Build labels array in job/embedding order (backend uses id "doc-{i}" for i-th doc)
                    doc_id_to_cluster = {d["id"]: d["clusterId"] for d in documents}
                    n_emb = len(all_embeddings)
                    labels_arr = np.array(
                        [doc_id_to_cluster.get(f"doc-{j}", -1) for j in range(n_emb)],
                        dtype=np.int64,
                    )
                    coherence_scores = await asyncio.to_thread(
                        self.clustering.compute_coherence, all_embeddings, labels_arr
                    )
            except Exception as e:
                logger.warning(f"Failed to compute coherence after reclassify: {e}")

        # Recalculate 2D coordinates if we have embeddings
        if job_id:
            try:
                all_embeddings = await self.jobs.get_cached_embeddings(job_id)
                if all_embeddings is not None:
                    # Recalculate 2D coords for all documents
                    coords_2d = await asyncio.to_thread(self.clustering.reduce_to_2d, all_embeddings, 42)
                    # Normalize coords
                    x_min, x_max = coords_2d[:, 0].min(), coords_2d[:, 0].max()
                    y_min, y_max = coords_2d[:, 1].min(), coords_2d[:, 1].max()
                    x_range = x_max - x_min if x_max != x_min else 1.0
                    y_range = y_max - y_min if y_max != y_min else 1.0

                    # Update document coordinates
                    doc_id_to_idx = {doc["id"]: i for i, doc in enumerate(documents)}
                    for doc in documents:
                        if doc["id"] in doc_id_to_idx:
                            idx = doc_id_to_idx[doc["id"]]
                            x_norm = 5 + 90 * (coords_2d[idx, 0] - x_min) / x_range
                            y_norm = 5 + 90 * (coords_2d[idx, 1] - y_min) / y_range
                            doc["x"] = round(float(x_norm), 2)
                            doc["y"] = round(float(y_norm), 2)
            except Exception as e:
                logger.warning(f"Failed to recalculate 2D coords after reclassify: {e}")

        # Build new topics; use LLM labeling only when generate_labels is True
        new_topics = []
        all_documents = other_docs + docs_to_reclassify

        def make_default_topic(i: int, new_id: int, cluster_docs: list[dict]) -> dict:
            cx = sum(d["x"] for d in cluster_docs) / len(cluster_docs)
            cy = sum(d["y"] for d in cluster_docs) / len(cluster_docs)
            coh = round(coherence_scores.get(new_id, 0.5), 3)
            return {
                "id": new_id,
                "label": f"Klaster {new_id}",
                "description": f"Nowy klaster {i+1}",
                "documentCount": len(cluster_docs),
                "sampleTexts": [d.get("text", "") for d in cluster_docs[:5]],
                "color": CLUSTER_COLORS[new_id % len(CLUSTER_COLORS)],
                "centroidX": round(cx, 2),
                "centroidY": round(cy, 2),
                "coherenceScore": coh,
                "keywords": [],
            }

        use_llm_success = False
        if job_id and generate_labels:
            try:
                texts = await self.jobs.get_texts(job_id)
                all_embeddings = await self.jobs.get_cached_embeddings(job_id)

                if texts is not None and all_embeddings is not None:
                    doc_id_to_idx = {doc["id"]: i for i, doc in enumerate(documents)}

                    for i, new_id in enumerate(new_ids):
                        cluster_docs = [d for d in docs_to_reclassify if d.get("clusterId") == new_id]
                        if not cluster_docs:
                            continue

                        cluster_texts = []
                        cluster_indices = []
                        for doc in cluster_docs:
                            if doc["id"] in doc_id_to_idx:
                                idx = doc_id_to_idx[doc["id"]]
                                cluster_indices.append(idx)
                                cluster_texts.append(texts[idx])

                        if not cluster_texts:
                            continue

                        cx = sum(d["x"] for d in cluster_docs) / len(cluster_docs)
                        cy = sum(d["y"] for d in cluster_docs) / len(cluster_docs)
                        keywords = self.clustering.extract_keywords(cluster_texts)

                        if cluster_indices and all_embeddings is not None and len(cluster_indices) > 0:
                            try:
                                temp_labels = np.full(len(documents), -1)
                                for idx in cluster_indices:
                                    temp_labels[idx] = new_id
                                samples = self.clustering.get_representative_samples(
                                    all_embeddings, temp_labels, texts, new_id, n=5
                                )
                            except Exception as e:
                                logger.warning(f"Failed to get representative samples: {e}")
                                samples = cluster_texts[:5]
                        else:
                            samples = cluster_texts[:5]

                        coherence = round(coherence_scores.get(new_id, 0.5), 3)
                        labeled_topic = await self.llm.label_cluster(
                            cluster_id=new_id,
                            doc_count=len(cluster_docs),
                            coherence=coherence,
                            sample_texts=samples,
                            keywords=keywords,
                        )

                        new_topics.append(
                            {
                                "id": new_id,
                                "label": labeled_topic.get("label", f"Klaster {new_id}"),
                                "description": labeled_topic.get("description", ""),
                                "documentCount": len(cluster_docs),
                                "sampleTexts": samples,
                                "color": CLUSTER_COLORS[new_id % len(CLUSTER_COLORS)],
                                "centroidX": round(cx, 2),
                                "centroidY": round(cy, 2),
                                "coherenceScore": coherence,
                                "keywords": keywords,
                            }
                        )
                        use_llm_success = True
            except Exception as e:
                logger.warning(f"Failed to use LLM for labeling new topics: {e}")
                for i, new_id in enumerate(new_ids):
                    cluster_docs = [d for d in docs_to_reclassify if d.get("clusterId") == new_id]
                    if not cluster_docs:
                        continue
                    new_topics.append(make_default_topic(i, new_id, cluster_docs))
        else:
            for i, new_id in enumerate(new_ids):
                cluster_docs = [d for d in docs_to_reclassify if d.get("clusterId") == new_id]
                if not cluster_docs:
                    continue
                new_topics.append(make_default_topic(i, new_id, cluster_docs))

        final_topics = sorted(remaining_topics + new_topics, key=lambda t: t["id"])
        noise = sum(1 for d in all_documents if d.get("clusterId") == -1)

        result = {
            "documents": all_documents,
            "topics": final_topics,
            "llmSuggestions": [],
            "labelsGenerated": use_llm_success,
            "totalDocuments": len(all_documents),
            "noise": noise,
            "reclassifyInfo": {
                "fromClusterIds": from_ids,
                "numClusters": num_clusters,
                "newClusterIds": new_ids,
                "documentsAffected": len(docs_to_reclassify),
            },
        }

        # Update result in Redis if job_id provided
        if job_id:
            existing_result = await self.jobs.get_result(job_id)
            if existing_result:
                result["jobId"] = existing_result.get("jobId") or job_id
                result["meta"] = existing_result.get("meta", {})
            else:
                result["jobId"] = job_id
                result["meta"] = {}
            await self.jobs.update_result(job_id, result)

        return result
