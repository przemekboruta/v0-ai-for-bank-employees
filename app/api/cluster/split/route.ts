import { NextResponse } from "next/server"
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
 * W trybie MOCK: dzieli losowo na podstawie pozycji 2D (mediana X).
 * W trybie PRODUCTION: uruchamia mini-HDBSCAN na podzbiorze embeddingów.
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
            message: `Klaster ma za malo dokumentow (${clusterDocs.length}) aby podzielic na ${numSubclusters} czesci.`,
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

    // Znajdz najwyzsze id topiku dla nowych id
    const maxTopicId = Math.max(...topics.map((t) => t.id))
    const newTopicIds = Array.from({ length: numSubclusters }, (_, i) =>
      i === 0 ? clusterId : maxTopicId + i
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

      // Uzyj kolorow z palety
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
        description: `Podgrupa ${idx + 1} z oryginalnego klastra "${targetTopic.label}". ${subDocs.length} dokumentow.`,
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

    // Zastap oryginalny topik nowymi
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
