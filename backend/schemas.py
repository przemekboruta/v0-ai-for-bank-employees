"""
Topic Discovery Hub - Pydantic schemas
Zsynchronizowane z frontendem (lib/clustering-types.ts)
"""

from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Literal


# ===== Enums =====

ClusteringAlgorithm = Literal["hdbscan", "kmeans", "agglomerative"]
DimReductionMethod = Literal["umap", "pca", "tsne", "none"]
JobStatus = Literal["queued", "embedding", "reducing", "clustering", "labeling", "completed", "failed"]


# ===== Config =====


class ClusteringConfig(BaseModel):
    granularity: Literal["low", "medium", "high"] = "medium"
    algorithm: ClusteringAlgorithm = "hdbscan"
    dim_reduction: DimReductionMethod = Field(default="umap", alias="dimReduction")
    dim_reduction_target: int = Field(default=50, alias="dimReductionTarget")
    num_clusters: int | None = Field(default=None, alias="numClusters")
    min_cluster_size: int = Field(default=5, alias="minClusterSize")
    use_cached_embeddings: bool = Field(default=False, alias="useCachedEmbeddings")
    cached_job_id: str | None = Field(default=None, alias="cachedJobId")

    model_config = {"populate_by_name": True}


# ===== Typy bazowe =====


class DocumentItem(BaseModel):
    id: str
    text: str
    cluster_id: int = Field(alias="clusterId")
    x: float
    y: float

    model_config = {"populate_by_name": True}


class ClusterTopic(BaseModel):
    id: int
    label: str
    description: str
    document_count: int = Field(alias="documentCount")
    sample_texts: list[str] = Field(alias="sampleTexts")
    color: str
    centroid_x: float = Field(alias="centroidX")
    centroid_y: float = Field(alias="centroidY")
    coherence_score: float = Field(alias="coherenceScore")
    keywords: list[str]

    model_config = {"populate_by_name": True}


class LLMSuggestion(BaseModel):
    type: Literal["merge", "rename", "reclassify"]
    description: str
    target_cluster_ids: list[int] = Field(alias="targetClusterIds")
    suggested_label: str | None = Field(None, alias="suggestedLabel")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence score between 0.0 and 1.0")
    applied: bool = False
    blocked: bool = Field(default=False, description="True if suggestion conflicts with an applied suggestion")

    model_config = {"populate_by_name": True}


class ClusterLabelResponse(BaseModel):
    """Response model for cluster labeling."""

    label: str = Field(description="Short descriptive label (max 5 words, in Polish)")
    description: str = Field(description="One-sentence description of the cluster category")


class RefinementSuggestionsResponse(BaseModel):
    """Response model for refinement suggestions from LLM."""

    suggestions: list[LLMSuggestion] = Field(description="List of refinement suggestions (max 5)", max_length=5)
    analysis: RefineAnalysis = Field(description="Analysis of the clustering result")


class ClusteringResult(BaseModel):
    documents: list[DocumentItem]
    topics: list[ClusterTopic]
    llm_suggestions: list[LLMSuggestion] = Field(alias="llmSuggestions")
    total_documents: int = Field(alias="totalDocuments")
    noise: int
    job_id: str | None = Field(None, alias="jobId")

    model_config = {"populate_by_name": True}


# ===== Job =====


class JobInfo(BaseModel):
    job_id: str = Field(alias="jobId")
    status: JobStatus
    progress: float = 0.0
    current_step: str = Field(default="", alias="currentStep")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    config: ClusteringConfig
    text_count: int = Field(alias="textCount")
    error: str | None = None

    model_config = {"populate_by_name": True}


# ===== Requesty =====


class ClusterRequest(BaseModel):
    texts: list[str]
    config: ClusteringConfig = Field(default_factory=ClusteringConfig)
    iteration: int = 0


class ReclusterRequest(BaseModel):
    """Recluster using cached embeddings from a previous job."""

    job_id: str = Field(alias="jobId")
    config: ClusteringConfig

    model_config = {"populate_by_name": True}


class RefineRequest(BaseModel):
    topics: list[ClusterTopic]
    documents: list[DocumentItem]
    previous_suggestions: list[LLMSuggestion] = Field(default_factory=list, alias="previousSuggestions")
    focus_areas: list[str] = Field(default=["coherence", "granularity", "naming"], alias="focusAreas")

    model_config = {"populate_by_name": True}


class RenameRequest(BaseModel):
    topic_id: int = Field(alias="topicId")
    new_label: str = Field(alias="newLabel")
    job_id: str | None = Field(None, alias="jobId")

    model_config = {"populate_by_name": True}


class MergeRequest(BaseModel):
    cluster_ids: list[int] = Field(alias="clusterIds")
    new_label: str = Field(alias="newLabel")
    documents: list[DocumentItem]
    topics: list[ClusterTopic]
    job_id: str | None = Field(None, alias="jobId")

    model_config = {"populate_by_name": True}


class ReclassifyRequest(BaseModel):
    from_cluster_ids: list[int] = Field(
        alias="fromClusterIds", description="List of source cluster IDs to reclassify (must be > 1)"
    )
    num_clusters: int = Field(alias="numClusters", description="Desired number of new clusters")
    documents: list[DocumentItem]
    topics: list[ClusterTopic]
    job_id: str | None = Field(None, alias="jobId")

    model_config = {"populate_by_name": True}


class ExportRequest(BaseModel):
    result: ClusteringResult
    format: Literal["text", "csv", "json"] = "text"
    language: Literal["pl", "en"] = "pl"
    include_examples: bool = Field(default=True, alias="includeExamples")
    include_llm_insights: bool = Field(default=True, alias="includeLLMInsights")

    model_config = {"populate_by_name": True}


# ===== Responsy =====


class PipelineMeta(BaseModel):
    pipeline_duration_ms: int = Field(alias="pipelineDurationMs")
    encoder_model: str = Field(alias="encoderModel")
    algorithm: str
    dim_reduction: str = Field(alias="dimReduction")
    dim_reduction_target: int = Field(alias="dimReductionTarget")
    clustering_params: dict = Field(alias="clusteringParams")
    llm_model: str = Field(alias="llmModel")
    iteration: int
    used_cached_embeddings: bool = Field(default=False, alias="usedCachedEmbeddings")

    model_config = {"populate_by_name": True}


class ClusterResponse(ClusteringResult):
    meta: PipelineMeta


class RefineAnalysis(BaseModel):
    overall_coherence: float = Field(alias="overallCoherence")
    problematic_clusters: list[int] = Field(alias="problematicClusters")
    suggested_optimal_k: int = Field(alias="suggestedOptimalK")
    focus_areas_analyzed: list[str] = Field(alias="focusAreasAnalyzed")

    model_config = {"populate_by_name": True}


class RefineResponse(BaseModel):
    suggestions: list[LLMSuggestion]
    analysis: RefineAnalysis


class RenameResponse(BaseModel):
    topic_id: int = Field(alias="topicId")
    old_label: str = Field(alias="oldLabel")
    new_label: str = Field(alias="newLabel")
    updated: bool
    timestamp: str

    model_config = {"populate_by_name": True}


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


class GenerateLabelsRequest(BaseModel):
    topic_ids: list[int] = Field(alias="topicIds", description="List of topic IDs to generate labels for")
    topics: list[ClusterTopic]
    documents: list[DocumentItem]
    job_id: str | None = Field(None, alias="jobId")

    model_config = {"populate_by_name": True}


class GenerateLabelsResponse(BaseModel):
    updated_topics: list[ClusterTopic] = Field(alias="updatedTopics")
    timestamp: str
