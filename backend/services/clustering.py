"""
Clustering Service - BERTopic-based with multi-algorithm support.
Supports: HDBSCAN, KMeans via BERTopic (UMAP + clusterer).
Dim reduction for viz: UMAP 2D. Legacy: reduce_for_clustering + cluster for reclassify path.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import numpy as np
import hdbscan
import umap
from sklearn.cluster import KMeans
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

# Mapping from granularity to default number of clusters (for KMeans)
GRANULARITY_K_MAP = {"low": 4, "medium": 7, "high": 12}

# UMAP n_components used inside BERTopic (before clustering)
BERTOPIC_UMAP_N_COMPONENTS = 5


def _make_umap_for_bertopic(n_samples: int, seed: int = 42) -> umap.UMAP:
    n_neighbors = min(UMAP_N_NEIGHBORS, max(2, n_samples - 1))
    return umap.UMAP(
        n_neighbors=n_neighbors,
        min_dist=UMAP_MIN_DIST,
        n_components=BERTOPIC_UMAP_N_COMPONENTS,
        metric=UMAP_METRIC,
        random_state=seed,
    )


def _make_hdbscan_for_bertopic(
    granularity: str,
    min_cluster_size: int,
) -> hdbscan.HDBSCAN:
    params = GRANULARITY_CONFIG.get(granularity, GRANULARITY_CONFIG["medium"]).copy()
    params["min_cluster_size"] = max(min_cluster_size, params["min_cluster_size"])
    return hdbscan.HDBSCAN(
        min_cluster_size=params["min_cluster_size"],
        min_samples=params["min_samples"],
        cluster_selection_epsilon=params["cluster_selection_epsilon"],
        metric="euclidean",
        prediction_data=True,
    )


class ClusteringService:
    """
    BERTopic-based clustering with configurable UMAP + HDBSCAN/KMeans.
    Uses precomputed embeddings from our encoder/cache.
    """

    # ---- BERTopic (main path) ----

    def fit_bertopic(
        self,
        texts: list[str],
        embeddings: np.ndarray,
        algorithm: str = "hdbscan",
        granularity: str = "medium",
        num_clusters: int | None = None,
        min_cluster_size: int = 5,
        seed: int = 42,
    ) -> tuple[np.ndarray, np.ndarray, Any]:
        """
        Run BERTopic on precomputed embeddings. Returns labels, probabilities, and fitted BERTopic model.
        """
        from bertopic import BERTopic

        n_samples = len(embeddings)
        if n_samples != len(texts):
            raise ValueError("len(texts) must equal len(embeddings)")

        umap_model = _make_umap_for_bertopic(n_samples, seed=seed)
        if algorithm == "kmeans":
            k = num_clusters or GRANULARITY_K_MAP.get(granularity, 7)
            k = max(1, min(k, n_samples - 1))  # 1 <= k; k < n_samples avoids degenerate singleton clusters
            cluster_model = KMeans(n_clusters=k, random_state=seed, n_init=10)
        else:
            cluster_model = _make_hdbscan_for_bertopic(granularity, min_cluster_size)

        topic_model = BERTopic(
            embedding_model=None,
            umap_model=umap_model,
            hdbscan_model=cluster_model,
            top_n_words=10,
            min_topic_size=1,
            verbose=False,
            calculate_probabilities=True,
        )

        logger.info(
            f"BERTopic: algorithm={algorithm}, granularity={granularity}, "
            f"num_clusters={num_clusters}, min_cluster_size={min_cluster_size}"
        )
        start = time.time()

        try:
            topics_list, probs = topic_model.fit_transform(texts, embeddings=embeddings)
        except Exception as e:
            logger.warning(f"BERTopic fit_transform failed: {e}")
            raise

        labels = np.array(topics_list, dtype=np.int64)
        if probs is None:
            probs = np.ones(len(labels), dtype=np.float64)

        n_found = len(set(labels)) - (1 if -1 in labels else 0)
        noise = int((labels == -1).sum())

        # Fallback when HDBSCAN returns no clusters
        if algorithm == "hdbscan" and n_found == 0:
            logger.warning("BERTopic HDBSCAN: 0 clusters, retrying with smaller min_cluster_size")
            fallback = _make_hdbscan_for_bertopic(granularity, max(3, min_cluster_size // 3))
            topic_model = BERTopic(
                embedding_model=None,
                umap_model=_make_umap_for_bertopic(n_samples, seed=seed),
                hdbscan_model=fallback,
                top_n_words=10,
                min_topic_size=1,
                verbose=False,
                calculate_probabilities=True,
            )
            topics_list, probs = topic_model.fit_transform(texts, embeddings=embeddings)
            labels = np.array(topics_list, dtype=np.int64)
            if probs is None:
                probs = np.ones(len(labels), dtype=np.float64)
            n_found = len(set(labels)) - (1 if -1 in labels else 0)
            noise = int((labels == -1).sum())

        elapsed = time.time() - start
        logger.info(f"BERTopic done: {n_found} clusters, {noise} noise, {elapsed:.1f}s")
        return labels, probs, topic_model

    # ---- 2D reduction for visualization ----

    def reduce_to_2d(
        self,
        embeddings: np.ndarray,
        seed: int = 42,
    ) -> np.ndarray:
        """Reduce to 2D for scatter plot (UMAP)."""
        logger.info(f"Viz reduction: {embeddings.shape[1]}D -> 2D via UMAP")
        start = time.time()
        n_neighbors = min(UMAP_N_NEIGHBORS, max(2, len(embeddings) - 1))  # UMAP requires n_neighbors >= 2
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

    # ---- Legacy: pre-clustering reduction and raw cluster (for reclassify / compatibility) ----

    def reduce_for_clustering(
        self,
        embeddings: np.ndarray,
        method: str = "umap",
        target_dims: int = 50,
        seed: int = 42,
    ) -> np.ndarray:
        """Reduce dims before clustering (used only when not using BERTopic)."""
        if method == "none" or target_dims >= embeddings.shape[1]:
            return embeddings
        from sklearn.decomposition import PCA
        from sklearn.manifold import TSNE

        if method == "pca":
            reducer = PCA(n_components=target_dims, random_state=seed)
            return reducer.fit_transform(embeddings)
        if method == "tsne":
            if embeddings.shape[1] > 50:
                pca = PCA(n_components=min(50, target_dims), random_state=seed)
                embeddings = pca.fit_transform(embeddings)
            # perplexity must be < n_samples (sklearn); use at least 1 for tiny sets
            n_s = len(embeddings)
            perplexity = min(30, max(1, n_s - 1))
            reducer = TSNE(n_components=min(target_dims, 3), random_state=seed, perplexity=perplexity)
            return reducer.fit_transform(embeddings)
        reducer = umap.UMAP(
            n_neighbors=min(UMAP_N_NEIGHBORS, max(2, len(embeddings) - 1)),
            min_dist=UMAP_MIN_DIST,
            n_components=target_dims,
            metric=UMAP_METRIC,
            random_state=seed,
        )
        return reducer.fit_transform(embeddings)

    def cluster(
        self,
        embeddings: np.ndarray,
        algorithm: str = "hdbscan",
        granularity: str = "medium",
        num_clusters: int | None = None,
        min_cluster_size: int = 5,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Legacy: cluster on reduced embeddings (e.g. reclassify uses KMeans on raw embeddings)."""
        if algorithm == "kmeans":
            k = num_clusters or GRANULARITY_K_MAP[granularity]
            n_s = len(embeddings)
            k = max(1, min(k, n_s - 1))  # 1 <= k; k < n_s avoids degenerate singleton clusters
            model = KMeans(n_clusters=k, random_state=42, n_init=10)
            labels = model.fit_predict(embeddings)
            distances = model.transform(embeddings)
            min_dist = distances.min(axis=1)
            max_d = min_dist.max() if min_dist.max() > 0 else 1.0
            probabilities = 1.0 - (min_dist / max_d)
            return labels, probabilities
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
        if probabilities is None:
            probabilities = np.ones(len(labels), dtype=np.float64)
        n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
        if n_clusters == 0:
            fallback = {
                "min_cluster_size": max(3, params["min_cluster_size"] // 3),
                "min_samples": max(2, params["min_samples"] // 3),
                "cluster_selection_epsilon": params["cluster_selection_epsilon"] / 3,
            }
            c2 = hdbscan.HDBSCAN(**fallback, metric="euclidean", prediction_data=True)
            labels = c2.fit_predict(embeddings)
            probabilities = c2.probabilities_
            if probabilities is None:
                probabilities = np.ones(len(labels), dtype=np.float64)
        return labels, probabilities

    # ---- Coherence ----

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

    # ---- Keywords and samples (fallback when no BERTopic) ----

    def extract_keywords(self, texts_in_cluster: list[str], n: int = 7) -> list[str]:
        if not texts_in_cluster:
            return []
        if len(texts_in_cluster) == 1:
            try:
                from collections import Counter
                import re
                text = texts_in_cluster[0].lower()
                words = re.findall(r"\b\w+\b", text)
                filtered = [w for w in words if w not in POLISH_STOP_WORDS and len(w) > 2]
                counter = Counter(filtered)
                return [word for word, _ in counter.most_common(n)]
            except Exception as e:
                logger.warning(f"Simple keyword extraction error: {e}")
                return []
        try:
            num_docs = len(texts_in_cluster)
            min_df, max_df = 1, min(0.95, max(0.5, 1.0 - (1.0 / num_docs)))
            if max_df < min_df:
                max_df = min_df
            vec = TfidfVectorizer(
                max_features=500,
                stop_words=POLISH_STOP_WORDS,
                min_df=min_df,
                max_df=max_df,
                ngram_range=(1, 2),
            )
            tfidf = vec.fit_transform(texts_in_cluster)
            names = vec.get_feature_names_out()
            scores = tfidf.sum(axis=0).A1
            top = scores.argsort()[-n:][::-1]
            return [names[i] for i in top if scores[i] > 0]
        except Exception as e:
            logger.warning(f"TF-IDF error: {e}")
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

    # ---- Build output for API ----

    def build_topics(
        self,
        embeddings: np.ndarray,
        coords_2d: np.ndarray,
        labels: np.ndarray,
        texts: list[str],
        coherence_scores: dict[int, float],
        topic_model: Any = None,
    ) -> list[dict]:
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

            if topic_model is not None:
                try:
                    topic_repr = topic_model.get_topic(int(cid))
                    keywords = [w for w, _ in (topic_repr or [])][:10]
                except Exception:
                    keywords = self.extract_keywords(cluster_texts)
                try:
                    repr_docs = getattr(topic_model, "representative_docs_", None) or {}
                    samples = list(repr_docs.get(int(cid), []))[:5]
                    if not samples:
                        samples = self.get_representative_samples(
                            embeddings, labels, texts, cid, n=5
                        )
                except Exception:
                    samples = self.get_representative_samples(
                        embeddings, labels, texts, cid, n=5
                    )
            else:
                keywords = self.extract_keywords(cluster_texts)
                samples = self.get_representative_samples(
                    embeddings, labels, texts, cid, n=5
                )

            coherence = coherence_scores.get(cid, 0.5)
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
                    "keywords": keywords[:7],
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
            import bertopic as bt
            return {
                "umap": {"status": "up", "version": u.__version__},
                "hdbscan": {"status": "up", "version": h.__version__},
                "bertopic": {"status": "up", "version": getattr(bt, "__version__", "?")},
            }
        except Exception as e:
            return {"clustering": {"status": "error", "error": str(e)}}
