"""
Clustering Service - multi-algorithm support
Supports: HDBSCAN, KMeans, Agglomerative
Dim reduction: UMAP, PCA, t-SNE, or none
"""

from __future__ import annotations

import logging
import time

import numpy as np
import hdbscan
import umap
from sklearn.cluster import KMeans, AgglomerativeClustering
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE
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

# Mapping from granularity to default number of clusters (for KMeans/Agglomerative)
GRANULARITY_K_MAP = {"low": 4, "medium": 7, "high": 12}


class ClusteringService:
    """
    Multi-algorithm clustering with configurable dimensionality reduction.
    """

    # ---- Dimensionality reduction ----

    def reduce_for_clustering(
        self,
        embeddings: np.ndarray,
        method: str = "umap",
        target_dims: int = 50,
        seed: int = 42,
    ) -> np.ndarray:
        """
        Reduce dims BEFORE clustering (for better cluster quality).
        This is separate from the 2D reduction for visualization.
        """
        if method == "none" or target_dims >= embeddings.shape[1]:
            logger.info(f"Dim reduction skipped (method={method}, dims={embeddings.shape[1]})")
            return embeddings

        logger.info(f"Pre-clustering reduction: {embeddings.shape[1]}D -> {target_dims}D via {method}")
        start = time.time()

        if method == "pca":
            reducer = PCA(n_components=target_dims, random_state=seed)
            result = reducer.fit_transform(embeddings)
        elif method == "tsne":
            # t-SNE is slow for high dims, use PCA first if > 50
            if embeddings.shape[1] > 50:
                pca = PCA(n_components=min(50, target_dims), random_state=seed)
                embeddings = pca.fit_transform(embeddings)
            reducer = TSNE(n_components=min(target_dims, 3), random_state=seed, perplexity=30)
            result = reducer.fit_transform(embeddings)
        else:  # umap
            reducer = umap.UMAP(
                n_neighbors=min(UMAP_N_NEIGHBORS, len(embeddings) - 1),
                min_dist=UMAP_MIN_DIST,
                n_components=target_dims,
                metric=UMAP_METRIC,
                random_state=seed,
            )
            result = reducer.fit_transform(embeddings)

        logger.info(f"Pre-clustering reduction done in {time.time() - start:.1f}s")
        return result

    def reduce_to_2d(
        self,
        embeddings: np.ndarray,
        seed: int = 42,
    ) -> np.ndarray:
        """
        Always reduce to 2D for scatter plot visualization (always UMAP).
        """
        logger.info(f"Viz reduction: {embeddings.shape[1]}D -> 2D via UMAP")
        start = time.time()

        n_neighbors = min(UMAP_N_NEIGHBORS, len(embeddings) - 1)
        reducer = umap.UMAP(
            n_neighbors=n_neighbors,
            min_dist=UMAP_MIN_DIST,
            n_components=2,
            metric=UMAP_METRIC,
            random_state=seed,
        )
        coords_2d = reducer.fit_transform(embeddings)

        logger.info(f"Viz reduction done in {time.time() - start:.1f}s")
        return coords_2d

    # ---- Clustering algorithms ----

    def cluster(
        self,
        embeddings: np.ndarray,
        algorithm: str = "hdbscan",
        granularity: str = "medium",
        num_clusters: int | None = None,
        min_cluster_size: int = 5,
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Run clustering with selected algorithm.

        Returns:
            (labels, probabilities)
        """
        logger.info(
            f"Clustering: algorithm={algorithm}, granularity={granularity}, "
            f"num_clusters={num_clusters}, min_cluster_size={min_cluster_size}"
        )
        start = time.time()

        if algorithm == "kmeans":
            k = num_clusters or GRANULARITY_K_MAP[granularity]
            k = min(k, len(embeddings) - 1)
            model = KMeans(n_clusters=k, random_state=42, n_init=10)
            labels = model.fit_predict(embeddings)
            # KMeans doesn't have probabilities -- use distance-based confidence
            distances = model.transform(embeddings)
            min_dist = distances.min(axis=1)
            max_d = min_dist.max() if min_dist.max() > 0 else 1.0
            probabilities = 1.0 - (min_dist / max_d)

        elif algorithm == "agglomerative":
            k = num_clusters or GRANULARITY_K_MAP[granularity]
            k = min(k, len(embeddings) - 1)
            model = AgglomerativeClustering(n_clusters=k)
            labels = model.fit_predict(embeddings)
            probabilities = np.ones(len(labels))  # no native probs

        else:  # hdbscan
            params = GRANULARITY_CONFIG.get(granularity, GRANULARITY_CONFIG["medium"]).copy()
            params["min_cluster_size"] = max(min_cluster_size, params["min_cluster_size"])

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

            # Fallback if no clusters found
            if n_clusters == 0:
                logger.warning("HDBSCAN: 0 clusters, retrying with smaller params")
                fallback = {
                    "min_cluster_size": max(3, params["min_cluster_size"] // 3),
                    "min_samples": max(2, params["min_samples"] // 3),
                    "cluster_selection_epsilon": params["cluster_selection_epsilon"] / 3,
                }
                c2 = hdbscan.HDBSCAN(**fallback, metric="euclidean", prediction_data=True)
                labels = c2.fit_predict(embeddings)
                probabilities = c2.probabilities_

        n_found = len(set(labels)) - (1 if -1 in labels else 0)
        noise = int((labels == -1).sum())
        elapsed = time.time() - start
        logger.info(f"Clustering done: {n_found} clusters, {noise} noise, {elapsed:.1f}s")

        return labels, probabilities

    # ---- Analysis ----

    def compute_coherence(
        self,
        embeddings: np.ndarray,
        labels: np.ndarray,
    ) -> dict[int, float]:
        mask = labels != -1
        if mask.sum() < 2:
            return {}
        unique_labels = set(labels[mask])
        if len(unique_labels) < 2:
            return {lbl: 0.75 for lbl in unique_labels}
        try:
            scores = silhouette_samples(embeddings[mask], labels[mask], metric="cosine")
        except Exception as e:
            logger.warning(f"Silhouette error: {e}")
            return {lbl: 0.5 for lbl in unique_labels}

        coherence: dict[int, float] = {}
        label_array = labels[mask]
        for cid in unique_labels:
            cmask = label_array == cid
            raw = float(scores[cmask].mean())
            coherence[cid] = max(0.0, min(1.0, (raw + 1.0) / 2.0))
        return coherence

    def extract_keywords(self, texts_in_cluster: list[str], n: int = 7) -> list[str]:
        if not texts_in_cluster:
            return []

        # If only one document, use simple word frequency
        if len(texts_in_cluster) == 1:
            try:
                from collections import Counter
                import re

                text = texts_in_cluster[0].lower()
                # Remove punctuation and split
                words = re.findall(r"\b\w+\b", text)
                # Filter out stop words and short words
                filtered = [w for w in words if w not in POLISH_STOP_WORDS and len(w) > 2]
                counter = Counter(filtered)
                return [word for word, _ in counter.most_common(n)]
            except Exception as e:
                logger.warning(f"Simple keyword extraction error: {e}")
                return []

        try:
            # Adjust min_df and max_df based on number of documents
            num_docs = len(texts_in_cluster)
            # min_df: at least 1 document (or 1 if only 1 doc)
            min_df = 1
            # max_df: at most 95% of documents, but ensure it's >= min_df
            max_df = min(0.95, max(0.5, 1.0 - (1.0 / num_docs)))

            # Ensure max_df is always >= min_df
            if max_df < min_df:
                max_df = min_df

            vec = TfidfVectorizer(
                max_features=500,
                stop_words=POLISH_STOP_WORDS,
                min_df=min_df,
                max_df=max_df,
                ngram_range=(1, 2),  # Include unigrams and bigrams
            )
            tfidf = vec.fit_transform(texts_in_cluster)
            names = vec.get_feature_names_out()

            # Sum TF-IDF scores across all documents
            scores = tfidf.sum(axis=0).A1
            top = scores.argsort()[-n:][::-1]
            return [names[i] for i in top if scores[i] > 0]
        except Exception as e:
            logger.warning(f"TF-IDF error: {e}")
            # Fallback to simple word frequency
            try:
                from collections import Counter
                import re

                all_text = " ".join(texts_in_cluster).lower()
                words = re.findall(r"\b\w+\b", all_text)
                filtered = [w for w in words if w not in POLISH_STOP_WORDS and len(w) > 2]
                counter = Counter(filtered)
                return [word for word, _ in counter.most_common(n)]
            except Exception as e2:
                logger.warning(f"Fallback keyword extraction error: {e2}")
                return []

    def get_representative_samples(
        self,
        embeddings: np.ndarray,
        labels: np.ndarray,
        texts: list[str],
        cluster_id: int,
        n: int = 5,
    ) -> list[str]:
        mask = labels == cluster_id
        indices = np.where(mask)[0]
        if len(indices) == 0:
            return []
        cluster_emb = embeddings[indices]
        centroid = cluster_emb.mean(axis=0)
        dists = np.linalg.norm(cluster_emb - centroid, axis=1)
        top = dists.argsort()[:n]
        return [texts[indices[i]] for i in top]

    def build_topics(
        self,
        embeddings: np.ndarray,
        coords_2d: np.ndarray,
        labels: np.ndarray,
        texts: list[str],
        coherence_scores: dict[int, float],
    ) -> list[dict]:
        # Normalize coords same way as in build_documents
        x_min, x_max = coords_2d[:, 0].min(), coords_2d[:, 0].max()
        y_min, y_max = coords_2d[:, 1].min(), coords_2d[:, 1].max()
        x_range = x_max - x_min if x_max != x_min else 1.0
        y_range = y_max - y_min if y_max != y_min else 1.0

        unique = sorted(set(labels))
        topics = []
        for cid in unique:
            if cid == -1:
                continue
            mask = labels == cid
            indices = np.where(mask)[0]
            cluster_coords = coords_2d[indices]
            cluster_texts = [texts[i] for i in indices]
            keywords = self.extract_keywords(cluster_texts)
            samples = self.get_representative_samples(embeddings, labels, texts, cid, n=5)
            coherence = coherence_scores.get(cid, 0.5)

            # Calculate centroid from normalized coordinates (same as documents)
            centroid_x_raw = cluster_coords[:, 0].mean()
            centroid_y_raw = cluster_coords[:, 1].mean()
            centroid_x_norm = 5 + 90 * (centroid_x_raw - x_min) / x_range
            centroid_y_norm = 5 + 90 * (centroid_y_raw - y_min) / y_range

            topics.append(
                {
                    "id": int(cid),
                    "label": f"Klaster {cid}",
                    "description": "",
                    "documentCount": int(mask.sum()),
                    "sampleTexts": samples,
                    "color": CLUSTER_COLORS[cid % len(CLUSTER_COLORS)],
                    "centroidX": round(float(centroid_x_norm), 2),
                    "centroidY": round(float(centroid_y_norm), 2),
                    "coherenceScore": round(coherence, 3),
                    "keywords": keywords,
                }
            )
        return topics

    def build_documents(
        self,
        texts: list[str],
        labels: np.ndarray,
        coords_2d: np.ndarray,
    ) -> list[dict]:
        x_min, x_max = coords_2d[:, 0].min(), coords_2d[:, 0].max()
        y_min, y_max = coords_2d[:, 1].min(), coords_2d[:, 1].max()
        x_range = x_max - x_min if x_max != x_min else 1.0
        y_range = y_max - y_min if y_max != y_min else 1.0

        documents = []
        for i, text in enumerate(texts):
            x_norm = 5 + 90 * (coords_2d[i, 0] - x_min) / x_range
            y_norm = 5 + 90 * (coords_2d[i, 1] - y_min) / y_range
            documents.append(
                {
                    "id": f"doc-{i}",
                    "text": text,
                    "clusterId": int(labels[i]),
                    "x": round(float(x_norm), 2),
                    "y": round(float(y_norm), 2),
                }
            )
        return documents

    def health_check(self) -> dict:
        try:
            import umap as u
            import hdbscan as h

            return {
                "umap": {"status": "up", "version": u.__version__},
                "hdbscan": {"status": "up", "version": h.__version__},
            }
        except Exception as e:
            return {"clustering": {"status": "error", "error": str(e)}}
