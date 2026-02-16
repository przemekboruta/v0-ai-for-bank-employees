import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"
import { generateMockClustering } from "@/lib/mock-clustering"
import type { ClusteringConfig, Granularity } from "@/lib/clustering-types"

/**
 * POST /api/cluster
 *
 * Submit clustering job.
 * - PYTHON_BACKEND_URL -> proxy do FastAPI (real job queue + Redis)
 * - brak -> mock: zwraca natychmiast symulowany wynik w formacie jobId
 */

// In-memory mock job store (for demo/preview only)
const mockJobs = new Map<string, {
  status: string
  progress: number
  result: ReturnType<typeof generateMockClustering> | null
  config: ClusteringConfig | { granularity: Granularity }
  textCount: number
  createdAt: string
  error?: string
}>()

export async function POST(request: Request) {
  try {
    const body = await request.json()

    // === PRODUCTION: proxy to Python backend ===
    if (isPythonBackendEnabled()) {
      return proxyToBackend("/api/cluster", {
        method: "POST",
        body: JSON.stringify(body),
      })
    }

    // === MOCK MODE ===
    const { texts, config, granularity, iteration = 0 } = body as {
      texts: string[]
      config?: ClusteringConfig
      granularity?: Granularity
      iteration?: number
    }

    if (!texts || !Array.isArray(texts) || texts.length < 10) {
      return NextResponse.json(
        { error: { code: "TOO_FEW_TEXTS", message: `Wymagane minimum 10 tekstów, otrzymano ${texts?.length ?? 0}.` } },
        { status: 400 }
      )
    }

    const effectiveGranularity = config?.granularity ?? granularity ?? "medium"

    // Generate mock result immediately but store it as a "job"
    const jobId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const result = generateMockClustering(texts, effectiveGranularity, 42 + iteration)

    mockJobs.set(jobId, {
      status: "completed",
      progress: 100,
      result,
      config: config ?? { granularity: effectiveGranularity },
      textCount: texts.length,
      createdAt: new Date().toISOString(),
    })

    // Return in legacy format for backward compatibility with runClustering()
    // AND in job format for submitClusteringJob()
    return NextResponse.json({
      // Job fields
      jobId,
      status: "queued",
      // Legacy fields
      ...result,
      meta: {
        pipelineDurationMs: 200,
        encoderModel: "mock-encoder-v1",
        umapParams: { n_neighbors: 15, min_dist: 0.1, n_components: 2 },
        hdbscanParams: { min_cluster_size: config?.minClusterSize ?? 20 },
        llmModel: "mock-llm",
        iteration,
        algorithm: config?.algorithm ?? "hdbscan",
        dimReduction: config?.dimReduction ?? "umap",
        dimReductionTarget: config?.dimReductionTarget ?? 50,
        usedCachedEmbeddings: config?.useCachedEmbeddings ?? false,
      },
    })
  } catch (error) {
    console.error("[cluster] Pipeline error:", error)
    return NextResponse.json(
      { error: { code: "PIPELINE_ERROR", message: "Blad pipeline'u klasteryzacji." } },
      { status: 500 }
    )
  }
}

// Export the mock store for the job status route
export { mockJobs }
