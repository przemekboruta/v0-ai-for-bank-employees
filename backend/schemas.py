"""
Topic Discovery Hub - Pydantic schemas
Zsynchronizowane z frontendem (lib/clustering-types.ts)
"""

from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Literal


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
    type: Literal["merge", "split", "rename", "reclassify"]
    description: str
    target_cluster_ids: list[int] = Field(alias="targetClusterIds")
    suggested_label: str | None = Field(None, alias="suggestedLabel")
    confidence: float
    applied: bool = False

    model_config = {"populate_by_name": True}


class ClusteringResult(BaseModel):
    documents: list[DocumentItem]
    topics: list[ClusterTopic]
    llm_suggestions: list[LLMSuggestion] = Field(alias="llmSuggestions")
    total_documents: int = Field(alias="totalDocuments")
    noise: int

    model_config = {"populate_by_name": True}


# ===== Requesty =====

class ClusterRequest(BaseModel):
    texts: list[str]
    granularity: Literal["low", "medium", "high"]
    iteration: int = 0


class RefineRequest(BaseModel):
    topics: list[ClusterTopic]
    documents: list[DocumentItem]
    previous_suggestions: list[LLMSuggestion] = Field(
        default_factory=list, alias="previousSuggestions"
    )
    focus_areas: list[str] = Field(
        default=["coherence", "granularity", "naming"], alias="focusAreas"
    )

    model_config = {"populate_by_name": True}


class RenameRequest(BaseModel):
    topic_id: int = Field(alias="topicId")
    new_label: str = Field(alias="newLabel")

    model_config = {"populate_by_name": True}


class MergeRequest(BaseModel):
    cluster_ids: list[int] = Field(alias="clusterIds")
    new_label: str = Field(alias="newLabel")
    documents: list[DocumentItem]
    topics: list[ClusterTopic]

    model_config = {"populate_by_name": True}


class SplitRequest(BaseModel):
    cluster_id: int = Field(alias="clusterId")
    num_subclusters: int = Field(default=2, alias="numSubclusters")
    documents: list[DocumentItem]
    topics: list[ClusterTopic]

    model_config = {"populate_by_name": True}


class ReclassifyRequest(BaseModel):
    document_ids: list[str] = Field(alias="documentIds")
    from_cluster_id: int = Field(alias="fromClusterId")
    to_cluster_id: int = Field(alias="toClusterId")
    documents: list[DocumentItem]
    topics: list[ClusterTopic]

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
    umap_params: dict = Field(alias="umapParams")
    hdbscan_params: dict = Field(alias="hdbscanParams")
    llm_model: str = Field(alias="llmModel")
    iteration: int

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
