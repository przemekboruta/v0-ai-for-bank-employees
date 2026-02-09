"""
Pipeline Service - Orchestrator
Laczy Encoder + Clustering + LLM w jeden pipeline.
"""

from __future__ import annotations

import logging
import time

import numpy as np

from services.encoder import EncoderService
from services.clustering import ClusteringService
from services.llm import LLMService
from config import GRANULARITY_CONFIG, CLUSTER_COLORS

logger = logging.getLogger(__name__)


class PipelineService:
    """
    Orkiestrator calego pipeline'u:
    Encoder -> UMAP -> HDBSCAN -> Silhouette -> c-TF-IDF -> LLM labeling
    """

    def __init__(self) -> None:
        self.encoder = EncoderService.get_instance()
        self.clustering = ClusteringService()
        self.llm = LLMService()

    async def run_full_pipeline(
        self,
        texts: list[str],
        granularity: str,
        iteration: int = 0,
    ) -> dict:
        """
        Uruchamia pelny pipeline klasteryzacji.

        Args:
            texts: Lista tekstow do analizy
            granularity: "low", "medium" lub "high"
            iteration: Numer iteracji (wplywa na seed UMAP)

        Returns:
            Pelny ClusteringResult z meta
        """
        pipeline_start = time.time()
        seed = 42 + iteration

        # === Krok 1: Enkodowanie ===
        logger.info(f"[Pipeline] Krok 1/6: Enkodowanie {len(texts)} tekstow...")
        encode_start = time.time()
        embeddings = self.encoder.encode(texts)
        encode_time = time.time() - encode_start
        logger.info(f"[Pipeline] Enkodowanie: {encode_time:.1f}s, shape={embeddings.shape}")

        # === Krok 2: Redukcja wymiarow (UMAP) ===
        logger.info("[Pipeline] Krok 2/6: Redukcja wymiarow UMAP...")
        umap_start = time.time()
        coords_2d = self.clustering.reduce_dimensions(embeddings, seed=seed)
        umap_time = time.time() - umap_start
        logger.info(f"[Pipeline] UMAP: {umap_time:.1f}s")

        # === Krok 3: Klasteryzacja (HDBSCAN) ===
        logger.info(f"[Pipeline] Krok 3/6: Klasteryzacja HDBSCAN (granularity={granularity})...")
        cluster_start = time.time()
        labels, probabilities = self.clustering.cluster(embeddings, granularity)
        cluster_time = time.time() - cluster_start
        logger.info(f"[Pipeline] HDBSCAN: {cluster_time:.1f}s")

        noise_count = int((labels == -1).sum())

        # === Krok 4: Koherencja (Silhouette) ===
        logger.info("[Pipeline] Krok 4/6: Obliczanie koherencji...")
        coherence_scores = self.clustering.compute_coherence(embeddings, labels)

        # === Krok 5: Budowanie topikow i dokumentow ===
        logger.info("[Pipeline] Krok 5/6: Budowanie topikow...")
        topics = self.clustering.build_topics(
            embeddings, coords_2d, labels, texts, coherence_scores
        )
        documents = self.clustering.build_documents(texts, labels, coords_2d)

        # === Krok 6: LLM - labelowanie i sugestie ===
        logger.info("[Pipeline] Krok 6/6: LLM labelowanie i sugestie...")
        llm_start = time.time()

        # Labelowanie klastrow (rownolegle)
        topics = await self.llm.label_all_clusters(topics)

        # Generowanie sugestii refinementu
        refinement = await self.llm.generate_refinement_suggestions(
            topics=topics,
            total_docs=len(texts),
            noise_count=noise_count,
            focus_areas=["coherence", "granularity", "naming"],
        )
        llm_time = time.time() - llm_start
        logger.info(f"[Pipeline] LLM: {llm_time:.1f}s")

        # === Kompletowanie wyniku ===
        pipeline_duration = int((time.time() - pipeline_start) * 1000)

        hdbscan_params = GRANULARITY_CONFIG[granularity]

        result = {
            "documents": documents,
            "topics": topics,
            "llmSuggestions": refinement["suggestions"],
            "totalDocuments": len(texts),
            "noise": noise_count,
            "meta": {
                "pipelineDurationMs": pipeline_duration,
                "encoderModel": self.encoder.model_name,
                "umapParams": {
                    "n_neighbors": 15,
                    "min_dist": 0.1,
                    "n_components": 2,
                },
                "hdbscanParams": hdbscan_params,
                "llmModel": self.llm.model,
                "iteration": iteration,
            },
        }

        logger.info(
            f"[Pipeline] Zakonczony w {pipeline_duration}ms: "
            f"{len(topics)} klastrow, {noise_count} szum, "
            f"{len(refinement['suggestions'])} sugestii"
        )

        return result

    async def merge_clusters(
        self,
        cluster_ids: list[int],
        new_label: str,
        documents: list[dict],
        topics: list[dict],
    ) -> dict:
        """
        Laczy klastry: przesuwa dokumenty, przelicza centroidy.
        """
        if len(cluster_ids) < 2:
            raise ValueError("Potrzeba co najmniej 2 klastrow do polaczenia")

        target_id = min(cluster_ids)
        merge_set = set(cluster_ids)

        # Przesuwa dokumenty
        affected = 0
        for doc in documents:
            if doc.get("clusterId") in merge_set:
                doc["clusterId"] = target_id
                affected += 1

        # Usun polaczone topiki, zostaw docelowy
        merged_topics = [t for t in topics if t["id"] in merge_set]
        remaining_topics = [t for t in topics if t["id"] not in merge_set]

        # Przelicz centroid
        merged_docs = [d for d in documents if d.get("clusterId") == target_id]
        if merged_docs:
            centroid_x = sum(d["x"] for d in merged_docs) / len(merged_docs)
            centroid_y = sum(d["y"] for d in merged_docs) / len(merged_docs)
        else:
            centroid_x = centroid_y = 50.0

        # Unia keywords
        all_keywords = []
        for t in merged_topics:
            all_keywords.extend(t.get("keywords", []))
        unique_keywords = list(dict.fromkeys(all_keywords))[:7]

        # Probki
        all_samples = []
        for t in merged_topics:
            all_samples.extend(t.get("sampleTexts", []))

        # Koherencja - srednia wazona
        total_docs = sum(t.get("documentCount", 0) for t in merged_topics)
        weighted_coherence = sum(
            t.get("coherenceScore", 0.5) * t.get("documentCount", 0)
            for t in merged_topics
        )
        coherence = weighted_coherence / total_docs if total_docs > 0 else 0.5

        new_topic = {
            "id": target_id,
            "label": new_label,
            "description": f"Polaczenie klastrow {cluster_ids}",
            "documentCount": len(merged_docs),
            "sampleTexts": all_samples[:5],
            "color": CLUSTER_COLORS[target_id % len(CLUSTER_COLORS)],
            "centroidX": round(centroid_x, 2),
            "centroidY": round(centroid_y, 2),
            "coherenceScore": round(coherence, 3),
            "keywords": unique_keywords,
        }

        final_topics = remaining_topics + [new_topic]
        final_topics.sort(key=lambda t: t["id"])

        noise = sum(1 for d in documents if d.get("clusterId") == -1)

        return {
            "documents": documents,
            "topics": final_topics,
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

    async def split_cluster(
        self,
        cluster_id: int,
        num_subclusters: int,
        documents: list[dict],
        topics: list[dict],
    ) -> dict:
        """
        Dzieli klaster na podklastry za pomoca mini-HDBSCAN.
        """
        # Wyciagnij dokumenty z klastra
        cluster_docs = [d for d in documents if d.get("clusterId") == cluster_id]
        other_docs = [d for d in documents if d.get("clusterId") != cluster_id]

        if len(cluster_docs) < num_subclusters * 3:
            raise ValueError(
                f"Za malo dokumentow ({len(cluster_docs)}) aby podzielic na {num_subclusters}"
            )

        # Uzyj wspolrzednych 2D do podzialu (prostsza metoda)
        coords = np.array([[d["x"], d["y"]] for d in cluster_docs])

        # KMeans-like split na koordynatach (prostsze niz ponowne embeddingi)
        from sklearn.cluster import KMeans

        kmeans = KMeans(n_clusters=num_subclusters, random_state=42, n_init=10)
        sub_labels = kmeans.fit_predict(coords)

        # Przypisz nowe ID
        max_existing_id = max(t["id"] for t in topics) if topics else 0
        new_ids = [max_existing_id + 1 + i for i in range(num_subclusters)]

        # Zaktualizuj dokumenty
        for doc, sub_label in zip(cluster_docs, sub_labels):
            doc["clusterId"] = new_ids[sub_label]

        # Usun stary topik
        old_topic = next((t for t in topics if t["id"] == cluster_id), None)
        remaining_topics = [t for t in topics if t["id"] != cluster_id]

        # Zbuduj nowe topiki
        new_topics = []
        for i, new_id in enumerate(new_ids):
            sub_docs = [d for d in cluster_docs if d.get("clusterId") == new_id]
            if not sub_docs:
                continue

            centroid_x = sum(d["x"] for d in sub_docs) / len(sub_docs)
            centroid_y = sum(d["y"] for d in sub_docs) / len(sub_docs)

            base_label = old_topic["label"] if old_topic else f"Klaster {cluster_id}"
            new_topics.append({
                "id": new_id,
                "label": f"{base_label} (podgrupa {i + 1})",
                "description": f"Podgrupa {i + 1} wydzielona z klastra '{base_label}'",
                "documentCount": len(sub_docs),
                "sampleTexts": [d["text"] for d in sub_docs[:5]],
                "color": CLUSTER_COLORS[new_id % len(CLUSTER_COLORS)],
                "centroidX": round(centroid_x, 2),
                "centroidY": round(centroid_y, 2),
                "coherenceScore": 0.7,
                "keywords": old_topic.get("keywords", [])[:5] if old_topic else [],
            })

        final_topics = remaining_topics + new_topics
        final_topics.sort(key=lambda t: t["id"])

        all_docs = other_docs + cluster_docs
        noise = sum(1 for d in all_docs if d.get("clusterId") == -1)

        return {
            "documents": all_docs,
            "topics": final_topics,
            "llmSuggestions": [],
            "totalDocuments": len(all_docs),
            "noise": noise,
            "splitInfo": {
                "originalClusterId": cluster_id,
                "newClusterIds": [t["id"] for t in new_topics],
                "numSubclusters": num_subclusters,
                "documentsAffected": len(cluster_docs),
            },
        }

    async def reclassify_documents(
        self,
        document_ids: list[str],
        from_cluster_id: int,
        to_cluster_id: int,
        documents: list[dict],
        topics: list[dict],
    ) -> dict:
        """
        Przenosi dokumenty miedzy klastrami.
        """
        ids_set = set(document_ids)
        affected = 0

        for doc in documents:
            if doc["id"] in ids_set and doc.get("clusterId") == from_cluster_id:
                doc["clusterId"] = to_cluster_id
                affected += 1

        # Przelicz documentCount w topikach
        for topic in topics:
            topic["documentCount"] = sum(
                1 for d in documents if d.get("clusterId") == topic["id"]
            )

        noise = sum(1 for d in documents if d.get("clusterId") == -1)

        return {
            "documents": documents,
            "topics": topics,
            "llmSuggestions": [],
            "totalDocuments": len(documents),
            "noise": noise,
            "reclassifyInfo": {
                "documentIds": document_ids,
                "fromClusterId": from_cluster_id,
                "toClusterId": to_cluster_id,
                "documentsAffected": affected,
            },
        }
