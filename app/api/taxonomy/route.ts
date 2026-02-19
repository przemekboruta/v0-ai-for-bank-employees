import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"

export async function GET() {
  if (!isPythonBackendEnabled()) {
    return NextResponse.json({ taxonomies: [] })
  }
  return proxyToBackend("/api/taxonomy", { method: "GET" })
}

export async function POST(request: Request) {
  if (!isPythonBackendEnabled()) {
    return NextResponse.json(
      { error: { code: "BACKEND_REQUIRED", message: "Backend wymagany dla taksonomii." } },
      { status: 503 }
    )
  }
  const body = await request.json()
  return proxyToBackend("/api/taxonomy", {
    method: "POST",
    body: JSON.stringify(body),
  })
}
