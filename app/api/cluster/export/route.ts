import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"
import type { ClusteringResult } from "@/lib/clustering-types"

/**
 * POST /api/cluster/export
 *
 * Generuje raport w formacie text, CSV lub JSON.
 * - PYTHON_BACKEND_URL -> proxy do FastAPI
 * - brak -> generowanie lokalne
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      result,
      format = "text",
      language = "pl",
      includeExamples = true,
      includeLLMInsights = true,
    } = body as {
      result: ClusteringResult
      format?: "text" | "csv" | "json"
      language?: "pl" | "en"
      includeExamples?: boolean
      includeLLMInsights?: boolean
    }

    if (isPythonBackendEnabled()) {
      return proxyToBackend("/api/cluster/export", {
        method: "POST",
        body: JSON.stringify(body),
      })
    }

    if (!result || !result.topics || !result.documents) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pole 'result' z wynikami klasteryzacji jest wymagane.",
          },
        },
        { status: 400 }
      )
    }

    if (format === "csv") {
      const header = "id,tekst,kategoria,id_kategorii,koherencja_kategorii"
      const rows = result.documents.map((doc) => {
        const topic = result.topics.find((t) => t.id === doc.clusterId)
        const text = doc.text.replace(/"/g, '""')
        const label = (topic?.label ?? "").replace(/"/g, '""')
        return `"${doc.id}","${text}","${label}",${doc.clusterId},${topic?.coherenceScore ? Math.round(topic.coherenceScore * 100) : ""}`
      })
      const csv = [header, ...rows].join("\n")

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=klasteryzacja_wyniki.csv",
        },
      })
    }

    if (format === "json") {
      const exportData = {
        metadata: {
          exportDate: new Date().toISOString(),
          totalDocuments: result.totalDocuments,
          totalTopics: result.topics.length,
          noiseDocuments: result.noise,
          language,
        },
        topics: result.topics.map((t) => ({
          id: t.id,
          label: t.label,
          description: t.description,
          documentCount: t.documentCount,
          coherenceScore: t.coherenceScore,
          keywords: t.keywords,
          ...(includeExamples ? { sampleTexts: t.sampleTexts } : {}),
        })),
        documents: result.documents.map((d) => ({
          id: d.id,
          text: d.text,
          clusterId: d.clusterId,
          clusterLabel: result.topics.find((t) => t.id === d.clusterId)?.label ?? "N/A",
        })),
        ...(includeLLMInsights
          ? {
              llmInsights: {
                appliedSuggestions: result.llmSuggestions.filter((s) => s.applied).length,
                pendingSuggestions: result.llmSuggestions.filter((s) => !s.applied).length,
                suggestions: result.llmSuggestions,
              },
            }
          : {}),
      }

      return NextResponse.json(exportData)
    }

    // format === "text"
    const pl = language === "pl"
    const lines: string[] = []

    lines.push(pl ? "RAPORT KLASTERYZACJI TEMATYCZNEJ" : "TOPIC CLUSTERING REPORT")
    lines.push("=".repeat(50))
    lines.push("")
    lines.push(`${pl ? "Data" : "Date"}: ${new Date().toLocaleDateString(pl ? "pl-PL" : "en-US")}`)
    lines.push(`${pl ? "Liczba dokumentów" : "Documents"}: ${result.totalDocuments}`)
    lines.push(`${pl ? "Wykryte kategorie" : "Topics found"}: ${result.topics.length}`)
    lines.push(`${pl ? "Dokumenty nieskategoryzowane" : "Noise"}: ${result.noise}`)
    lines.push("")
    lines.push(pl ? "WYKRYTE KATEGORIE:" : "DISCOVERED TOPICS:")
    lines.push("-".repeat(50))
    lines.push("")

    const sorted = [...result.topics].sort((a, b) => b.documentCount - a.documentCount)

    sorted.forEach((topic, idx) => {
      const pct = ((topic.documentCount / result.totalDocuments) * 100).toFixed(1)
      lines.push(`${idx + 1}. ${topic.label}`)
      lines.push(`   ${pl ? "Dokumentow" : "Documents"}: ${topic.documentCount} (${pct}%)`)
      lines.push(`   ${pl ? "Koherencja" : "Coherence"}: ${Math.round(topic.coherenceScore * 100)}%`)
      lines.push(`   ${pl ? "Opis" : "Description"}: ${topic.description}`)
      lines.push(`   ${pl ? "Slowa kluczowe" : "Keywords"}: ${topic.keywords.join(", ")}`)
      lines.push("")
    })

    if (includeExamples) {
      lines.push(pl ? "PRZYKLADY Z KAZDEJ KATEGORII:" : "EXAMPLES FROM EACH TOPIC:")
      lines.push("-".repeat(50))
      lines.push("")
      sorted.forEach((topic) => {
        lines.push(`[${topic.label}]`)
        topic.sampleTexts.forEach((s) => {
          lines.push(`  - ${s}`)
        })
        lines.push("")
      })
    }

    if (includeLLMInsights && result.llmSuggestions.length > 0) {
      lines.push(pl ? "SUGESTIE AI:" : "AI SUGGESTIONS:")
      lines.push("-".repeat(50))
      lines.push("")
      result.llmSuggestions.forEach((s, idx) => {
        const status = s.applied
          ? (pl ? "[ZASTOSOWANA]" : "[APPLIED]")
          : (pl ? "[OCZEKUJACA]" : "[PENDING]")
        lines.push(`${idx + 1}. ${status} ${s.description}`)
        lines.push(`   ${pl ? "Pewnosc" : "Confidence"}: ${Math.round(s.confidence * 100)}%`)
        lines.push("")
      })
    }

    const report = lines.join("\n")

    return new NextResponse(report, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": "attachment; filename=raport_klasteryzacji.txt",
      },
    })
  } catch (error) {
    console.error("[export] Error:", error)
    return NextResponse.json(
      {
        error: {
          code: "PIPELINE_ERROR",
          message: "Nie udalo sie wygenerowac raportu.",
        },
      },
      { status: 500 }
    )
  }
}
