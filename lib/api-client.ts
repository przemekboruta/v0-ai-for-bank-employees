import type {
  Granularity,
  ClusteringResult,
  ClusterTopic,
  DocumentItem,
  LLMSuggestion,
  ClusteringConfig,
  JobInfo,
  SavedJob,
} from "./clustering-types"

/**
 * Klient API klasteryzacji.
 *
 * Wszystkie metody komunikuja sie z Next.js API Routes,
 * ktore w trybie MOCK zwracaja symulowane dane,
 * a w trybie PRODUCTION proxy'uja do prawdziwego pipeline'u ML.
 */

interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown>
}

class ClusteringApiError extends Error {
  code: string
  details?: Record<string, unknown>

  constructor(apiError: ApiError) {
    super(apiError.message)
    this.code = apiError.code
    this.details = apiError.details
    this.name = "ClusteringApiError"
  }
}

async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  })

  if (!response.ok) {
    let errorBody: { error?: ApiError } | null = null
    try {
      errorBody = await response.json()
    } catch {
      // Not JSON
    }

    if (errorBody?.error) {
      throw new ClusteringApiError(errorBody.error)
    }

    throw new ClusteringApiError({
      code: "UNKNOWN_ERROR",
      message: `Blad HTTP ${response.status}: ${response.statusText}`,
    })
  }

  return response.json()
}

// ===== Job-based clustering (async) =====

interface SubmitJobResponse {
  jobId: string
  status: "queued"
}

/**
 * Submit a clustering job. Returns immediately with a jobId.
 * Use pollJobStatus() to track progress.
 */
export async function submitClusteringJob(
  texts: string[],
  config: ClusteringConfig,
  iteration = 0
): Promise<SubmitJobResponse> {
  return apiRequest<SubmitJobResponse>("/api/cluster", {
    method: "POST",
    body: JSON.stringify({ texts, config, iteration }),
  })
}

interface JobStatusResponse extends JobInfo {
  result?: ClusteringResult & {
    meta: {
      pipelineDurationMs: number
      encoderModel: string
      algorithm: string
      dimReduction: string
      dimReductionTarget: number
      clusteringParams: Record<string, unknown>
      llmModel: string
      iteration: number
      usedCachedEmbeddings: boolean
    }
  }
}

/**
 * Poll job status. When status === "completed", result is included.
 */
export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  return apiRequest<JobStatusResponse>(`/api/cluster/job/${jobId}`, {
    method: "GET",
  })
}

// ===== Recluster with cached embeddings =====

interface ReclusterResponse {
  jobId: string
  status: "queued"
  cachedFrom: string
}

/**
 * Re-cluster using cached embeddings from a previous job.
 * Skips the expensive embedding step.
 */
export async function submitRecluster(
  sourceJobId: string,
  config: ClusteringConfig
): Promise<ReclusterResponse> {
  return apiRequest<ReclusterResponse>("/api/cluster/recluster", {
    method: "POST",
    body: JSON.stringify({ jobId: sourceJobId, config }),
  })
}

// ===== Legacy synchronous clustering (for mock mode) =====

interface ClusterResponse extends ClusteringResult {
  meta: {
    pipelineDurationMs: number
    encoderModel: string
    umapParams: Record<string, number>
    hdbscanParams: Record<string, number>
    llmModel: string
    iteration: number
  }
}

export async function runClustering(
  texts: string[],
  granularity: Granularity,
  iteration = 0
): Promise<ClusterResponse> {
  return apiRequest<ClusterResponse>("/api/cluster", {
    method: "POST",
    body: JSON.stringify({ texts, granularity, iteration }),
  })
}

// ===== LLM Refinement =====

interface RefineResponse {
  suggestions: LLMSuggestion[]
  analysis: {
    overallCoherence: number
    problematicClusters: number[]
    suggestedOptimalK: number
    focusAreasAnalyzed: string[]
  }
}

export async function refineClusters(
  topics: ClusterTopic[],
  documents: DocumentItem[],
  previousSuggestions: LLMSuggestion[] = [],
  focusAreas: string[] = ["coherence", "granularity", "naming"]
): Promise<RefineResponse> {
  return apiRequest<RefineResponse>("/api/cluster/refine", {
    method: "POST",
    body: JSON.stringify({ topics, documents, previousSuggestions, focusAreas }),
  })
}

// ===== Zmiana nazwy =====

interface RenameResponse {
  topicId: number
  newLabel: string
  updated: boolean
  timestamp: string
}

export async function renameTopic(
  topicId: number,
  newLabel: string
): Promise<RenameResponse> {
  return apiRequest<RenameResponse>("/api/cluster/rename", {
    method: "PATCH",
    body: JSON.stringify({ topicId, newLabel }),
  })
}

// ===== Merge =====

interface MergeResponse extends ClusteringResult {
  mergeInfo: {
    mergedClusterIds: number[]
    newClusterId: number
    newLabel: string
    documentsAffected: number
  }
}

export async function mergeClusters(
  clusterIds: number[],
  newLabel: string,
  documents: DocumentItem[],
  topics: ClusterTopic[]
): Promise<MergeResponse> {
  return apiRequest<MergeResponse>("/api/cluster/merge", {
    method: "POST",
    body: JSON.stringify({ clusterIds, newLabel, documents, topics }),
  })
}

// ===== Split =====

interface SplitResponse extends ClusteringResult {
  splitInfo: {
    originalClusterId: number
    newClusterIds: number[]
    numSubclusters: number
    documentsAffected: number
  }
}

export async function splitCluster(
  clusterId: number,
  numSubclusters: number,
  documents: DocumentItem[],
  topics: ClusterTopic[]
): Promise<SplitResponse> {
  return apiRequest<SplitResponse>("/api/cluster/split", {
    method: "POST",
    body: JSON.stringify({ clusterId, numSubclusters, documents, topics }),
  })
}

// ===== Reclassify =====

interface ReclassifyResponse extends ClusteringResult {
  reclassifyInfo: {
    documentIds: string[]
    fromClusterId: number
    toClusterId: number
    documentsAffected: number
  }
}

export async function reclassifyDocuments(
  documentIds: string[],
  fromClusterId: number,
  toClusterId: number,
  documents: DocumentItem[],
  topics: ClusterTopic[]
): Promise<ReclassifyResponse> {
  return apiRequest<ReclassifyResponse>("/api/cluster/reclassify", {
    method: "POST",
    body: JSON.stringify({ documentIds, fromClusterId, toClusterId, documents, topics }),
  })
}

// ===== Export =====

export async function exportReport(
  result: ClusteringResult,
  format: "text" | "csv" | "json" = "text",
  options: { language?: "pl" | "en"; includeExamples?: boolean; includeLLMInsights?: boolean } = {}
): Promise<Blob | Record<string, unknown>> {
  const { language = "pl", includeExamples = true, includeLLMInsights = true } = options

  const response = await fetch("/api/cluster/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result, format, language, includeExamples, includeLLMInsights }),
  })

  if (!response.ok) {
    let errorBody: { error?: ApiError } | null = null
    try {
      errorBody = await response.json()
    } catch {
      // Not JSON
    }
    if (errorBody?.error) throw new ClusteringApiError(errorBody.error)
    throw new Error(`Export failed: ${response.status}`)
  }

  if (format === "json") {
    return response.json()
  }

  return response.blob()
}

// ===== Health =====

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy"
  components: Record<string, { status: string; model?: string; latencyMs?: number; version?: string }>
  timestamp: string
  version: string
}

export async function checkHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>("/api/health", { method: "GET" })
}

// ===== Download helper =====

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ===== Client-side job store (persisted to sessionStorage) =====
// In production, this would come from the Python backend/Redis.
// For the mock mode, we keep a local store so users can navigate away and back.

const JOBS_STORAGE_KEY = "tdh_saved_jobs"

function loadJobsFromStorage(): SavedJob[] {
  if (typeof window === "undefined") return []
  try {
    const raw = sessionStorage.getItem(JOBS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveJobsToStorage(jobs: SavedJob[]): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(jobs))
  } catch {
    // Storage full or unavailable
  }
}

export function saveJob(job: SavedJob): void {
  const jobs = loadJobsFromStorage()
  const idx = jobs.findIndex((j) => j.jobId === job.jobId)
  if (idx >= 0) {
    jobs[idx] = job
  } else {
    jobs.unshift(job) // newest first
  }
  // Keep max 50 jobs
  saveJobsToStorage(jobs.slice(0, 50))
}

export function updateJob(jobId: string, partial: Partial<SavedJob>): void {
  const jobs = loadJobsFromStorage()
  const idx = jobs.findIndex((j) => j.jobId === jobId)
  if (idx >= 0) {
    jobs[idx] = { ...jobs[idx], ...partial, updatedAt: new Date().toISOString() }
    saveJobsToStorage(jobs)
  }
}

export function getJob(jobId: string): SavedJob | null {
  const jobs = loadJobsFromStorage()
  return jobs.find((j) => j.jobId === jobId) ?? null
}

export function listJobs(): SavedJob[] {
  return loadJobsFromStorage()
}

export function deleteJob(jobId: string): void {
  const jobs = loadJobsFromStorage().filter((j) => j.jobId !== jobId)
  saveJobsToStorage(jobs)
}
