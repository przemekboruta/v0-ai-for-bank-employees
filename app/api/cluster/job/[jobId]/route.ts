import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"

/**
 * GET /api/cluster/job/:jobId
 *
 * Poll job status.
 * - PYTHON_BACKEND_URL -> proxy to FastAPI (real Redis-backed queue)
 * - brak -> mock: return completed immediately
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  // === PRODUCTION: proxy ===
  if (isPythonBackendEnabled()) {
    return proxyToBackend(`/api/cluster/job/${jobId}`, { method: "GET" })
  }

  // === MOCK: jobs are completed instantly ===
  // The mock store is in-memory in the cluster route module
  // Since we can't reliably import from route.ts in another route,
  // we just return "completed" for any mock job ID
  if (!jobId.startsWith("mock-")) {
    return NextResponse.json(
      { error: { code: "JOB_NOT_FOUND", message: `Nie znaleziono zlecenia: ${jobId}` } },
      { status: 404 }
    )
  }

  return NextResponse.json({
    jobId,
    status: "completed",
    progress: 100,
    currentStep: "completed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    config: {},
    textCount: 0,
    // Result is already returned in the initial POST response for mock mode
    // The frontend mock pipeline doesn't actually poll this endpoint
  })
}

/**
 * DELETE /api/cluster/job/:jobId
 *
 * Delete a job and all associated data.
 * - PYTHON_BACKEND_URL -> proxy to FastAPI (real Redis deletion)
 * - brak -> mock: delete from sessionStorage
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  // === PRODUCTION: proxy ===
  if (isPythonBackendEnabled()) {
    return proxyToBackend(`/api/cluster/job/${jobId}`, { method: "DELETE" })
  }

  // === MOCK: delete from sessionStorage ===
  // Note: This is handled client-side in deleteJob() function
  // But we return success here for consistency
  return NextResponse.json({
    jobId,
    deleted: true,
  })
}
