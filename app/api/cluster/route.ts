import { NextResponse } from "next/server"
import type { Granularity } from "@/lib/clustering-types"
import { generateMockClustering } from "@/lib/mock-clustering"

/**
 * POST /api/cluster
 *
 * This endpoint simulates the full clustering pipeline.
 * In production, replace generateMockClustering with:
 *
 * 1. Call your SOTA encoder API to get embeddings
 * 2. Run UMAP dimensionality reduction
 * 3. Run HDBSCAN clustering
 * 4. Call LLM to label clusters and generate suggestions
 *
 * Expected body:
 * {
 *   texts: string[],
 *   granularity: "low" | "medium" | "high",
 *   iteration?: number
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { texts, granularity, iteration = 0 } = body as {
      texts: string[]
      granularity: Granularity
      iteration?: number
    }

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return NextResponse.json(
        { error: "Brak tekstow do analizy" },
        { status: 400 }
      )
    }

    if (!["low", "medium", "high"].includes(granularity)) {
      return NextResponse.json(
        { error: "Nieprawidlowy poziom granularnosci" },
        { status: 400 }
      )
    }

    // ----- MOCK: Replace this block with real pipeline -----
    // In production:
    //
    // const embeddings = await encoderAPI.encode(texts)
    // const reduced = await umap(embeddings, { nComponents: 2 })
    // const clusters = await hdbscan(reduced, {
    //   minClusterSize: granularity === 'low' ? 50 : granularity === 'medium' ? 20 : 10
    // })
    // const labels = await llm.labelClusters(clusters, texts)
    // const suggestions = await llm.suggestRefinements(clusters, labels)

    const result = generateMockClustering(texts, granularity, 42 + iteration)
    // -------------------------------------------------------

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: "Blad przetwarzania" },
      { status: 500 }
    )
  }
}
