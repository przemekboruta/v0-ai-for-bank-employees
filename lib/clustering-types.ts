export type Granularity = "low" | "medium" | "high"

export type ClusteringAlgorithm = "hdbscan" | "kmeans" | "agglomerative"
export type DimReductionMethod = "umap" | "pca" | "tsne" | "none"

export type JobStatus = "queued" | "embedding" | "reducing" | "clustering" | "labeling" | "completed" | "failed" | "interrupted"

/** Simple category preset: few/medium/many = KMeans with auto numClusters; auto = HDBSCAN; advanced = full controls */
export type CategoryPreset = "few" | "medium" | "many" | "auto" | "advanced"

/** Advanced clustering configuration */
export interface ClusteringConfig {
  /** Simple mode: few/medium/many/auto/advanced. When not "advanced", algorithm and numClusters are derived. */
  categoryPreset?: CategoryPreset
  /** Granularity preset (used when categoryPreset is "advanced" or for HDBSCAN hint) */
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
  /** Optional target cluster count for HDBSCAN when categoryPreset is "auto" (algorithm aims for ~this + noise) */
  hdbscanTargetClusters?: number | null
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
  categoryPreset: "auto",
  granularity: "medium",
  algorithm: "hdbscan",
  dimReduction: "umap",
  dimReductionTarget: 50,
  numClusters: null,
  minClusterSize: 5,
  hdbscanTargetClusters: null,
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
  /** When true, document is excluded from display and from re-runs; user can toggle in exploration. */
  excluded?: boolean
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

/** Noise topic (id -1) for display when algorithm produced noise but backend did not add the topic. */
const NOISE_TOPIC_PLACEHOLDER: ClusterTopic = {
  id: -1,
  label: "Szum",
  description: "Dokumenty nieskategoryzowane (outliers).",
  documentCount: 0,
  sampleTexts: [],
  color: "hsl(0, 0%, 55%)",
  centroidX: 50,
  centroidY: 50,
  coherenceScore: 0,
  keywords: [],
}

/** Ensures result.topics includes a "Szum" topic (id -1) when result.noise > 0. Use for backward compatibility. */
export function ensureNoiseTopic(result: ClusteringResult): ClusteringResult {
  if (result.noise <= 0) return result
  if (result.topics.some((t) => t.id === -1)) return result
  const noiseDocs = result.documents.filter((d) => d.clusterId === -1)
  const n = noiseDocs.length
  const cx = n ? noiseDocs.reduce((s, d) => s + d.x, 0) / n : 50
  const cy = n ? noiseDocs.reduce((s, d) => s + d.y, 0) / n : 50
  const noiseTopic: ClusterTopic = {
    ...NOISE_TOPIC_PLACEHOLDER,
    documentCount: n,
    centroidX: cx,
    centroidY: cy,
    sampleTexts: noiseDocs.slice(0, 5).map((d) => d.text.slice(0, 200)),
  }
  return {
    ...result,
    topics: [...result.topics, noiseTopic].sort((a, b) => a.id - b.id),
  }
}

/** Splits result.documents into active (included in analysis) and excluded (outliers). */
export function getActiveAndExcludedDocuments(result: ClusteringResult): {
  activeDocuments: DocumentItem[]
  excludedDocuments: DocumentItem[]
} {
  const activeDocuments: DocumentItem[] = []
  const excludedDocuments: DocumentItem[] = []
  for (const d of result.documents) {
    if (d.excluded) excludedDocuments.push(d)
    else activeDocuments.push(d)
  }
  return { activeDocuments, excludedDocuments }
}

/** After an API call that returns a result built only from active docs, reattach excluded docs so they are not lost. */
export function reattachExcludedDocuments(
  apiResult: ClusteringResult,
  excludedDocuments: DocumentItem[]
): ClusteringResult {
  if (excludedDocuments.length === 0) return apiResult
  return {
    ...apiResult,
    documents: [...apiResult.documents, ...excludedDocuments],
  }
}

export type WizardStep = "dashboard" | "upload" | "configure" | "processing" | "explore"

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
