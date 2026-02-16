import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"
import type {
  ClusterTopic,
  DocumentItem,
} from "@/lib/clustering-types"

/**
 * POST /api/cluster/generate-labels
 *
 * Generuje nazwy klastrów używając LLM.
 * - PYTHON_BACKEND_URL -> proxy do FastAPI
 * - brak -> mock: zwraca te same topiki
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { topicIds, topics, documents, jobId } = body as {
      topicIds: number[]
      topics: ClusterTopic[]
      documents: DocumentItem[]
      jobId?: string
    }

    if (isPythonBackendEnabled()) {
      return proxyToBackend("/api/cluster/generate-labels", {
        method: "POST",
        body: JSON.stringify({ topicIds, topics, documents, jobId }),
      })
    }

    // Mock: return same topics (in real implementation, this would call LLM)
    return NextResponse.json({
      updatedTopics: topics,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[generate-labels] Error:", error)
    return NextResponse.json(
      {
        error: {
          code: "LLM_ERROR",
          message: "Nie udało się wygenerować nazw.",
        },
      },
      { status: 500 }
    )
  }
}

