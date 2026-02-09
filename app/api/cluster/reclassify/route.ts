import { NextResponse } from "next/server"
import type {
  ClusterTopic,
  DocumentItem,
  ClusteringResult,
} from "@/lib/clustering-types"

/**
 * POST /api/cluster/reclassify
 *
 * Przenosi dokumenty miedzy klastrami.
 * W trybie MOCK: po prostu zmienia clusterId.
 * W trybie PRODUCTION: moze przeliczac koherencje, centroidy, keywords.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { documentIds, fromClusterId, toClusterId, documents, topics } = body as {
      documentIds: string[]
      fromClusterId: number
      toClusterId: number
      documents: DocumentItem[]
      topics: ClusterTopic[]
    }

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pole 'documentIds' jest wymagane i musi zawierac co najmniej 1 id.",
          },
        },
        { status: 400 }
      )
    }

    if (fromClusterId === undefined || toClusterId === undefined) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pola 'fromClusterId' i 'toClusterId' sa wymagane.",
          },
        },
        { status: 400 }
      )
    }

    if (fromClusterId === toClusterId) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Klaster zrodlowy i docelowy nie moga byc takie same.",
          },
        },
        { status: 400 }
      )
    }

    if (!documents || !topics) {
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

    const docIdSet = new Set(documentIds)

    // Przenies dokumenty
    const updatedDocuments = documents.map((doc) => {
      if (docIdSet.has(doc.id) && doc.clusterId === fromClusterId) {
        return { ...doc, clusterId: toClusterId }
      }
      return doc
    })

    // Przelicz liczby dokumentow i centroidy
    const updatedTopics = topics.map((topic) => {
      const topicDocs = updatedDocuments.filter((d) => d.clusterId === topic.id)
      if (topic.id === fromClusterId || topic.id === toClusterId) {
        const cx = topicDocs.length > 0
          ? topicDocs.reduce((sum, d) => sum + d.x, 0) / topicDocs.length
          : topic.centroidX
        const cy = topicDocs.length > 0
          ? topicDocs.reduce((sum, d) => sum + d.y, 0) / topicDocs.length
          : topic.centroidY
        return {
          ...topic,
          documentCount: topicDocs.length,
          centroidX: cx,
          centroidY: cy,
        }
      }
      return topic
    })

    const result: ClusteringResult = {
      documents: updatedDocuments,
      topics: updatedTopics,
      llmSuggestions: [],
      totalDocuments: updatedDocuments.length,
      noise: updatedDocuments.filter((d) => d.clusterId === -1).length,
    }

    return NextResponse.json({
      ...result,
      reclassifyInfo: {
        documentIds,
        fromClusterId,
        toClusterId,
        documentsAffected: documentIds.length,
      },
    })
  } catch (error) {
    console.error("[reclassify] Error:", error)
    return NextResponse.json(
      {
        error: {
          code: "PIPELINE_ERROR",
          message: "Nie udalo sie reklasyfikowac dokumentow.",
        },
      },
      { status: 500 }
    )
  }
}
