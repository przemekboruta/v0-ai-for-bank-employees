import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"
import type {
  ClusterTopic,
  DocumentItem,
  ClusteringResult,
} from "@/lib/clustering-types"

/**
 * POST /api/cluster/reclassify
 *
 * Przenosi dokumenty miedzy klastrami.
 * - PYTHON_BACKEND_URL -> proxy do FastAPI
 * - brak -> lokalne przesuniecie
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { fromClusterIds, numClusters, documents, topics, jobId, generateLabels } = body as {
      fromClusterIds: number[]
      numClusters: number
      documents: DocumentItem[]
      topics: ClusterTopic[]
      jobId?: string
      generateLabels?: boolean
    }

    if (isPythonBackendEnabled()) {
      return proxyToBackend("/api/cluster/reclassify", {
        method: "POST",
        body: JSON.stringify({ fromClusterIds, numClusters, documents, topics, jobId, generateLabels }),
      })
    }

    if (!fromClusterIds || fromClusterIds.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pole 'fromClusterIds' jest wymagane i musi zawierać co najmniej 1 id.",
          },
        },
        { status: 400 }
      )
    }

    if (!numClusters || numClusters < 1) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pole 'numClusters' jest wymagane i musi być większe od 0.",
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
            message: "Pola 'documents' i 'topics' są wymagane.",
          },
        },
        { status: 400 }
      )
    }

    // Automatically find all documents from source clusters
    const sourceClusterIdSet = new Set(sourceClusterIds)
    const documentIds = documents
      .filter((d) => sourceClusterIdSet.has(d.clusterId))
      .map((d) => d.id)
    const docIdSet = new Set(documentIds)

    // Przenies dokumenty
    const updatedDocuments = documents.map((doc) => {
      if (docIdSet.has(doc.id) && sourceClusterIdSet.has(doc.clusterId)) {
        return { ...doc, clusterId: toClusterId }
      }
      return doc
    })

    // Przelicz liczby dokumentow i centroidy
    const updatedTopics = topics.map((topic) => {
      const topicDocs = updatedDocuments.filter((d) => d.clusterId === topic.id)
      if (sourceClusterIdSet.has(topic.id) || topic.id === toClusterId) {
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
        fromClusterIds: sourceClusterIds,
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
          message: "Nie udało się reklasyfikować dokumentów.",
        },
      },
      { status: 500 }
    )
  }
}
