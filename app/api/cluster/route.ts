import { NextResponse } from "next/server"
import type { Granularity } from "@/lib/clustering-types"
import { generateMockClustering } from "@/lib/mock-clustering"

/**
 * POST /api/cluster
 *
 * Glowna klasteryzacja -- uruchamia pelen pipeline:
 *   1. Encoder (embeddingi)
 *   2. UMAP (redukcja do 2D)
 *   3. HDBSCAN (klasteryzacja)
 *   4. LLM (etykiety + sugestie)
 *
 * W trybie MOCK: generuje realistyczne dane bankowe.
 * W trybie PRODUCTION: podlaczyc pod prawdziwy pipeline.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      texts,
      granularity,
      iteration = 0,
    } = body as {
      texts: string[]
      granularity: Granularity
      iteration?: number
    }

    // --- Walidacja ---
    if (!texts || !Array.isArray(texts)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pole 'texts' jest wymagane i musi byc tablica stringow.",
          },
        },
        { status: 400 }
      )
    }

    if (texts.length < 10) {
      return NextResponse.json(
        {
          error: {
            code: "TOO_FEW_TEXTS",
            message: `Wymagane minimum 10 tekstow do analizy. Otrzymano: ${texts.length}.`,
            details: { received: texts.length, minimum: 10 },
          },
        },
        { status: 400 }
      )
    }

    if (texts.length > 50000) {
      return NextResponse.json(
        {
          error: {
            code: "TOO_MANY_TEXTS",
            message: `Maksymalnie 50000 tekstow. Otrzymano: ${texts.length}.`,
            details: { received: texts.length, maximum: 50000 },
          },
        },
        { status: 413 }
      )
    }

    if (!["low", "medium", "high"].includes(granularity)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message:
              "Pole 'granularity' musi miec wartosc: 'low', 'medium' lub 'high'.",
          },
        },
        { status: 400 }
      )
    }

    // --- Symulacja opoznienia pipeline'u ---
    await new Promise((resolve) => setTimeout(resolve, 200))

    // --- MOCK: Replace with real pipeline ---
    //
    // PRODUCTION:
    // const embeddings = await fetch(ENCODER_API_URL, {
    //   method: 'POST',
    //   body: JSON.stringify({ texts, batch_size: 64 })
    // }).then(r => r.json())
    //
    // const { coords, labels, probabilities } = await fetch(CLUSTER_SERVICE_URL, {
    //   method: 'POST',
    //   body: JSON.stringify({ embeddings, granularity })
    // }).then(r => r.json())
    //
    // const { topics, suggestions } = await fetch(LLM_SERVICE_URL, {
    //   method: 'POST',
    //   body: JSON.stringify({ texts, labels, coords })
    // }).then(r => r.json())

    const pipelineStart = Date.now()
    const result = generateMockClustering(texts, granularity, 42 + iteration)
    const pipelineDuration = Date.now() - pipelineStart

    return NextResponse.json({
      ...result,
      meta: {
        pipelineDurationMs: pipelineDuration + 200,
        encoderModel: "mock-encoder-v1",
        umapParams: { n_neighbors: 15, min_dist: 0.1, n_components: 2 },
        hdbscanParams: getHDBSCANParams(granularity),
        llmModel: "mock-llm",
        iteration,
      },
    })
  } catch (error) {
    console.error("[cluster] Pipeline error:", error)
    return NextResponse.json(
      {
        error: {
          code: "PIPELINE_ERROR",
          message: "Wystapil blad podczas przetwarzania pipeline'u ML.",
        },
      },
      { status: 500 }
    )
  }
}

function getHDBSCANParams(granularity: Granularity) {
  const config = {
    low: {
      min_cluster_size: 50,
      min_samples: 15,
      cluster_selection_epsilon: 0.5,
    },
    medium: {
      min_cluster_size: 20,
      min_samples: 8,
      cluster_selection_epsilon: 0.3,
    },
    high: {
      min_cluster_size: 8,
      min_samples: 3,
      cluster_selection_epsilon: 0.1,
    },
  }
  return config[granularity]
}
