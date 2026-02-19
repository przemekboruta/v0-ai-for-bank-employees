import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"
import type {
  ClusterTopic,
  DocumentItem,
  ClusteringResult,
} from "@/lib/clustering-types"
import { CLUSTER_COLORS } from "@/lib/clustering-types"

/**
 * POST /api/cluster/split
 *
 * Dzieli klaster na 2+ podklastrow.
 * - PYTHON_BACKEND_URL -> proxy do FastAPI (KMeans na embeddingach)
 * - brak -> podzial po medianie X
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { clusterId, numSubclusters = 2, documents, topics } = body as {
      clusterId: number
      numSubclusters?: number
      documents: DocumentItem[]
      topics: ClusterTopic[]
    }

    if (isPythonBackendEnabled()) {
      return proxyToBackend("/api/cluster/split", {
        method: "POST",
        body: JSON.stringify(body),
      })
    }

    if (clusterId === undefined || clusterId === null) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pole 'clusterId' jest wymagane.",
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

    const targetTopic = topics.find((t) => t.id === clusterId)
    if (!targetTopic) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: `Nie znaleziono topiku o id ${clusterId}.`,
          },
        },
        { status: 400 }
      )
    }

    const clusterDocs = documents.filter((d) => d.clusterId === clusterId)
    if (clusterDocs.length < numSubclusters * 3) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: `Klaster ma za mało dokumentów (${clusterDocs.length}), aby podzielić na ${numSubclusters} części.`,
          },
        },
        { status: 400 }
      )
    }

    // Symulacja LLM delay
    await new Promise((resolve) => setTimeout(resolve, 200))

    // --- MOCK: Dziel na podstawie mediany X ---
    // PRODUCTION: uruchom mini-HDBSCAN na embeddingach podzbióru
    const sortedByX = [...clusterDocs].sort((a, b) => a.x - b.x)
    const splitPoint = Math.floor(sortedByX.length / numSubclusters)

    // Nowe id dla podklastrow (zawsze nowe, zeby dzialalo tez dla Szumu clusterId -1)
    const maxTopicId = Math.max(0, ...topics.map((t) => t.id))
    const newTopicIds = Array.from(
      { length: numSubclusters },
      (_, i) => maxTopicId + 1 + i
    )

    // Przypisz dokumenty do podklastrow
    const docAssignments = new Map<string, number>()
    sortedByX.forEach((doc, idx) => {
      const subclusterIdx = Math.min(
        Math.floor(idx / splitPoint),
        numSubclusters - 1
      )
      docAssignments.set(doc.id, newTopicIds[subclusterIdx])
    })

    // Zaktualizuj dokumenty
    const updatedDocuments = documents.map((doc) => {
      const newId = docAssignments.get(doc.id)
      if (newId !== undefined) {
        return { ...doc, clusterId: newId }
      }
      return doc
    })

    // Wygeneruj nowe topiki
    const newTopics: ClusterTopic[] = newTopicIds.map((newId, idx) => {
      const subDocs = updatedDocuments.filter((d) => d.clusterId === newId)
      const cx = subDocs.reduce((sum, d) => sum + d.x, 0) / subDocs.length
      const cy = subDocs.reduce((sum, d) => sum + d.y, 0) / subDocs.length

      // Użyj kolorów z palety
      const usedColorIndices = new Set(
        topics.filter((t) => t.id !== clusterId).map((t) => CLUSTER_COLORS.indexOf(t.color))
      )
      let colorIdx = CLUSTER_COLORS.indexOf(targetTopic.color)
      if (idx > 0) {
        for (let c = 0; c < CLUSTER_COLORS.length; c++) {
          if (!usedColorIndices.has(c)) {
            colorIdx = c
            usedColorIndices.add(c)
            break
          }
        }
      }

      return {
        id: newId,
        label: `${targetTopic.label} (podgrupa ${idx + 1})`,
        description: `Podgrupa ${idx + 1} z oryginalnego klastra "${targetTopic.label}". ${subDocs.length} dokumentów.`,
        documentCount: subDocs.length,
        sampleTexts: subDocs.slice(0, 3).map((d) => d.text),
        color: CLUSTER_COLORS[colorIdx % CLUSTER_COLORS.length],
        centroidX: cx,
        centroidY: cy,
        coherenceScore: targetTopic.coherenceScore * (0.9 + Math.random() * 0.15),
        keywords: targetTopic.keywords.slice(
          idx * Math.ceil(targetTopic.keywords.length / numSubclusters),
          (idx + 1) * Math.ceil(targetTopic.keywords.length / numSubclusters)
        ),
      }
    })

    // Usun oryginalny topik (w tym Szum -1) i dodaj nowe
    const updatedTopics = [
      ...topics.filter((t) => t.id !== clusterId),
      ...newTopics,
    ].sort((a, b) => a.id - b.id)

    const result: ClusteringResult = {
      documents: updatedDocuments,
      topics: updatedTopics,
      llmSuggestions: [],
      totalDocuments: updatedDocuments.length,
      noise: updatedDocuments.filter((d) => d.clusterId === -1).length,
    }

    return NextResponse.json({
      ...result,
      splitInfo: {
        originalClusterId: clusterId,
        newClusterIds: newTopicIds,
        numSubclusters,
        documentsAffected: clusterDocs.length,
      },
    })
  } catch (error) {
    console.error("[split] Error:", error)
    return NextResponse.json(
      {
        error: {
          code: "PIPELINE_ERROR",
          message: "Nie udalo sie podzielic klastra.",
        },
      },
      { status: 500 }
    )
  }
}
