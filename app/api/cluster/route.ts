import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"
import { generateMockClustering } from "@/lib/mock-clustering"
import type { Granularity } from "@/lib/clustering-types"

/**
 * POST /api/cluster
 *
 * Glowna klasteryzacja.
 * - PYTHON_BACKEND_URL ustawiony -> proxy do FastAPI (prawdziwy pipeline ML)
 * - brak -> mock pipeline (demo)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { texts, granularity, iteration = 0 } = body as {
      texts: string[]
      granularity: Granularity
      iteration?: number
    }

    if (!texts || !Array.isArray(texts) || texts.length < 10) {
      return NextResponse.json(
        { error: { code: "TOO_FEW_TEXTS", message: `Wymagane minimum 10 tekstow, otrzymano ${texts?.length ?? 0}.` } },
        { status: 400 }
      )
    }
    if (texts.length > 50000) {
      return NextResponse.json(
        { error: { code: "TOO_MANY_TEXTS", message: `Maksymalnie 50000 tekstow. Otrzymano: ${texts.length}.` } },
        { status: 413 }
      )
    }
    if (!["low", "medium", "high"].includes(granularity)) {
      return NextResponse.json(
        { error: { code: "INVALID_GRANULARITY", message: "Granularity musi byc: low, medium lub high." } },
        { status: 400 }
      )
    }

    // === PRODUCTION: proxy do Python backend ===
    if (isPythonBackendEnabled()) {
      return proxyToBackend("/api/cluster", {
        method: "POST",
        body: JSON.stringify({ texts, granularity, iteration }),
      })
    }

    // === MOCK ===
    await new Promise((resolve) => setTimeout(resolve, 200))
    const pipelineStart = Date.now()
    const result = generateMockClustering(texts, granularity, 42 + iteration)
    const pipelineDuration = Date.now() - pipelineStart

    const hdbscanConfigs = {
      low: { min_cluster_size: 50, min_samples: 15, cluster_selection_epsilon: 0.5 },
      medium: { min_cluster_size: 20, min_samples: 8, cluster_selection_epsilon: 0.3 },
      high: { min_cluster_size: 8, min_samples: 3, cluster_selection_epsilon: 0.1 },
    }

    return NextResponse.json({
      ...result,
      meta: {
        pipelineDurationMs: pipelineDuration + 200,
        encoderModel: "mock-encoder-v1",
        umapParams: { n_neighbors: 15, min_dist: 0.1, n_components: 2 },
        hdbscanParams: hdbscanConfigs[granularity],
        llmModel: "mock-llm",
        iteration,
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
