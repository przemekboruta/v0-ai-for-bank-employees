import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isPythonBackendEnabled()) {
    return NextResponse.json(
      { error: { code: "BACKEND_REQUIRED", message: "Backend wymagany." } },
      { status: 503 }
    )
  }
  const body = await request.json()
  return proxyToBackend(`/api/taxonomy/${id}/category`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}
