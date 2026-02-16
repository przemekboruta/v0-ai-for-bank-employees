import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"

/**
 * GET /api/cluster/encoders
 *
 * List available encoder models for advanced config.
 * - PYTHON_BACKEND_URL -> proxy to FastAPI
 * - brak -> mock: return empty list (UI will show default only)
 */
export async function GET() {
  if (isPythonBackendEnabled()) {
    return proxyToBackend("/api/cluster/encoders", { method: "GET" })
  }
  return NextResponse.json({ models: [] })
}
