"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
      return "Polączenie"
    case "split":
      return "Podzial"
    case "rename":
      return "Zmiana nazwy"
    case "reclassify":
      return "Reklasyfikacja"
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
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
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
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-8">
              <Check className="h-8 w-8 text-primary" />
              <p className="text-sm font-medium text-foreground">
                Brak sugestii do przejrzenia
              </p>
              <p className="text-xs text-muted-foreground">
                Klasteryzacja wyglada dobrze. Mozesz przejsc dalej.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col gap-3">
          {pendingSuggestions.map((suggestion, idx) => {
            const originalIdx = result.llmSuggestions.indexOf(suggestion)
            return (
              <Card key={`suggestion-${originalIdx}`} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                          <SuggestionIcon type={suggestion.type} />
                        </div>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">
                              {suggestionTypeLabel(suggestion.type)}
                            </span>
                            <Badge
                              variant="secondary"
                              className="text-[10px]"
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
                              <span className="font-medium text-foreground">
                                {suggestion.suggestedLabel}
                              </span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => dismissSuggestion(originalIdx)}
                        className="gap-1 text-muted-foreground"
                      >
                        <X className="h-3 w-3" />
                        Odrzuc
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => applySuggestion(originalIdx)}
                        className="gap-1"
                      >
                        <Check className="h-3 w-3" />
                        Zastosuj
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {appliedSuggestions.map((suggestion, idx) => (
            <Card
              key={`applied-${idx}`}
              className="border-primary/20 bg-primary/[0.02] opacity-60"
            >
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Check className="h-4 w-4" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {suggestionTypeLabel(suggestion.type)}: zastosowano
                </p>
              </CardContent>
            </Card>
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
              <Card
                key={topic.id}
                className="cursor-pointer transition-all hover:shadow-sm"
                onClick={() =>
                  setExpandedTopic(expandedTopic === topic.id ? null : topic.id)
                }
              >
                <CardContent className="p-3">
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
                    <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {topic.description}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {topic.keywords.map((kw) => (
                          <Badge
                            key={kw}
                            variant="secondary"
                            className="text-[10px]"
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
                            className="rounded-md bg-muted px-2.5 py-2 text-xs leading-relaxed text-foreground"
                          >
                            {sample}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
