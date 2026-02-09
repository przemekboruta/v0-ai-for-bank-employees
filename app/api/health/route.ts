import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"

/**
 * GET /api/health
 *
 * Healthcheck.
 * - PYTHON_BACKEND_URL -> proxy do FastAPI (rzeczywisty status)
 * - brak -> symulowany "up"
 */
export async function GET() {
  if (isPythonBackendEnabled()) {
    return proxyToBackend("/api/health", { method: "GET" })
  }
  const now = new Date().toISOString()

  // PRODUCTION:
  // const encoderHealth = await checkService(ENCODER_API_URL + '/health')
  // const llmHealth = await checkService(LLM_API_BASE_URL + '/models')
  // ...

  const components = {
    encoder: {
      status: "up" as const,
      model: process.env.ENCODER_MODEL_NAME ?? "mock-encoder-v1",
      latencyMs: Math.round(20 + Math.random() * 40),
    },
    umap: {
      status: "up" as const,
      version: "0.5.5",
    },
    hdbscan: {
      status: "up" as const,
      version: "0.8.33",
    },
    llm: {
      status: "up" as const,
      model: process.env.LLM_MODEL ?? "mock-llm",
      latencyMs: Math.round(200 + Math.random() * 300),
    },
  }

  const allUp = Object.values(components).every((c) => c.status === "up")

  return NextResponse.json({
    status: allUp ? "healthy" : "degraded",
    components,
    timestamp: now,
    version: "1.0.0",
    environment: process.env.NODE_ENV ?? "development",
  })
}
