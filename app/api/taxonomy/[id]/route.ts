import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isPythonBackendEnabled()) {
    return NextResponse.json(
      { error: { code: "BACKEND_REQUIRED", message: "Backend wymagany." } },
      { status: 503 }
    )
  }
  return proxyToBackend(`/api/taxonomy/${id}`, { method: "GET" })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isPythonBackendEnabled()) {
    return NextResponse.json(
      { error: { code: "BACKEND_REQUIRED", message: "Backend wymagany." } },
      { status: 503 }
    )
  }
  return proxyToBackend(`/api/taxonomy/${id}`, { method: "DELETE" })
}
