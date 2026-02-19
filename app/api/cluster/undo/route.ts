import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"

/**
 * POST /api/cluster/undo
 *
 * Cofnij ostatnią operację (merge/split/reclassify/rename).
 * Wymaga backendu Python z Redis – zwraca poprzedni stan wyniku.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { jobId } = body as { jobId?: string }

    if (!jobId) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pole 'jobId' jest wymagane.",
          },
        },
        { status: 400 }
      )
    }

    if (isPythonBackendEnabled()) {
      return proxyToBackend("/cluster/undo", {
        method: "POST",
        body: JSON.stringify({ jobId }),
      })
    }

    return NextResponse.json(
      {
        error: {
          code: "NOT_AVAILABLE",
          message: "Cofnięcie jest dostępne tylko z backendem Python (Redis).",
        },
      },
      { status: 501 }
    )
  } catch (error) {
    console.error("[undo] Error:", error)
    return NextResponse.json(
      {
        error: {
          code: "PIPELINE_ERROR",
          message: "Nie udało się cofnąć operacji.",
        },
      },
      { status: 500 }
    )
  }
}
