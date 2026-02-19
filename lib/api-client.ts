import type {
  Granularity,
  ClusteringResult,
  ClusterTopic,
  DocumentItem,
  LLMSuggestion,
  ClusteringConfig,
  JobInfo,
  SavedJob,
  CategoryDefinition,
  TaxonomyInfo,
  ClassificationResult,
  TrainingJobInfo,
  ModelInfo,
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

/**
 * List available encoder models (for advanced config).
 * When backend is disabled, returns empty list (frontend will show default only).
 */
export async function listEncoders(): Promise<{ models: string[] }> {
  try {
    return await apiRequest<{ models: string[] }>("/api/cluster/encoders", {
      method: "GET",
    })
  } catch {
    return { models: [] }
  }
}

// ===== Fetch job result (when completed) =====

/**
 * Fetch the clustering result for a completed job.
 * The Python backend includes result in GET /cluster/job/:id when status=completed,
 * so this just calls getJobStatus and extracts the result field.
 */
export async function getJobResult(jobId: string): Promise<ClusteringResult | null> {
  const data = await getJobStatus(jobId)
  if (data.status === "completed" && data.result) {
    return data.result as ClusteringResult
  }
  return null
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
  newLabel: string,
  jobId?: string
): Promise<RenameResponse> {
  return apiRequest<RenameResponse>("/api/cluster/rename", {
    method: "PATCH",
    body: JSON.stringify({ topicId, newLabel, jobId }),
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
  topics: ClusterTopic[],
  jobId?: string
): Promise<MergeResponse> {
  return apiRequest<MergeResponse>("/api/cluster/merge", {
    method: "POST",
    body: JSON.stringify({ clusterIds, newLabel, documents, topics, jobId }),
  })
}

// ===== Reclassify =====

interface ReclassifyResponse extends ClusteringResult {
  reclassifyInfo: {
    fromClusterIds: number[]
    numClusters: number
    newClusterIds: number[]
    documentsAffected: number
  }
}

export async function reclassifyDocuments(
  fromClusterIds: number[],
  numClusters: number,
  documents: DocumentItem[],
  topics: ClusterTopic[],
  jobId?: string
): Promise<ReclassifyResponse> {
  return apiRequest<ReclassifyResponse>("/api/cluster/reclassify", {
    method: "POST",
    body: JSON.stringify({ fromClusterIds, numClusters, documents, topics, jobId }),
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

// ===== Taxonomy =====

export async function createTaxonomy(name: string, description = ""): Promise<TaxonomyInfo> {
  return apiRequest<TaxonomyInfo>("/api/taxonomy", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  })
}

export async function listTaxonomies(): Promise<TaxonomyInfo[]> {
  const data = await apiRequest<{ taxonomies: TaxonomyInfo[] }>("/api/taxonomy", { method: "GET" })
  return data.taxonomies ?? []
}

export async function getTaxonomy(taxonomyId: string): Promise<TaxonomyInfo> {
  return apiRequest<TaxonomyInfo>(`/api/taxonomy/${taxonomyId}`, { method: "GET" })
}

export async function deleteTaxonomy(taxonomyId: string): Promise<void> {
  await apiRequest(`/api/taxonomy/${taxonomyId}`, { method: "DELETE" })
}

export async function addCategory(
  taxonomyId: string,
  name: string,
  examples: string[] = [],
  description = ""
): Promise<CategoryDefinition> {
  return apiRequest<CategoryDefinition>(`/api/taxonomy/${taxonomyId}/category`, {
    method: "POST",
    body: JSON.stringify({ name, examples, description }),
  })
}

export async function updateCategory(
  taxonomyId: string,
  categoryId: string,
  updates: { name?: string; examples?: string[]; description?: string }
): Promise<CategoryDefinition> {
  return apiRequest<CategoryDefinition>(`/api/taxonomy/${taxonomyId}/category/${categoryId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  })
}

export async function deleteCategory(taxonomyId: string, categoryId: string): Promise<void> {
  await apiRequest(`/api/taxonomy/${taxonomyId}/category/${categoryId}`, { method: "DELETE" })
}

export async function promoteClusters(
  taxonomyId: string,
  clusterIds: number[],
  clusteringResult: ClusteringResult
): Promise<{ imported: number; categories: CategoryDefinition[] }> {
  return apiRequest(`/api/taxonomy/${taxonomyId}/import-clusters`, {
    method: "POST",
    body: JSON.stringify({ clusterIds, clusteringResult }),
  })
}

export async function importTemplate(
  taxonomyId: string,
  templateName: string
): Promise<{ imported: number; categories: CategoryDefinition[] }> {
  return apiRequest(`/api/taxonomy/${taxonomyId}/import-template`, {
    method: "POST",
    body: JSON.stringify({ templateName }),
  })
}

// ===== Classification =====

export async function submitTrainingJob(params: {
  taxonomyId?: string
  categories?: CategoryDefinition[]
  backboneModel?: string
  numIterations?: number
  batchSize?: number
  modelName?: string
  texts?: string[]
}): Promise<{ jobId: string; status: string }> {
  return apiRequest("/api/classify", {
    method: "POST",
    body: JSON.stringify(params),
  })
}

export async function getTrainingStatus(jobId: string): Promise<TrainingJobInfo> {
  return apiRequest<TrainingJobInfo>(`/api/classify/job/${jobId}`, { method: "GET" })
}

export async function predictWithModel(
  texts: string[],
  modelId?: string,
  jobId?: string
): Promise<ClassificationResult> {
  return apiRequest<ClassificationResult>("/api/classify/predict", {
    method: "POST",
    body: JSON.stringify({ texts, modelId, jobId }),
  })
}

export async function batchClassify(
  texts: string[],
  modelId: string
): Promise<ClassificationResult> {
  return apiRequest<ClassificationResult>("/api/classify/batch", {
    method: "POST",
    body: JSON.stringify({ texts, modelId }),
  })
}

// ===== Active Learning: Retrain =====

export interface CorrectedDocument {
  text: string
  correctedCategoryName: string
}

export async function submitRetrain(params: {
  modelId: string
  corrections: CorrectedDocument[]
  texts?: string[]
  numIterations?: number
}): Promise<{ jobId: string; status: string }> {
  return apiRequest("/api/classify/retrain", {
    method: "POST",
    body: JSON.stringify(params),
  })
}

// ===== Models =====

export async function listModels(): Promise<ModelInfo[]> {
  const data = await apiRequest<{ models: ModelInfo[] }>("/api/models", { method: "GET" })
  return data.models ?? []
}

export async function getModelInfo(modelId: string): Promise<ModelInfo> {
  return apiRequest<ModelInfo>(`/api/models/${modelId}`, { method: "GET" })
}

export async function deleteModel(modelId: string): Promise<void> {
  await apiRequest(`/api/models/${modelId}`, { method: "DELETE" })
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

// ===== List backend jobs =====

export interface BackendJobSummary {
  jobId: string
  status: string
  progress: number
  textCount: number
  config: ClusteringConfig | Record<string, unknown>
  createdAt: string
  updatedAt: string
  error?: string
}

/**
 * List all jobs known to the backend (Redis).
 * Returns empty array if backend is not connected.
 */
export async function listBackendJobs(): Promise<BackendJobSummary[]> {
  try {
    const data = await apiRequest<{ jobs: BackendJobSummary[] }>("/api/cluster/jobs", {
      method: "GET",
    })
    return data.jobs ?? []
  } catch {
    return []
  }
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

/**
 * Delete a job from backend and/or local storage.
 * - If backend is enabled: calls DELETE API endpoint
 * - Always removes from local storage (for mock jobs)
 */
export async function deleteJob(jobId: string): Promise<void> {
  try {
    // Try to delete from backend if available
    await apiRequest<{ jobId: string; deleted: boolean }>(
      `/api/cluster/job/${jobId}`,
      {
        method: "DELETE",
      }
    )
  } catch (error) {
    // Backend might not be available or job might not exist in backend
    // Continue to delete from local storage anyway
    console.warn(`Failed to delete job ${jobId} from backend:`, error)
  }

  // Always remove from local storage (for mock jobs or as fallback)
  const jobs = loadJobsFromStorage().filter((j) => j.jobId !== jobId)
  saveJobsToStorage(jobs)
}
