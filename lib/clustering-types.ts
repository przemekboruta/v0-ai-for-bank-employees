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
  /** Encoder model name (from backend list); empty = backend default */
  encoderModel: string | null
  /** Optional prefix prepended to each text before encoding */
  encoderPrefix: string | null
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
  encoderModel: null,
  encoderPrefix: null,
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

/** Pipeline meta (returned with result from backend) */
export interface PipelineMeta {
  pipelineDurationMs: number
  encoderModel: string
  algorithm: string
  dimReduction: string
  dimReductionTarget: number
  clusteringParams: Record<string, unknown>
  llmModel: string
  iteration: number
  usedCachedEmbeddings: boolean
  completedAt?: string
}

export interface ClusteringResult {
  documents: DocumentItem[]
  topics: ClusterTopic[]
  llmSuggestions: LLMSuggestion[]
  totalDocuments: number
  noise: number
  jobId?: string
  /** Set when result comes from backend (includes encoder, algorithm, completedAt) */
  meta?: PipelineMeta
}

export type WizardStep =
  | "dashboard"
  | "upload"
  | "configure"
  | "processing"
  | "review"
  | "explore"
  | "categories"
  | "training"
  | "classification-results"

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

// ===== Classification types =====

export type ClassificationJobStatus =
  | "queued"
  | "loading_model"
  | "training"
  | "predicting"
  | "completed"
  | "failed"

export interface CategoryDefinition {
  id: string
  name: string
  examples: string[]
  description: string
}

export interface TaxonomyInfo {
  taxonomyId: string
  name: string
  description: string
  categories: CategoryDefinition[]
  categoryCount: number
  createdAt: string
  updatedAt: string
}

export interface ClassifiedDocument {
  id: string
  text: string
  categoryId: string
  categoryName: string
  confidence: number
  /** Margin between top-2 predicted probabilities (low = uncertain) */
  margin?: number
  /** All class probabilities [catIdx -> prob] */
  allProbabilities?: number[]
  /** User-corrected category (set during active learning review) */
  correctedCategoryId?: string
  correctedCategoryName?: string
}

export interface CategoryMetrics {
  categoryId: string
  categoryName: string
  precision: number
  recall: number
  f1: number
  support: number
}

export interface ClassificationResult {
  documents: ClassifiedDocument[]
  categories: CategoryDefinition[]
  totalDocuments: number
  modelId: string
  accuracy: number
  confidenceAvailable?: boolean
  categoryMetrics?: CategoryMetrics[]
  /** Active learning iteration number (0 = initial training) */
  iteration?: number
}

export interface TrainingJobInfo {
  jobId: string
  status: ClassificationJobStatus
  progress: number
  currentStep: string
  modelId?: string
  accuracy?: number
  accuracyType?: "validation" | "training"
  categoryCount: number
  createdAt: string
  updatedAt: string
  error?: string
  result?: ClassificationResult
}

export interface ModelVersionInfo {
  version: number
  modelId: string
  accuracy: number
  accuracyType: "validation" | "training"
  categoryMetrics?: CategoryMetrics[]
  correctionsUsed: number
  totalExamples: number
  savedAt: string
}

export interface ModelInfo {
  modelId: string
  name: string
  backbone: string
  categoryCount: number
  categories: string[]
  accuracy: number
  savedAt: string
  /** Version history (newest first) */
  versions?: ModelVersionInfo[]
  currentVersion?: number
}

/** Wizard flow path */
export type WizardPath = "full" | "classify-only" | "batch"

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
