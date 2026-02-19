"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { DocumentItem, ClusterTopic } from "@/lib/clustering-types"
import { X, FileText, Tag, MapPin, Ban, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"

interface DocumentDetailDrawerProps {
  document: DocumentItem | null
  topic: ClusterTopic | null
  onClose: () => void
  onExcludeToggle?: (doc: DocumentItem, excluded: boolean) => void
  allTopics: ClusterTopic[]
}

export function DocumentDetailDrawer({
  document,
  topic,
  onClose,
  onExcludeToggle,
  allTopics,
}: DocumentDetailDrawerProps) {
  if (!document) return null
  const isExcluded = document.excluded === true

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        role="presentation"
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col glass-strong animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Szczegoly dokumentu</p>
              <p className="text-[11px] text-muted-foreground">ID: {document.id}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
            aria-label="Zamknij"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-6 p-6">
            {/* Category badge */}
            {topic && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Tag className="h-3 w-3" />
                  Przypisana kategoria
                </div>
                <div
                  className="flex items-center gap-3 rounded-xl border px-4 py-3"
                  style={{
                    borderColor: `${topic.color}30`,
                    backgroundColor: `${topic.color}08`,
                  }}
                >
                  <div
                    className="h-3.5 w-3.5 shrink-0 rounded-full"
                    style={{ backgroundColor: topic.color }}
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-foreground">{topic.label}</span>
                    <span className="text-xs text-muted-foreground">{topic.description}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Full text */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <FileText className="h-3 w-3" />
                Pelna tresc
              </div>
              <div className="rounded-xl bg-white/[0.04] px-5 py-4">
                <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                  {document.text}
                </p>
              </div>
            </div>

            {/* Position info */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <MapPin className="h-3 w-3" />
                Pozycja na mapie
              </div>
              <div className="flex gap-3">
                <div className="flex-1 rounded-xl bg-white/[0.04] px-4 py-3 text-center">
                  <p className="font-display text-lg font-bold text-foreground">{document.x.toFixed(1)}</p>
                  <p className="text-[10px] text-muted-foreground">Os X</p>
                </div>
                <div className="flex-1 rounded-xl bg-white/[0.04] px-4 py-3 text-center">
                  <p className="font-display text-lg font-bold text-foreground">{document.y.toFixed(1)}</p>
                  <p className="text-[10px] text-muted-foreground">Os Y</p>
                </div>
              </div>
            </div>

            {/* Topic keywords */}
            {topic && (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Slowa kluczowe kategorii
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {topic.keywords.map((kw) => {
                    const isInText = document.text.toLowerCase().includes(kw.toLowerCase())
                    return (
                      <Badge
                        key={kw}
                        variant="secondary"
                        className={cn(
                          "border-0 text-xs",
                          isInText
                            ? "bg-primary/15 text-primary"
                            : "bg-white/[0.06] text-muted-foreground"
                        )}
                      >
                        {kw}
                        {isInText && (
                          <span className="ml-1 text-[9px] opacity-60">trafienie</span>
                        )}
                      </Badge>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Exclude from analysis */}
            {onExcludeToggle && (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Udział w analizie
                </p>
                <Button
                  type="button"
                  variant={isExcluded ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "gap-2",
                    isExcluded
                      ? "border-destructive/30 bg-destructive/15 text-destructive hover:bg-destructive/25"
                      : "border-white/[0.1] bg-white/[0.04]"
                  )}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onExcludeToggle(document, !isExcluded)
                  }}
                >
                  {isExcluded ? (
                    <>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Przywróć do analizy
                    </>
                  ) : (
                    <>
                      <Ban className="h-3.5 w-3.5" />
                      Wyłącz z analizy (outlier)
                    </>
                  )}
                </Button>
                {isExcluded && (
                  <p className="text-xs text-muted-foreground">
                    Ten dokument nie będzie widoczny na mapie ani w eksporcie. Możesz go przywrócić w dowolnym momencie.
                  </p>
                )}
              </div>
            )}

            {/* Coherence */}
            {topic && (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Koherencja kategorii
                </p>
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${topic.coherenceScore * 100}%`,
                        backgroundColor: topic.color,
                        boxShadow: `0 0 8px ${topic.color}40`,
                      }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    {Math.round(topic.coherenceScore * 100)}%
                  </span>
                </div>
              </div>
            )}

            {/* Sample texts from the same topic */}
            {topic && topic.sampleTexts.length > 0 && (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Inne przykladowe teksty z tej kategorii
                </p>
                <div className="flex flex-col gap-2">
                  {topic.sampleTexts.map((sample, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg bg-white/[0.03] px-4 py-2.5 text-xs leading-relaxed text-foreground/70"
                    >
                      {sample}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  )
}
