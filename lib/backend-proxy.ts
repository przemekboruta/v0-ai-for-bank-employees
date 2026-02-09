/**
 * Backend Proxy Utility
 *
 * Gdy ustawiona jest zmienna PYTHON_BACKEND_URL, Next.js API routes
 * proxyuja requesty do prawdziwego backendu Python (FastAPI).
 * Bez tej zmiennej dzialaja w trybie MOCK (lokalne symulacje).
 *
 * Schemat:
 *   Frontend -> Next.js API Route -> (proxy) -> Python FastAPI
 *                                 -> (mock)  -> lokalna logika
 */

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL ?? ""

/**
 * Czy backend Python jest skonfigurowany?
 */
export function isPythonBackendEnabled(): boolean {
  return PYTHON_BACKEND_URL.length > 0
}

/**
 * Proxyuje request do backendu Python.
 * Zachowuje metode, headery i body z oryginalnego requestu.
 *
 * @param path   Sciezka API na backendzie, np. "/api/cluster"
 * @param init   fetch RequestInit (method, body, headers)
 * @returns      Response z backendu Python
 */
export async function proxyToBackend(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = `${PYTHON_BACKEND_URL}${path}`

  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string>),
    },
  })

  // Przekaz response content-type z backendu
  const contentType = response.headers.get("content-type") ?? "application/json"

  if (contentType.includes("application/json")) {
    const data = await response.json()
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Dla CSV, text, etc. -- streamuj body
  const blob = await response.blob()
  return new Response(blob, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
      ...(response.headers.get("content-disposition")
        ? { "Content-Disposition": response.headers.get("content-disposition")! }
        : {}),
    },
  })
}
