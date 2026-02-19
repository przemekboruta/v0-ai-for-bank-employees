import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"

/**
 * POST /api/cluster/save-checkpoint
 *
 * Zapisuje bieżący wynik w Redis (stos undo) przed operacją merge/split/reclassify.
 * Używane wewnętrznie; wymaga backendu Python.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { jobId, result } = body as { jobId?: string; result?: unknown }

    if (!jobId || result === undefined) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pola 'jobId' i 'result' są wymagane.",
          },
        },
        { status: 400 }
      )
    }

    if (isPythonBackendEnabled()) {
      return proxyToBackend("/cluster/save-checkpoint", {
        method: "POST",
        body: JSON.stringify({ jobId, result }),
      })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[save-checkpoint] Error:", error)
    return NextResponse.json(
      {
        error: {
          code: "PIPELINE_ERROR",
          message: "Nie udało się zapisać checkpointu.",
        },
      },
      { status: 500 }
    )
  }
}
