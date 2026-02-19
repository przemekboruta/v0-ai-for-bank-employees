import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"

export async function GET() {
  if (!isPythonBackendEnabled()) {
    return NextResponse.json({ models: [] })
  }
  return proxyToBackend("/api/models", { method: "GET" })
}
