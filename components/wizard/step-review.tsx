"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ClusteringResult, LLMSuggestion } from "@/lib/clustering-types"
import {
  Sparkles,
  Merge,
  Split,
  Tag,
  ArrowRightLeft,
  Check,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface StepReviewProps {
  result: ClusteringResult
  onResultUpdate: (result: ClusteringResult) => void
}

function SuggestionIcon({ type }: { type: LLMSuggestion["type"] }) {
  switch (type) {
    case "merge":
      return <Merge className="h-4 w-4" />
    case "split":
      return <Split className="h-4 w-4" />
    case "rename":
      return <Tag className="h-4 w-4" />
    case "reclassify":
      return <ArrowRightLeft className="h-4 w-4" />
  }
}

function suggestionTypeLabel(type: LLMSuggestion["type"]): string {
  switch (type) {
    case "merge":
      return "Polaczenie"
    case "split":
      return "Podzial"
    case "rename":
      return "Zmiana nazwy"
    case "reclassify":
      return "Reklasyfikacja"
  }
}

function suggestionTypeColor(type: LLMSuggestion["type"]): string {
  switch (type) {
    case "merge":
      return "text-chart-2"
    case "split":
      return "text-chart-3"
    case "rename":
      return "text-primary"
    case "reclassify":
      return "text-chart-4"
  }
}

export function StepReview({ result, onResultUpdate }: StepReviewProps) {
  const [expandedTopic, setExpandedTopic] = useState<number | null>(null)

  const applySuggestion = (idx: number) => {
    const updated = { ...result }
    const suggestions = [...updated.llmSuggestions]
    suggestions[idx] = { ...suggestions[idx], applied: true }
    updated.llmSuggestions = suggestions

    const suggestion = suggestions[idx]
    if (suggestion.type === "rename" && suggestion.suggestedLabel) {
      const topics = [...updated.topics]
      const topicIdx = topics.findIndex(
        (t) => t.id === suggestion.targetClusterIds[0]
      )
      if (topicIdx !== -1) {
        topics[topicIdx] = {
          ...topics[topicIdx],
          label: suggestion.suggestedLabel,
        }
        updated.topics = topics
      }
    }

    onResultUpdate(updated)
  }

  const dismissSuggestion = (idx: number) => {
    const updated = { ...result }
    const suggestions = updated.llmSuggestions.filter((_, i) => i !== idx)
    updated.llmSuggestions = suggestions
    onResultUpdate(updated)
  }

  const pendingSuggestions = result.llmSuggestions.filter((s) => !s.applied)
  const appliedSuggestions = result.llmSuggestions.filter((s) => s.applied)

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Left: LLM Suggestions */}
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 glow-primary">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Sugestie AI
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            LLM przeanalizowal klastry i proponuje ulepszenia. Zaakceptuj lub
            odrzuc.
          </p>
        </div>

        {pendingSuggestions.length === 0 && appliedSuggestions.length === 0 && (
          <div className="glass flex flex-col items-center gap-3 rounded-2xl py-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15">
              <Check className="h-5 w-5 text-accent" />
            </div>
            <p className="text-sm font-medium text-foreground">
              Brak sugestii do przejrzenia
            </p>
            <p className="text-xs text-muted-foreground">
              Klasteryzacja wyglada dobrze. Mozesz przejsc dalej.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {pendingSuggestions.map((suggestion) => {
            const originalIdx = result.llmSuggestions.indexOf(suggestion)
            return (
              <div key={`suggestion-${originalIdx}`} className="glass-interactive overflow-hidden rounded-2xl">
                <div className="p-5">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]",
                        suggestionTypeColor(suggestion.type)
                      )}>
                        <SuggestionIcon type={suggestion.type} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {suggestionTypeLabel(suggestion.type)}
                          </span>
                          <Badge
                            variant="secondary"
                            className="bg-white/[0.06] text-[10px] text-muted-foreground border-0"
                          >
                            {Math.round(suggestion.confidence * 100)}%
                            pewnosci
                          </Badge>
                        </div>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {suggestion.description}
                        </p>
                        {suggestion.suggestedLabel && (
                          <p className="text-xs text-muted-foreground">
                            Proponowana nazwa:{" "}
                            <span className="font-medium text-primary">
                              {suggestion.suggestedLabel}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => dismissSuggestion(originalIdx)}
                        className="gap-1 text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
                      >
                        <X className="h-3 w-3" />
                        Odrzuc
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => applySuggestion(originalIdx)}
                        className="gap-1 bg-primary/90 text-primary-foreground hover:bg-primary glow-primary"
                      >
                        <Check className="h-3 w-3" />
                        Zastosuj
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {appliedSuggestions.map((suggestion, idx) => (
            <div
              key={`applied-${idx}`}
              className="glass-subtle flex items-center gap-3 rounded-2xl p-4 opacity-50"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <Check className="h-4 w-4" />
              </div>
              <p className="text-sm text-muted-foreground">
                {suggestionTypeLabel(suggestion.type)}: zastosowano
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Topic Overview */}
      <div className="flex w-full flex-col gap-4 lg:w-96">
        <h3 className="font-display text-lg font-semibold text-foreground">
          Wykryte tematy ({result.topics.length})
        </h3>
        <ScrollArea className="h-[420px]">
          <div className="flex flex-col gap-2 pr-3">
            {result.topics.map((topic) => (
              <div
                key={topic.id}
                className="glass-interactive cursor-pointer rounded-xl p-3"
                onClick={() =>
                  setExpandedTopic(expandedTopic === topic.id ? null : topic.id)
                }
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: topic.color }}
                  />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">
                        {topic.label}
                      </span>
                      {expandedTopic === topic.id ? (
                        <ChevronUp className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {topic.documentCount} dok.
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Koherencja:{" "}
                        {Math.round(topic.coherenceScore * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
                {expandedTopic === topic.id && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-white/[0.06] pt-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {topic.description}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {topic.keywords.map((kw) => (
                        <Badge
                          key={kw}
                          variant="secondary"
                          className="bg-white/[0.06] text-[10px] text-muted-foreground border-0"
                        >
                          {kw}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Przyklady
                      </span>
                      {topic.sampleTexts.map((sample, sIdx) => (
                        <p
                          key={sIdx}
                          className="rounded-lg bg-white/[0.04] px-3 py-2 text-xs leading-relaxed text-foreground/80"
                        >
                          {sample}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
