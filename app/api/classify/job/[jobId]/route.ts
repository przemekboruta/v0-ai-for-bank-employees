import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  if (!isPythonBackendEnabled()) {
    return NextResponse.json(
      { error: { code: "BACKEND_REQUIRED", message: "Backend wymagany." } },
      { status: 503 }
    )
  }
  return proxyToBackend(`/api/classify/job/${jobId}`, { method: "GET" })
}
