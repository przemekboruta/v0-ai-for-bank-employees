"use client"

import { useMemo, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ClusteringResult, ClusterTopic } from "@/lib/clustering-types"
import { ChevronDown, ChevronRight, FileText, Tag } from "lucide-react"
import { cn } from "@/lib/utils"

interface StepOverviewProps {
  result: ClusteringResult
}

export function StepOverview({ result }: StepOverviewProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const activeDocuments = useMemo(
    () => result.documents.filter((d) => !d.excluded),
    [result.documents]
  )
  const activeCountByTopic = useMemo(() => {
    const m = new Map<number, number>()
    for (const d of activeDocuments) {
      m.set(d.clusterId, (m.get(d.clusterId) ?? 0) + 1)
    }
    return m
  }, [activeDocuments])
  const totalActive = Math.max(1, activeDocuments.length)
  const sortedTopics = useMemo(
    () =>
      [...result.topics].sort(
        (a, b) => (activeCountByTopic.get(b.id) ?? 0) - (activeCountByTopic.get(a.id) ?? 0)
      ),
    [result.topics, activeCountByTopic]
  )

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-4 font-display text-lg font-semibold text-foreground">
          Wykryte kategorie
        </h3>
        <p className="mb-6 text-sm text-muted-foreground">
          Kliknij w kategorię, aby zobaczyć opis, słowa kluczowe i przykłady. Edycję nazw i akcje
          (łączenie, reklasyfikacja) znajdziesz w zakładce &bdquo;Akcje i sugestie&rdquo;.
        </p>

        <ScrollArea className="h-[min(60vh,600px)] pr-4">
          <ul className="space-y-3">
            {sortedTopics.map((topic) => {
              const count = activeCountByTopic.get(topic.id) ?? 0
              const pct = ((count / totalActive) * 100).toFixed(0)
              const isExpanded = expandedId === topic.id
              return (
                <li key={topic.id}>
                  <article
                    className={cn(
                      "rounded-2xl border transition-colors",
                      "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
                    )}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-4 p-5 text-left"
                      onClick={() => setExpandedId(isExpanded ? null : topic.id)}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground">
                        {isExpanded ? (
                          <ChevronDown className="h-5 w-5" />
                        ) : (
                          <ChevronRight className="h-5 w-5" />
                        )}
                      </span>
                      <span
                        className="h-4 w-4 shrink-0 rounded-full"
                        style={{ backgroundColor: topic.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate font-medium text-foreground">
                          {topic.label}
                        </h4>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {count} dokumentów ({pct}%)
                        </p>
                      </div>
                      <div className="shrink-0">
                        <span className="rounded-full bg-white/[0.08] px-3 py-1 text-xs font-medium text-muted-foreground">
                          Koherencja {Math.round(topic.coherenceScore * 100)}%
                        </span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-white/[0.06] px-5 pb-5 pt-1">
                        <OverviewTopicDetails topic={topic} />
                      </div>
                    )}
                  </article>
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      </section>
    </div>
  )
}

function OverviewTopicDetails({ topic }: { topic: ClusterTopic }) {
  return (
    <div className="space-y-5 pt-4">
      {topic.description && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Tag className="h-3.5 w-3.5" />
            Opis
          </div>
          <p className="text-sm leading-relaxed text-foreground/90">
            {topic.description}
          </p>
        </div>
      )}
      {topic.keywords.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Słowa kluczowe
          </div>
          <div className="flex flex-wrap gap-2">
            {topic.keywords.map((kw) => (
              <span
                key={kw}
                className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs text-foreground/80"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}
      {topic.sampleTexts.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            Przykłady
          </div>
          <ul className="space-y-2">
            {topic.sampleTexts.slice(0, 4).map((sample, idx) => (
              <li
                key={idx}
                className="rounded-xl bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-foreground/85"
              >
                {sample.length > 200 ? `${sample.slice(0, 200)}…` : sample}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
