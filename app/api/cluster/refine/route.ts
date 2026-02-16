import { NextResponse } from "next/server"
import { isPythonBackendEnabled, proxyToBackend } from "@/lib/backend-proxy"
import type {
  ClusterTopic,
  DocumentItem,
  LLMSuggestion,
} from "@/lib/clustering-types"

/**
 * POST /api/cluster/refine
 *
 * LLM Refinement -- analizuje istniejace klastry i generuje nowe sugestie ulepszen.
 * - PYTHON_BACKEND_URL -> proxy do FastAPI (prawdziwy OpenAI)
 * - brak -> mock sugestie
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      topics,
      documents,
      previousSuggestions = [],
      focusAreas = ["coherence", "granularity", "naming"],
    } = body as {
      topics: ClusterTopic[]
      documents: DocumentItem[]
      previousSuggestions?: LLMSuggestion[]
      focusAreas?: string[]
    }

    // === PRODUCTION: proxy ===
    if (isPythonBackendEnabled()) {
      return proxyToBackend("/api/cluster/refine", {
        method: "POST",
        body: JSON.stringify(body),
      })
    }

    if (!topics || !Array.isArray(topics) || topics.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pole 'topics' jest wymagane i musi zawierac co najmniej 1 topik.",
          },
        },
        { status: 400 }
      )
    }

    if (!documents || !Array.isArray(documents)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Pole 'documents' jest wymagane.",
          },
        },
        { status: 400 }
      )
    }

    // --- Symulacja czasu LLM ---
    await new Promise((resolve) => setTimeout(resolve, 300))

    // --- MOCK: Generuj sugestie na podstawie aktualnych topikow ---
    //
    // PRODUCTION:
    // const prompt = buildRefinementPrompt(topics, documents, focusAreas)
    // const llmResponse = await llm.chat({
    //   model: LLM_MODEL,
    //   temperature: 0.3,
    //   messages: [
    //     { role: 'system', content: REFINEMENT_SYSTEM_PROMPT },
    //     { role: 'user', content: prompt }
    //   ]
    // })
    // const suggestions = JSON.parse(llmResponse.content)

    const suggestions: LLMSuggestion[] = []
    const previousTypes = new Set(previousSuggestions.map((s) => `${s.type}-${s.targetClusterIds.join(",")}`))

    // Znajdz klastry o niskiej koherencji
    if (focusAreas.includes("coherence")) {
      const lowCoherence = topics.filter((t) => t.coherenceScore < 0.7)
      for (const topic of lowCoherence.slice(0, 2)) {
        const key = `split-${topic.id}`
        if (!previousTypes.has(key)) {
          suggestions.push({
            type: "split",
            description: `Klaster "${topic.label}" ma niska koherencje (${Math.round(topic.coherenceScore * 100)}%). Moze zawierac dwa odrebne podtematy, ktore warto rozdzielic.`,
            targetClusterIds: [topic.id],
            confidence: 0.6 + Math.random() * 0.2,
            applied: false,
          })
        }
      }
    }

    // Znajdz potencjalne duplikaty
    if (focusAreas.includes("granularity")) {
      for (let i = 0; i < topics.length; i++) {
        for (let j = i + 1; j < topics.length; j++) {
          const sharedKeywords = topics[i].keywords.filter((kw) =>
            topics[j].keywords.includes(kw)
          )
          if (sharedKeywords.length >= 2) {
            const key = `merge-${[topics[i].id, topics[j].id].sort().join(",")}`
            if (!previousTypes.has(key)) {
              suggestions.push({
                type: "merge",
                description: `Klastry "${topics[i].label}" i "${topics[j].label}" maja wspolne slowa kluczowe (${sharedKeywords.join(", ")}). Rozważ polaczenie.`,
                targetClusterIds: [topics[i].id, topics[j].id],
                suggestedLabel: `${topics[i].label} / ${topics[j].label}`,
                confidence: 0.55 + sharedKeywords.length * 0.1,
                applied: false,
              })
              break
            }
          }
        }
        if (suggestions.filter((s) => s.type === "merge").length >= 2) break
      }
    }

    // Sugeruj lepsze nazwy
    if (focusAreas.includes("naming")) {
      const longNameTopics = topics.filter((t) => t.label.length > 30)
      for (const topic of longNameTopics.slice(0, 1)) {
        const key = `rename-${topic.id}`
        if (!previousTypes.has(key)) {
          suggestions.push({
            type: "rename",
            description: `Nazwa "${topic.label}" jest zbyt dluga. Krotsze nazwy sa czytelniejsze w raportach.`,
            targetClusterIds: [topic.id],
            suggestedLabel: topic.label.substring(0, 25),
            confidence: 0.65,
            applied: false,
          })
        }
      }
    }

    // Oblicz ogolna koherencje
    const overallCoherence =
      topics.reduce((sum, t) => sum + t.coherenceScore, 0) / topics.length

    const problematicClusters = topics
      .filter((t) => t.coherenceScore < 0.65)
      .map((t) => t.id)

    return NextResponse.json({
      suggestions: suggestions.slice(0, 5),
      analysis: {
        overallCoherence: Math.round(overallCoherence * 100) / 100,
        problematicClusters,
        suggestedOptimalK: Math.max(3, Math.min(topics.length, Math.round(documents.length / 25))),
        focusAreasAnalyzed: focusAreas,
      },
    })
  } catch (error) {
    console.error("[refine] LLM refinement error:", error)
    return NextResponse.json(
      {
        error: {
          code: "LLM_UNAVAILABLE",
          message: "Nie udało się uzyskać sugestii od modelu LLM.",
        },
      },
      { status: 503 }
    )
  }
}
