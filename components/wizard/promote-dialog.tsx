"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ClusteringResult, ClusterTopic } from "@/lib/clustering-types"
import { createTaxonomy, promoteClusters } from "@/lib/api-client"
import { ArrowRight, Square, CheckSquare, Loader2, Tag } from "lucide-react"

interface PromoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  result: ClusteringResult
  onPromoted: (taxonomyId: string) => void
}

export function PromoteDialog({
  open,
  onOpenChange,
  result,
  onPromoted,
}: PromoteDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [isPromoting, setIsPromoting] = useState(false)
  const [taxonomyName, setTaxonomyName] = useState("Kategorie z clusteringu")

  const toggleCluster = (id: number) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const selectAll = () => {
    if (selectedIds.size === result.topics.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(result.topics.map((t) => t.id)))
    }
  }

  const selectedTopics = useMemo(
    () => result.topics.filter((t) => selectedIds.has(t.id)),
    [result.topics, selectedIds]
  )

  const handlePromote = async () => {
    if (selectedIds.size === 0) return
    setIsPromoting(true)
    try {
      // Create taxonomy
      const tax = await createTaxonomy(taxonomyName)
      const taxonomyId = tax.taxonomyId
      // Import selected clusters
      await promoteClusters(taxonomyId, Array.from(selectedIds), result)
      onPromoted(taxonomyId)
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to promote clusters:", error)
    } finally {
      setIsPromoting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-white/[0.1] bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" />
            Promuj klastry do kategorii
          </DialogTitle>
          <DialogDescription>
            Wybierz klastry, ktorych chcesz uzyc jako kategorii do klasyfikacji.
            Etykiety zostana nazwami kategorii, a przyklady dokumentow — przykladami
            treningowymi.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Taxonomy name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">
              Nazwa taksonomii
            </label>
            <input
              type="text"
              value={taxonomyName}
              onChange={(e) => setTaxonomyName(e.target.value)}
              className="w-full rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          {/* Select all */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={selectAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {selectedIds.size === result.topics.length ? "Odznacz wszystkie" : "Zaznacz wszystkie"}
            </button>
            <Badge variant="secondary" className="border-0 bg-primary/20 text-xs text-primary">
              {selectedIds.size} wybrano
            </Badge>
          </div>

          {/* Cluster list */}
          <ScrollArea className="max-h-[300px]">
            <div className="flex flex-col gap-2 pr-3">
              {result.topics.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => toggleCluster(topic.id)}
                  className="flex items-center gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-white/[0.04]"
                >
                  {selectedIds.has(topic.id) ? (
                    <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <Square className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: topic.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {topic.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {topic.documentCount} dok. | {topic.sampleTexts.length} przykladow
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            Anuluj
          </Button>
          <Button
            onClick={handlePromote}
            disabled={isPromoting || selectedIds.size === 0}
            className="gap-2 bg-primary/90 text-primary-foreground hover:bg-primary glow-primary"
          >
            {isPromoting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Promowanie...
              </>
            ) : (
              <>
                <ArrowRight className="h-4 w-4" />
                Promuj ({selectedIds.size})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
