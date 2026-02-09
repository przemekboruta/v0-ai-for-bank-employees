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
  CheckCheck,
  XCircle,
  Pencil,
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
  const [editingTopicId, setEditingTopicId] = useState<number | null>(null)
  const [editingLabel, setEditingLabel] = useState("")

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

  const applyAll = () => {
    const updated = { ...result }
    const suggestions = updated.llmSuggestions.map((s) => ({
      ...s,
      applied: true,
    }))
    updated.llmSuggestions = suggestions

    // Apply all renames
    const topics = [...updated.topics]
    for (const s of suggestions) {
      if (s.type === "rename" && s.suggestedLabel) {
        const topicIdx = topics.findIndex(
          (t) => t.id === s.targetClusterIds[0]
        )
        if (topicIdx !== -1) {
          topics[topicIdx] = { ...topics[topicIdx], label: s.suggestedLabel }
        }
      }
    }
    updated.topics = topics
    onResultUpdate(updated)
  }

  const dismissAll = () => {
    const updated = { ...result }
    updated.llmSuggestions = updated.llmSuggestions.filter((s) => s.applied)
    onResultUpdate(updated)
  }

  const startRenaming = (topicId: number, currentLabel: string) => {
    setEditingTopicId(topicId)
    setEditingLabel(currentLabel)
  }

  const finishRenaming = () => {
    if (editingTopicId === null || !editingLabel.trim()) {
      setEditingTopicId(null)
      return
    }
    const updated = { ...result }
    const topics = updated.topics.map((t) =>
      t.id === editingTopicId ? { ...t, label: editingLabel.trim() } : t
    )
    updated.topics = topics
    onResultUpdate(updated)
    setEditingTopicId(null)
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
            odrzuc kazda sugestie, albo uzyj akcji zbiorczych.
          </p>
        </div>

        {/* Batch actions */}
        {pendingSuggestions.length > 1 && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={applyAll}
              className="gap-1.5 bg-primary/90 text-primary-foreground hover:bg-primary glow-primary"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Zastosuj wszystkie ({pendingSuggestions.length})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={dismissAll}
              className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
            >
              <XCircle className="h-3.5 w-3.5" />
              Odrzuc wszystkie
            </Button>
          </div>
        )}

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
              <div
                key={`suggestion-${originalIdx}`}
                className="glass-interactive overflow-hidden rounded-2xl"
              >
                <div className="p-5">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]",
                          suggestionTypeColor(suggestion.type)
                        )}
                      >
                        <SuggestionIcon type={suggestion.type} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {suggestionTypeLabel(suggestion.type)}
                          </span>
                          <Badge
                            variant="secondary"
                            className="border-0 bg-white/[0.06] text-[10px] text-muted-foreground"
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

      {/* Right: Topic Overview with inline rename */}
      <div className="flex w-full flex-col gap-4 lg:w-96">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Wykryte tematy ({result.topics.length})
          </h3>
          <p className="text-[10px] text-muted-foreground">
            Kliknij olowek, aby zmienic nazwe
          </p>
        </div>
        <ScrollArea className="h-[480px]">
          <div className="flex flex-col gap-2 pr-3">
            {result.topics.map((topic) => (
              <div
                key={topic.id}
                className="glass-interactive cursor-pointer rounded-xl p-3"
                onClick={() =>
                  setExpandedTopic(
                    expandedTopic === topic.id ? null : topic.id
                  )
                }
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: topic.color }}
                  />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      {editingTopicId === topic.id ? (
                        <input
                          type="text"
                          value={editingLabel}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          onBlur={finishRenaming}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") finishRenaming()
                            if (e.key === "Escape") setEditingTopicId(null)
                          }}
                          className="flex-1 rounded-lg bg-white/[0.06] px-2 py-1 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="text-sm font-medium text-foreground">
                          {topic.label}
                        </span>
                      )}
                      <div className="flex items-center gap-1">
                        {editingTopicId !== topic.id && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              startRenaming(topic.id, topic.label)
                            }}
                            className="rounded-md p-1 text-muted-foreground/50 hover:bg-white/[0.06] hover:text-muted-foreground"
                            aria-label="Zmien nazwe"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                        {expandedTopic === topic.id ? (
                          <ChevronUp className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {topic.documentCount} dok.
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Koherencja: {Math.round(topic.coherenceScore * 100)}%
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
                          className="border-0 bg-white/[0.06] text-[10px] text-muted-foreground"
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
