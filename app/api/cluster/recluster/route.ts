import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"

/**
 * POST /api/cluster/recluster
 *
 * Re-cluster using cached embeddings from a previous job.
 * - PYTHON_BACKEND_URL -> proxy to FastAPI (real Redis-cached embeddings)
 * - brak -> mock: return new jobId (embeddings skip is simulated in frontend)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()

    // === PRODUCTION: proxy ===
    if (isPythonBackendEnabled()) {
      return proxyToBackend("/api/cluster/recluster", {
        method: "POST",
        body: JSON.stringify(body),
      })
    }

    // === MOCK ===
    const { jobId, config } = body as {
      jobId: string
      config: Record<string, unknown>
    }

    if (!jobId) {
      return NextResponse.json(
        { error: { code: "MISSING_JOB_ID", message: "Wymagany jobId do recluster." } },
        { status: 400 }
      )
    }

    const newJobId = `mock-recluster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    return NextResponse.json({
      jobId: newJobId,
      status: "queued",
      cachedFrom: jobId,
    })
  } catch (error) {
    console.error("[recluster] Error:", error)
    return NextResponse.json(
      { error: { code: "RECLUSTER_ERROR", message: "Blad reclusteru." } },
      { status: 500 }
    )
  }
}
