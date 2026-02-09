import { NextResponse } from "next/server"
import type {
  ClusterTopic,
  DocumentItem,
  ClusteringResult,
} from "@/lib/clustering-types"
import { CLUSTER_COLORS } from "@/lib/clustering-types"

/**
 * POST /api/cluster/merge
 *
 * Laczy 2+ klastrow w jeden. Przelicza centroid, koherencje, dokumenty.
 * W trybie MOCK: operuje na danych in-memory.
 * W trybie PRODUCTION: moze wywolac LLM dla nowego opisu polaczonego klastra.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { clusterIds, newLabel, documents, topics } = body as {
      clusterIds: number[]
      newLabel?: string
      documents: DocumentItem[]
      topics: ClusterTopic[]
    }

    if (!clusterIds || !Array.isArray(clusterIds) || clusterIds.length < 2) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pole 'clusterIds' wymaga co najmniej 2 id klastrow do polaczenia.",
          },
        },
        { status: 400 }
      )
    }

    if (!documents || !Array.isArray(documents) || !topics || !Array.isArray(topics)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pola 'documents' i 'topics' sa wymagane.",
          },
        },
        { status: 400 }
      )
    }

    const targetTopics = topics.filter((t) => clusterIds.includes(t.id))
    if (targetTopics.length < 2) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Nie znaleziono wystarczajacej liczby topikow do polaczenia.",
          },
        },
        { status: 400 }
      )
    }

    // Symulacja LLM delay
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Wykonaj merge
    const mergedId = clusterIds[0]
    const idsToRemove = new Set(clusterIds.slice(1))

    // Przenies dokumenty
    const updatedDocuments = documents.map((doc) => {
      if (clusterIds.includes(doc.clusterId)) {
        return { ...doc, clusterId: mergedId }
      }
      return doc
    })

    // Oblicz nowy centroid
    const mergedDocs = updatedDocuments.filter((d) => d.clusterId === mergedId)
    const centroidX = mergedDocs.reduce((sum, d) => sum + d.x, 0) / mergedDocs.length
    const centroidY = mergedDocs.reduce((sum, d) => sum + d.y, 0) / mergedDocs.length

    // Polacz keywords (unia)
    const allKeywords = [...new Set(targetTopics.flatMap((t) => t.keywords))]

    // Polacz sample texts
    const allSamples = [...new Set(targetTopics.flatMap((t) => t.sampleTexts))].slice(0, 5)

    // Srednia koherencja (w produkcji: przeliczona z silhouette)
    const avgCoherence =
      targetTopics.reduce((sum, t) => sum + t.coherenceScore, 0) / targetTopics.length

    // Polacz opisy
    const mergedDescription = targetTopics.map((t) => t.description).join(". ")

    // Nowy topik
    const mergedTopic: ClusterTopic = {
      id: mergedId,
      label: newLabel || targetTopics.map((t) => t.label).join(" + "),
      description: mergedDescription,
      documentCount: mergedDocs.length,
      sampleTexts: allSamples,
      color: targetTopics[0].color,
      centroidX,
      centroidY,
      coherenceScore: avgCoherence * 0.9, // lekka kara za polaczenie
      keywords: allKeywords.slice(0, 7),
    }

    // Usun polaczone topiki, dodaj nowy
    const updatedTopics = topics.filter((t) => !idsToRemove.has(t.id)).map((t) =>
      t.id === mergedId ? mergedTopic : t
    )

    const result: ClusteringResult = {
      documents: updatedDocuments,
      topics: updatedTopics,
      llmSuggestions: [],
      totalDocuments: updatedDocuments.length,
      noise: updatedDocuments.filter((d) => d.clusterId === -1).length,
    }

    return NextResponse.json({
      ...result,
      mergeInfo: {
        mergedClusterIds: clusterIds,
        newClusterId: mergedId,
        newLabel: mergedTopic.label,
        documentsAffected: mergedDocs.length,
      },
    })
  } catch (error) {
    console.error("[merge] Error:", error)
    return NextResponse.json(
      {
        error: {
          code: "PIPELINE_ERROR",
          message: "Nie udalo sie polaczyc klastrow.",
        },
      },
      { status: 500 }
    )
  }
}
