import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"

/**
 * GET /api/cluster/jobs
 *
 * List all known clustering jobs.
 * - PYTHON_BACKEND_URL -> proxy to FastAPI (Redis-backed list)
 * - brak -> return empty list (mock jobs are stored client-side in sessionStorage)
 */
export async function GET() {
  if (isPythonBackendEnabled()) {
    return proxyToBackend("/api/cluster/jobs", { method: "GET" })
  }

  // Mock mode: jobs are tracked in the browser sessionStorage, not on the server
  return NextResponse.json({ jobs: [] })
}
