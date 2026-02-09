"""
Clustering Service - UMAP + HDBSCAN + Silhouette + Keywords
Caly pipeline od embeddingów do gotowych klastrow (bez LLM labeling).
"""

from __future__ import annotations

import logging
import time

import numpy as np
import hdbscan
import umap
from sklearn.metrics import silhouette_samples
from sklearn.feature_extraction.text import TfidfVectorizer

from config import (
    UMAP_N_NEIGHBORS,
    UMAP_MIN_DIST,
    UMAP_METRIC,
    GRANULARITY_CONFIG,
    CLUSTER_COLORS,
    POLISH_STOP_WORDS,
)

logger = logging.getLogger(__name__)


class ClusteringService:
    """
    Serwis klasteryzacji: UMAP -> HDBSCAN -> Silhouette -> c-TF-IDF
    """

    def reduce_dimensions(
        self,
        embeddings: np.ndarray,
        seed: int = 42,
    ) -> np.ndarray:
        """
        Redukuje wymiary embeddingów do 2D za pomoca UMAP.

        Args:
            embeddings: Macierz embeddingów (N, D)
            seed: Ziarno losowe

        Returns:
            Wspolrzedne 2D (N, 2)
        """
        logger.info(
            f"UMAP: redukcja {embeddings.shape} -> 2D "
            f"(n_neighbors={UMAP_N_NEIGHBORS}, min_dist={UMAP_MIN_DIST})"
        )
        start = time.time()

        reducer = umap.UMAP(
            n_neighbors=UMAP_N_NEIGHBORS,
            min_dist=UMAP_MIN_DIST,
            n_components=2,
            metric=UMAP_METRIC,
            random_state=seed,
        )
        coords_2d = reducer.fit_transform(embeddings)

        elapsed = time.time() - start
        logger.info(f"UMAP zakonczony w {elapsed:.1f}s")
        return coords_2d

    def cluster(
        self,
        embeddings: np.ndarray,
        granularity: str,
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Klasteryzacja HDBSCAN na embeddingach.

        Args:
            embeddings: Macierz embeddingów (N, D)
            granularity: "low", "medium" lub "high"

        Returns:
            (labels, probabilities) - przypisania klastrow i prawdopodobienstwa
        """
        params = GRANULARITY_CONFIG[granularity]
        logger.info(f"HDBSCAN: granularity={granularity}, params={params}")
        start = time.time()

        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=params["min_cluster_size"],
            min_samples=params["min_samples"],
            cluster_selection_epsilon=params["cluster_selection_epsilon"],
            metric="euclidean",
            prediction_data=True,
        )
        labels = clusterer.fit_predict(embeddings)
        probabilities = clusterer.probabilities_

        n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
        noise_count = int((labels == -1).sum())
        elapsed = time.time() - start

        logger.info(
            f"HDBSCAN: {n_clusters} klastrow, {noise_count} szum, "
            f"zakonczony w {elapsed:.1f}s"
        )

        # Fallback: jesli 0 klastrow, zmniejsz min_cluster_size
        if n_clusters == 0:
            logger.warning("HDBSCAN: 0 klastrow, retry z mniejszymi parametrami")
            fallback_params = {
                "min_cluster_size": max(5, params["min_cluster_size"] // 2),
                "min_samples": max(2, params["min_samples"] // 2),
                "cluster_selection_epsilon": params["cluster_selection_epsilon"] / 2,
            }
            clusterer2 = hdbscan.HDBSCAN(
                **fallback_params,
                metric="euclidean",
                prediction_data=True,
            )
            labels = clusterer2.fit_predict(embeddings)
            probabilities = clusterer2.probabilities_

            n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
            logger.info(f"HDBSCAN fallback: {n_clusters} klastrow")

        return labels, probabilities

    def compute_coherence(
        self,
        embeddings: np.ndarray,
        labels: np.ndarray,
    ) -> dict[int, float]:
        """
        Oblicza silhouette score per klaster.

        Returns:
            Dict {cluster_id: coherence_score (0-1)}
        """
        mask = labels != -1
        if mask.sum() < 2:
            return {}

        unique_labels = set(labels[mask])
        if len(unique_labels) < 2:
            return {lbl: 0.75 for lbl in unique_labels}

        try:
            scores = silhouette_samples(
                embeddings[mask], labels[mask], metric="cosine"
            )
        except Exception as e:
            logger.warning(f"Silhouette error: {e}")
            return {lbl: 0.5 for lbl in unique_labels}

        coherence: dict[int, float] = {}
        label_array = labels[mask]
        for cluster_id in unique_labels:
            cluster_mask = label_array == cluster_id
            raw_score = float(scores[cluster_mask].mean())
            # Normalizuj z zakresu [-1, 1] do [0, 1]
            coherence[cluster_id] = max(0.0, min(1.0, (raw_score + 1.0) / 2.0))

        return coherence

    def extract_keywords(
        self,
        texts_in_cluster: list[str],
        n: int = 7,
    ) -> list[str]:
        """
        Wyciaga slowa kluczowe z tekstow klastra za pomoca TF-IDF.
        """
        if not texts_in_cluster:
            return []

        try:
            cluster_doc = " ".join(texts_in_cluster)
            vectorizer = TfidfVectorizer(
                max_features=500,
                stop_words=POLISH_STOP_WORDS,
                min_df=1,
                max_df=0.95,
            )
            tfidf = vectorizer.fit_transform([cluster_doc])
            feature_names = vectorizer.get_feature_names_out()
            scores = tfidf.toarray()[0]
            top_indices = scores.argsort()[-n:][::-1]
            return [feature_names[i] for i in top_indices if scores[i] > 0]
        except Exception as e:
            logger.warning(f"TF-IDF error: {e}")
            return []

    def get_representative_samples(
        self,
        embeddings: np.ndarray,
        labels: np.ndarray,
        texts: list[str],
        cluster_id: int,
        n: int = 5,
    ) -> list[str]:
        """
        Zwraca n tekstow najblizszych centroidowi klastra.
        """
        mask = labels == cluster_id
        indices = np.where(mask)[0]

        if len(indices) == 0:
            return []

        cluster_embeddings = embeddings[indices]
        centroid = cluster_embeddings.mean(axis=0)
        distances = np.linalg.norm(cluster_embeddings - centroid, axis=1)
        top_local_indices = distances.argsort()[:n]
        top_global_indices = indices[top_local_indices]

        return [texts[i] for i in top_global_indices]

    def build_topics(
        self,
        embeddings: np.ndarray,
        coords_2d: np.ndarray,
        labels: np.ndarray,
        texts: list[str],
        coherence_scores: dict[int, float],
    ) -> list[dict]:
        """
        Buduje liste topikow z danych klasteryzacji.
        Etykiety i opisy beda uzupelnione przez LLM w nastepnym kroku.
        """
        unique_labels = sorted(set(labels))
        topics = []

        for cluster_id in unique_labels:
            if cluster_id == -1:
                continue

            mask = labels == cluster_id
            indices = np.where(mask)[0]
            doc_count = int(mask.sum())

            # Centroid w 2D
            cluster_coords = coords_2d[indices]
            centroid_x = float(cluster_coords[:, 0].mean())
            centroid_y = float(cluster_coords[:, 1].mean())

            # Teksty klastra
            cluster_texts = [texts[i] for i in indices]

            # Slowa kluczowe
            keywords = self.extract_keywords(cluster_texts)

            # Probki reprezentatywne
            samples = self.get_representative_samples(
                embeddings, labels, texts, cluster_id, n=5
            )

            # Koherencja
            coherence = coherence_scores.get(cluster_id, 0.5)

            # Kolor
            color = CLUSTER_COLORS[cluster_id % len(CLUSTER_COLORS)]

            topics.append({
                "id": int(cluster_id),
                "label": f"Klaster {cluster_id}",  # Placeholder - LLM nada nazwe
                "description": "",  # Placeholder - LLM uzupelni
                "documentCount": doc_count,
                "sampleTexts": samples,
                "color": color,
                "centroidX": centroid_x,
                "centroidY": centroid_y,
                "coherenceScore": round(coherence, 3),
                "keywords": keywords,
            })

        return topics

    def build_documents(
        self,
        texts: list[str],
        labels: np.ndarray,
        coords_2d: np.ndarray,
    ) -> list[dict]:
        """
        Buduje liste dokumentow z wynikami klasteryzacji i wspolrzednymi 2D.
        Normalizuje wspolrzedne do zakresu [5, 95] dla lepszej wizualizacji.
        """
        # Normalizuj do zakresu [5, 95]
        x_min, x_max = coords_2d[:, 0].min(), coords_2d[:, 0].max()
        y_min, y_max = coords_2d[:, 1].min(), coords_2d[:, 1].max()

        x_range = x_max - x_min if x_max != x_min else 1.0
        y_range = y_max - y_min if y_max != y_min else 1.0

        documents = []
        for i, text in enumerate(texts):
            x_norm = 5 + 90 * (coords_2d[i, 0] - x_min) / x_range
            y_norm = 5 + 90 * (coords_2d[i, 1] - y_min) / y_range

            documents.append({
                "id": f"doc-{i}",
                "text": text,
                "clusterId": int(labels[i]),
                "x": round(float(x_norm), 2),
                "y": round(float(y_norm), 2),
            })

        return documents

    def health_check(self) -> dict:
        """Sprawdza status serwisu."""
        try:
            import umap as umap_lib
            import hdbscan as hdbscan_lib

            return {
                "umap": {"status": "up", "version": umap_lib.__version__},
                "hdbscan": {"status": "up", "version": hdbscan_lib.__version__},
            }
        except Exception as e:
            return {
                "umap": {"status": "error", "error": str(e)},
                "hdbscan": {"status": "error", "error": str(e)},
            }
