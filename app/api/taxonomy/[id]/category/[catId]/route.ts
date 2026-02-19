import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; catId: string }> }
) {
  const { id, catId } = await params
  if (!isPythonBackendEnabled()) {
    return NextResponse.json(
      { error: { code: "BACKEND_REQUIRED", message: "Backend wymagany." } },
      { status: 503 }
    )
  }
  const body = await request.json()
  return proxyToBackend(`/api/taxonomy/${id}/category/${catId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; catId: string }> }
) {
  const { id, catId } = await params
  if (!isPythonBackendEnabled()) {
    return NextResponse.json(
      { error: { code: "BACKEND_REQUIRED", message: "Backend wymagany." } },
      { status: 503 }
    )
  }
  return proxyToBackend(`/api/taxonomy/${id}/category/${catId}`, { method: "DELETE" })
}
