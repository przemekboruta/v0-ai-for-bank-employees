export type Granularity = "low" | "medium" | "high"

export type ClusteringAlgorithm = "hdbscan" | "kmeans" | "agglomerative"
export type DimReductionMethod = "umap" | "pca" | "tsne" | "none"

export type JobStatus = "queued" | "embedding" | "reducing" | "clustering" | "labeling" | "completed" | "failed" | "interrupted"

/** Advanced clustering configuration */
export interface ClusteringConfig {
  /** Granularity preset (simple mode) */
  granularity: Granularity
  /** Clustering algorithm */
  algorithm: ClusteringAlgorithm
  /** Dimensionality reduction method before clustering (separate from 2D viz) */
  dimReduction: DimReductionMethod
  /** Target dims for pre-clustering reduction (ignored if dimReduction is "none") */
  dimReductionTarget: number
  /** Desired number of clusters (used by kmeans/agglomerative; hint for hdbscan) */
  numClusters: number | null
  /** Minimum documents per cluster */
  minClusterSize: number
  /** Whether to use cached embeddings from a previous run */
  useCachedEmbeddings: boolean
  /** Previous job ID whose embeddings to reuse */
  cachedJobId: string | null
}

export const DEFAULT_CLUSTERING_CONFIG: ClusteringConfig = {
  granularity: "medium",
  algorithm: "hdbscan",
  dimReduction: "umap",
  dimReductionTarget: 50,
  numClusters: null,
  minClusterSize: 5,
  useCachedEmbeddings: false,
  cachedJobId: null,
}

/** Job status from the queue */
export interface JobInfo {
  jobId: string
  status: JobStatus
  progress: number
  currentStep: string
  createdAt: string
  updatedAt: string
  config: ClusteringConfig
  textCount: number
  error?: string
}

export interface DocumentItem {
  id: string
  text: string
  clusterId: number
  x: number
  y: number
}

export interface ClusterTopic {
  id: number
  label: string
  description: string
  documentCount: number
  sampleTexts: string[]
  color: string
  centroidX: number
  centroidY: number
  coherenceScore: number
  keywords: string[]
}

export interface LLMSuggestion {
  type: "merge" | "rename" | "reclassify"
  description: string
  targetClusterIds: number[]
  suggestedLabel?: string
  confidence: number
  applied: boolean
  blocked?: boolean // True if suggestion conflicts with an applied suggestion
}

export interface ClusteringResult {
  documents: DocumentItem[]
  topics: ClusterTopic[]
  llmSuggestions: LLMSuggestion[]
  totalDocuments: number
  noise: number
  jobId?: string
}

export type WizardStep = "dashboard" | "upload" | "configure" | "processing" | "review" | "explore"

/** A saved / in-progress clustering job visible in the dashboard */
export interface SavedJob {
  jobId: string
  name: string
  status: JobStatus
  progress: number
  textCount: number
  topicCount: number | null
  config: ClusteringConfig
  createdAt: string
  updatedAt: string
  result: ClusteringResult | null
  error?: string
}

export const CLUSTER_COLORS = [
  "hsl(210, 100%, 65%)",
  "hsl(175, 70%, 55%)",
  "hsl(40, 90%, 62%)",
  "hsl(340, 75%, 62%)",
  "hsl(265, 60%, 65%)",
  "hsl(150, 65%, 52%)",
  "hsl(20, 85%, 60%)",
  "hsl(195, 75%, 58%)",
  "hsl(300, 50%, 62%)",
  "hsl(55, 80%, 55%)",
  "hsl(0, 70%, 60%)",
  "hsl(120, 55%, 52%)",
]
