import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"

export async function POST(request: Request) {
  if (!isPythonBackendEnabled()) {
    return NextResponse.json(
      { error: { code: "BACKEND_REQUIRED", message: "Backend wymagany dla dotrenowania modelu." } },
      { status: 503 }
    )
  }
  const body = await request.json()
  return proxyToBackend("/api/classify/retrain", {
    method: "POST",
    body: JSON.stringify(body),
  })
}
