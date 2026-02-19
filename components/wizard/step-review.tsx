"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ClusteringResult, LLMSuggestion, ClusterTopic } from "@/lib/clustering-types"
import { getActiveAndExcludedDocuments, reattachExcludedDocuments } from "@/lib/clustering-types"
import { refineClusters, renameTopic as renameTopicApi, reclassifyDocuments, mergeClusters } from "@/lib/api-client"
import {
  Sparkles,
  Merge,
  Tag,
  ArrowRightLeft,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  CheckCheck,
  XCircle,
  Pencil,
  Loader2,
  Layers,
  Square,
  CheckSquare,
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
    case "rename":
      return "text-primary"
    case "reclassify":
      return "text-chart-4"
  }
}

function getClusterName(clusterId: number, topics: ClusterTopic[]): string {
  const topic = topics.find((t) => t.id === clusterId)
  return topic?.label || `Klaster ${clusterId}`
}

function getSuggestionDetails(
  suggestion: LLMSuggestion,
  topics: ClusterTopic[]
): { title: string; details: string } {
  const clusterNames = suggestion.targetClusterIds.map((id) => getClusterName(id, topics))

  switch (suggestion.type) {
    case "merge": {
      if (clusterNames.length < 2) {
        return {
          title: "Połączenie klastrów",
          details: suggestion.description,
        }
      }
      const newName = suggestion.suggestedLabel || `Połączony klaster`
      const clustersList = clusterNames.length > 3 
        ? `${clusterNames.slice(0, 3).map((n) => `"${n}"`).join(", ")} i ${clusterNames.length - 3} innych`
        : clusterNames.map((n) => `"${n}"`).join(", ")
      return {
        title: "Połączenie klastrów",
        details: `Połączy klastry: ${clustersList} w jeden klaster "${newName}"`,
      }
    }
    case "rename": {
      if (clusterNames.length === 0) {
        return {
          title: "Zmiana nazwy klastra",
          details: suggestion.description,
        }
      }
      const oldName = clusterNames[0]
      const newName = suggestion.suggestedLabel || "Nowa nazwa"
      return {
        title: "Zmiana nazwy klastra",
        details: `Zmieni nazwę klastra "${oldName}" na "${newName}"`,
      }
    }
    case "reclassify": {
      if (clusterNames.length === 0) {
        return {
          title: "Reklasyfikacja klastrów",
          details: suggestion.description,
        }
      }
      // Dla reclassify, liczba nowych klastrów jest domyślnie równa liczbie starych (lub 2 jeśli jeden)
      const numClusters = clusterNames.length > 1 ? clusterNames.length : 2
      const clustersList = clusterNames.length > 3
        ? `${clusterNames.slice(0, 3).map((n) => `"${n}"`).join(", ")} i ${clusterNames.length - 3} innych`
        : clusterNames.map((n) => `"${n}"`).join(", ")
      return {
        title: "Reklasyfikacja klastrów",
        details: `Podzieli klastry: ${clustersList} na ${numClusters} nowych klastrów używając KMeans`,
      }
    }
  }
}

// Check if two suggestions conflict (affect the same clusters)
function suggestionsConflict(
  s1: LLMSuggestion,
  s2: LLMSuggestion
): boolean {
  const ids1 = new Set(s1.targetClusterIds)
  const ids2 = new Set(s2.targetClusterIds)
  
  // Check if they share any cluster IDs
  for (const id of ids1) {
    if (ids2.has(id)) {
      return true
    }
  }
  return false
}

// Mark conflicting suggestions as blocked after applying one
function markConflictingSuggestions(
  suggestions: LLMSuggestion[],
  appliedIndex: number
): LLMSuggestion[] {
  const applied = suggestions[appliedIndex]
  if (!applied || applied.applied) {
    return suggestions
  }
  
  return suggestions.map((s, idx) => {
    if (idx === appliedIndex || s.applied || s.blocked) {
      return s
    }
    
    // Check if this suggestion conflicts with the applied one
    if (suggestionsConflict(s, applied)) {
      return { ...s, blocked: true }
    }
    
    return s
  })
}

export function StepReview({ result, onResultUpdate }: StepReviewProps) {
  const [expandedTopic, setExpandedTopic] = useState<number | null>(null)
  const [editingTopicId, setEditingTopicId] = useState<number | null>(null)
  const [editingLabel, setEditingLabel] = useState("")
  const [applyingSuggestion, setApplyingSuggestion] = useState<number | null>(null)
  const [selectedClusters, setSelectedClusters] = useState<Set<number>>(new Set())
  const [actionMode, setActionMode] = useState<"merge" | "reclassify" | "advanced" | "generate-labels" | null>(null)
  const [mergeLabel, setMergeLabel] = useState("")
  const [reclassifyNumClusters, setReclassifyNumClusters] = useState(2)
  const [isExecutingAction, setIsExecutingAction] = useState(false)
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false)

  const toggleClusterSelection = (clusterId: number) => {
    const newSelected = new Set(selectedClusters)
    if (newSelected.has(clusterId)) {
      newSelected.delete(clusterId)
    } else {
      newSelected.add(clusterId)
    }
    setSelectedClusters(newSelected)
  }

  const handleExecuteMerge = async () => {
    if (selectedClusters.size < 2) return
    setIsExecutingAction(true)
    try {
      const { activeDocuments, excludedDocuments } = getActiveAndExcludedDocuments(result)
      const jobId = result.jobId || undefined
      const clusterIds = Array.from(selectedClusters)
      const newLabel = mergeLabel.trim() || `Połączony klaster ${clusterIds.join(", ")}`
      const apiResult = await mergeClusters(
        clusterIds,
        newLabel,
        activeDocuments,
        result.topics,
        jobId
      )
      if (apiResult) {
        const updatedResult = reattachExcludedDocuments(apiResult, excludedDocuments)
        onResultUpdate(updatedResult)
        setSelectedClusters(new Set())
        setActionMode(null)
        setMergeLabel("")
      }
    } catch (error) {
      console.error("Failed to merge clusters:", error)
    } finally {
      setIsExecutingAction(false)
    }
  }

  const handleExecuteReclassify = async () => {
    if (selectedClusters.size < 1 || reclassifyNumClusters < 1) return
    setIsExecutingAction(true)
    try {
      const { activeDocuments, excludedDocuments } = getActiveAndExcludedDocuments(result)
      const jobId = result.jobId || undefined
      const clusterIds = Array.from(selectedClusters)
      const apiResult = await reclassifyDocuments(
        clusterIds,
        reclassifyNumClusters,
        activeDocuments,
        result.topics,
        jobId
      )
      if (apiResult) {
        const updatedResult = reattachExcludedDocuments(apiResult, excludedDocuments)
        onResultUpdate(updatedResult)
        setSelectedClusters(new Set())
        setActionMode(null)
        setReclassifyNumClusters(2)
      }
    } catch (error) {
      console.error("Failed to reclassify clusters:", error)
    } finally {
      setIsExecutingAction(false)
    }
  }

  const handleGenerateLabels = async () => {
    if (selectedClusters.size === 0) return
    setIsExecutingAction(true)
    try {
      const jobId = result.jobId || undefined
      const topicIds = Array.from(selectedClusters).filter((id) => id !== -1)
      if (topicIds.length === 0) {
        setIsExecutingAction(false)
        return
      }
      const response = await fetch("/api/cluster/generate-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicIds: topicIds,
          topics: result.topics,
          documents: result.documents,
          jobId: jobId,
        }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: "Unknown error" } }))
        throw new Error(errorData.error?.message || `HTTP ${response.status}: Failed to generate labels`)
      }
      const data = await response.json()
      const updated = { ...result }
      updated.topics = data.updatedTopics
      onResultUpdate(updated)
      setSelectedClusters(new Set())
      setActionMode(null)
    } catch (error) {
      console.error("Failed to generate labels:", error)
      alert(`Nie udało się wygenerować nazw: ${error instanceof Error ? error.message : "Nieznany błąd"}`)
    } finally {
      setIsExecutingAction(false)
    }
  }

  const applySuggestion = async (idx: number) => {
    const suggestion = result.llmSuggestions[idx]
    const jobId = result.jobId || undefined
    
    setApplyingSuggestion(idx)
    
    try {
      let updatedResult: ClusteringResult | null = null

      const { activeDocuments, excludedDocuments } = getActiveAndExcludedDocuments(result)

      // Execute operation via API based on suggestion type
      if (suggestion.type === "merge" && suggestion.targetClusterIds.length >= 2) {
        const newLabel = suggestion.suggestedLabel || `Połączony klaster ${suggestion.targetClusterIds.join(", ")}`
        const apiResult = await mergeClusters(
          suggestion.targetClusterIds,
          newLabel,
          activeDocuments,
          result.topics,
          jobId
        )
        updatedResult = apiResult ? reattachExcludedDocuments(apiResult, excludedDocuments) : null
      } else if (suggestion.type === "rename" && suggestion.suggestedLabel && suggestion.targetClusterIds.length >= 1) {
        const topicId = suggestion.targetClusterIds[0]
        await renameTopicApi(topicId, suggestion.suggestedLabel, jobId)
        // For rename, update locally since API doesn't return full result
        const updated = { ...result }
        const topics = [...updated.topics]
        const topicIdx = topics.findIndex((t) => t.id === topicId)
      if (topicIdx !== -1) {
        topics[topicIdx] = {
          ...topics[topicIdx],
          label: suggestion.suggestedLabel,
        }
        updated.topics = topics
          updatedResult = updated
        }
      } else if (suggestion.type === "reclassify" && suggestion.targetClusterIds.length >= 1) {
        const fromClusterIds = suggestion.targetClusterIds
        const numClusters = suggestion.targetClusterIds.length > 1 ? suggestion.targetClusterIds.length : 2
        const apiResult = await reclassifyDocuments(
          fromClusterIds,
          numClusters,
          activeDocuments,
          result.topics,
          jobId
        )
        updatedResult = apiResult ? reattachExcludedDocuments(apiResult, excludedDocuments) : null
      }

      // Update result with operation result
      if (updatedResult) {
        // Mark this suggestion as applied and mark conflicting ones as blocked
        let updatedSuggestions = result.llmSuggestions.map((s, i) =>
          i === idx ? { ...s, applied: true } : s
        )
        updatedSuggestions = markConflictingSuggestions(updatedSuggestions, idx)
        
        const updated = {
          ...updatedResult,
          llmSuggestions: updatedSuggestions,
        }
        onResultUpdate(updated)
      } else {
        // Fallback: just mark as applied and block conflicts
        const updated = { ...result }
        let updatedSuggestions = result.llmSuggestions.map((s, i) =>
          i === idx ? { ...s, applied: true } : s
        )
        updatedSuggestions = markConflictingSuggestions(updatedSuggestions, idx)
        updated.llmSuggestions = updatedSuggestions
        onResultUpdate(updated)
      }
    } catch (error) {
      console.error(`Failed to apply ${suggestion.type} suggestion:`, error)
      // On error, don't mark as applied or block conflicts
      // Just show error to user (error is already logged to console)
    } finally {
      setApplyingSuggestion(null)
    }
  }

  const dismissSuggestion = (idx: number) => {
    const updated = { ...result }
    const suggestions = updated.llmSuggestions.filter((_, i) => i !== idx)
    updated.llmSuggestions = suggestions
    onResultUpdate(updated)
  }

  const applyAll = async () => {
    // Apply all suggestions sequentially
    for (let i = 0; i < result.llmSuggestions.length; i++) {
      const suggestion = result.llmSuggestions[i]
      if (!suggestion.applied) {
        await applySuggestion(i)
      }
    }
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

  const finishRenaming = async () => {
    if (editingTopicId === null || !editingLabel.trim()) {
      setEditingTopicId(null)
      return
    }
    const jobId = result.jobId || undefined
    try {
      await renameTopicApi(editingTopicId, editingLabel.trim(), jobId)
    } catch {
      // Continue with local update even if API fails
    }
    const updated = { ...result }
    const topics = updated.topics.map((t) =>
      t.id === editingTopicId ? { ...t, label: editingLabel.trim() } : t
    )
    updated.topics = topics
    onResultUpdate(updated)
    setEditingTopicId(null)
  }

  const [isRefining, setIsRefining] = useState(false)

  const requestMoreSuggestions = async () => {
    setIsRefining(true)
    try {
      const response = await refineClusters(
        result.topics,
        result.documents,
        result.llmSuggestions,
        ["coherence", "granularity", "naming"]
      )
      if (response.suggestions.length > 0) {
        const updated = { ...result }
        updated.llmSuggestions = [
          ...updated.llmSuggestions,
          ...response.suggestions,
        ]
        onResultUpdate(updated)
      }
    } catch {
      // Silently fail -- user can retry
    } finally {
      setIsRefining(false)
    }
  }

  const pendingSuggestions = result.llmSuggestions.filter((s) => !s.applied && !s.blocked)
  const appliedSuggestions = result.llmSuggestions.filter((s) => s.applied)
  const blockedSuggestions = result.llmSuggestions.filter((s) => s.blocked && !s.applied)

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Łącz klastry, reklasyfikuj dokumenty lub wygeneruj nowe nazwy. Poniżej znajdziesz też
        sugestie AI i listę kategorii do wyboru.
      </p>
      {/* Top: Cluster Actions */}
      <div className="glass rounded-2xl border border-white/[0.1] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-foreground">
            Akcje na klastrach
          </h2>
        </div>
        
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* Merge Action */}
          <div className="glass-interactive rounded-xl border border-white/[0.1] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Merge className="h-4 w-4 text-chart-2" />
              <h3 className="text-sm font-semibold text-foreground">Połącz klastry</h3>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Wybierz co najmniej 2 klastry do połączenia w jeden
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActionMode(actionMode === "merge" ? null : "merge")}
              className={cn(
                "w-full gap-1.5 border-white/[0.1] bg-transparent",
                actionMode === "merge" && "border-primary/40 bg-primary/10"
              )}
            >
              <Merge className="h-3.5 w-3.5" />
              {actionMode === "merge" ? "Anuluj" : "Wybierz klastry"}
            </Button>
          </div>

          {/* Reclassify Action */}
          <div className="glass-interactive rounded-xl border border-white/[0.1] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Layers className="h-4 w-4 text-chart-4" />
              <h3 className="text-sm font-semibold text-foreground">Reklasyfikuj</h3>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Podziel wybrane klastry na nowe używając KMeans
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActionMode(actionMode === "reclassify" ? null : "reclassify")}
              className={cn(
                "w-full gap-1.5 border-white/[0.1] bg-transparent",
                actionMode === "reclassify" && "border-primary/40 bg-primary/10"
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              {actionMode === "reclassify" ? "Anuluj" : "Wybierz klastry"}
            </Button>
          </div>

          {/* Generate Labels Action */}
          <div className="glass-interactive rounded-xl border border-white/[0.1] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Wygeneruj nazwy</h3>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Użyj AI do wygenerowania nazw dla wybranych klastrów
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (selectedClusters.size === 0) {
                  // If no clusters selected, select all
                  setSelectedClusters(new Set(result.topics.map((t) => t.id)))
                  setActionMode("generate-labels")
                } else {
                  // Generate labels for selected clusters
                  await handleGenerateLabels()
                }
              }}
              disabled={isExecutingAction}
              className="w-full gap-1.5 border-white/[0.1] bg-transparent"
            >
              {isExecutingAction ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generowanie...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  {selectedClusters.size > 0 ? "Wygeneruj" : "Wybierz klastry"}
                </>
              )}
            </Button>
          </div>

          {/* Advanced Options */}
          <div className="glass-interactive rounded-xl border border-white/[0.1] p-4">
            <div className="mb-3 flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-chart-3" />
              <h3 className="text-sm font-semibold text-foreground">Zaawansowane</h3>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Reklasyfikuj z własnymi parametrami algorytmu
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActionMode(actionMode === "advanced" ? null : "advanced")}
              className={cn(
                "w-full gap-1.5 border-white/[0.1] bg-transparent",
                actionMode === "advanced" && "border-primary/40 bg-primary/10"
              )}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              {actionMode === "advanced" ? "Anuluj" : "Otwórz"}
            </Button>
          </div>
        </div>

        {/* Action Controls */}
        {actionMode && actionMode !== "advanced" && (
          <div className="mt-4 glass rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">
                {actionMode === "merge" ? "Połącz klastry" : actionMode === "reclassify" ? "Reklasyfikuj klastry" : "Wygeneruj nazwy"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setActionMode(null)
                  setSelectedClusters(new Set())
                  setMergeLabel("")
                  setReclassifyNumClusters(2)
                }}
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              {actionMode === "merge"
                ? "Wybierz co najmniej 2 klastry do połączenia"
                : actionMode === "reclassify"
                ? "Wybierz klastry do reklasyfikacji (będą podzielone na nowe)"
                : "Wybierz klastry do wygenerowania nazw"}
            </p>
            {actionMode === "merge" && (
              <div className="mb-3">
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Nazwa nowego klastra
                </label>
                <input
                  type="text"
                  value={mergeLabel}
                  onChange={(e) => setMergeLabel(e.target.value)}
                  placeholder="Nazwa połączonego klastra..."
                  className="w-full rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
            )}
            {actionMode === "reclassify" && (
              <div className="mb-3">
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Liczba nowych klastrów
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={reclassifyNumClusters}
                  onChange={(e) => setReclassifyNumClusters(parseInt(e.target.value) || 2)}
                  className="w-full rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={
                  actionMode === "merge"
                    ? handleExecuteMerge
                    : actionMode === "reclassify"
                    ? handleExecuteReclassify
                    : handleGenerateLabels
                }
                disabled={
                  isExecutingAction ||
                  (actionMode === "merge" && selectedClusters.size < 2) ||
                  ((actionMode === "reclassify" || actionMode === "generate-labels") && selectedClusters.size < 1)
                }
                className="flex-1 gap-1.5 bg-primary/90 text-primary-foreground hover:bg-primary glow-primary disabled:opacity-50"
              >
                {isExecutingAction ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Przetwarzanie...
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Wykonaj
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedClusters(new Set())}
                disabled={selectedClusters.size === 0}
                className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
              >
                <X className="h-3.5 w-3.5" />
                Wyczyść
              </Button>
            </div>
            {selectedClusters.size > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Wybrano: {selectedClusters.size} {selectedClusters.size === 1 ? "klaster" : "klastrów"}
              </p>
            )}
          </div>
        )}

        {/* Advanced Options Panel */}
        {actionMode === "advanced" && (
          <div className="mt-4 glass rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Zaawansowana reklasyfikacja</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setActionMode(null)
                  setSelectedClusters(new Set())
                }}
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Wybierz klastry i ustaw parametry algorytmu do reklasyfikacji
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Algorytm
                </label>
                <select
                  className="w-full rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  defaultValue="kmeans"
                >
                  <option value="kmeans">KMeans</option>
                  <option value="hdbscan">HDBSCAN</option>
                  <option value="agglomerative">Agglomerative</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Redukcja wymiarów
                </label>
                <select
                  className="w-full rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  defaultValue="umap"
                >
                  <option value="umap">UMAP</option>
                  <option value="pca">PCA</option>
                  <option value="tsne">t-SNE</option>
                  <option value="none">Brak</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Liczba klastrów
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  defaultValue={2}
                  className="w-full rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Min. rozmiar klastra
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  defaultValue={5}
                  className="w-full rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
            </div>
            <Button
              size="sm"
              onClick={handleExecuteReclassify}
              disabled={isExecutingAction || selectedClusters.size < 1}
              className="mt-4 w-full gap-1.5 bg-primary/90 text-primary-foreground hover:bg-primary glow-primary disabled:opacity-50"
            >
              {isExecutingAction ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Przetwarzanie...
                </>
              ) : (
                <>
                  <Layers className="h-3.5 w-3.5" />
                  Wykonaj reklasyfikację
                </>
              )}
            </Button>
          </div>
        )}
      </div>

    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Left: LLM Suggestions */}
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setSuggestionsExpanded(!suggestionsExpanded)}
            className="flex items-center justify-between rounded-lg p-2 hover:bg-white/[0.04]"
          >
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 glow-primary">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
              <h2 className="font-display text-lg font-semibold text-foreground">
              Sugestie AI
            </h2>
              {pendingSuggestions.length > 0 && (
                <Badge variant="secondary" className="border-0 bg-primary/20 text-[10px] text-primary">
                  {pendingSuggestions.length}
                </Badge>
              )}
          </div>
            {suggestionsExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {suggestionsExpanded && (
            <p className="px-2 text-xs text-muted-foreground">
              LLM przeanalizowal klastry i proponuje ulepszenia.
            </p>
          )}
        </div>

        {suggestionsExpanded && (
          <>
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
              Odrzuć wszystkie
            </Button>
          </div>
        )}

        {/* Request more suggestions */}
        <Button
          variant="outline"
          size="sm"
          onClick={requestMoreSuggestions}
          disabled={isRefining}
          className="gap-1.5 self-start border-white/[0.1] bg-transparent text-muted-foreground hover:border-white/[0.2] hover:text-foreground hover:bg-white/[0.04]"
        >
          <Sparkles className={cn("h-3.5 w-3.5", isRefining && "animate-spin")} />
          {isRefining ? "Analizuje…" : "Poproś AI o więcej sugestii"}
        </Button>

        {pendingSuggestions.length === 0 && appliedSuggestions.length === 0 && blockedSuggestions.length === 0 && (
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

        {/* Blocked suggestions section */}
        {blockedSuggestions.length > 0 && (
          <div className="glass rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
            <div className="mb-2 flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive/70" />
              <p className="text-sm font-semibold text-destructive/90">
                Zablokowane sugestie ({blockedSuggestions.length})
              </p>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Te sugestie nie mogą być wykonane, ponieważ dotyczą klastrów, które zostały już zmienione przez inną sugestię.
            </p>
            <div className="flex flex-col gap-2">
              {blockedSuggestions.map((suggestion) => {
                const originalIdx = result.llmSuggestions.indexOf(suggestion)
                const details = getSuggestionDetails(suggestion, result.topics)
                return (
                  <div
                    key={`blocked-${originalIdx}`}
                    className="rounded-lg border border-destructive/10 bg-white/[0.02] p-2.5"
                  >
                    <p className="text-xs font-medium text-muted-foreground line-through">
                      {details.details}
                    </p>
                  </div>
                )
              })}
            </div>
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
                        {(() => {
                          const details = getSuggestionDetails(suggestion, result.topics)
                          const affectedClusters = suggestion.targetClusterIds
                            .map((id) => result.topics.find((t) => t.id === id))
                            .filter((t): t is ClusterTopic => t !== undefined)
                          
                          return (
                            <>
                              <p className="text-sm font-medium text-foreground">
                                {details.details}
                              </p>
                              {affectedClusters.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {affectedClusters.map((topic) => (
                                    <Badge
                                      key={topic.id}
                                      variant="outline"
                                      className="border-white/[0.15] bg-white/[0.04] text-[10px] text-muted-foreground"
                                      style={{ borderLeftColor: topic.color, borderLeftWidth: "3px" }}
                                    >
                                      {topic.label}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                              {suggestion.description !== details.details && (
                                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {suggestion.description}
                          </p>
                        )}
                            </>
                          )
                        })()}
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
                        Odrzuć
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => applySuggestion(originalIdx)}
                        disabled={applyingSuggestion === originalIdx || suggestion.blocked}
                        className="gap-1 bg-primary/90 text-primary-foreground hover:bg-primary glow-primary disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {applyingSuggestion === originalIdx ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Przetwarzanie...
                          </>
                        ) : suggestion.blocked ? (
                          <>
                            <X className="h-3 w-3" />
                            Zablokowane
                          </>
                        ) : (
                          <>
                        <Check className="h-3 w-3" />
                        Zastosuj
                          </>
                        )}
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
          </>
        )}
      </div>

      {/* Right: Topic Overview */}
      <div className="flex w-full flex-col gap-4 lg:w-96">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Wykryte tematy ({result.topics.length})
          </h3>
        </div>

        <ScrollArea className="h-[480px]">
          <div className="flex flex-col gap-2 pr-3">
            {result.topics.map((topic) => (
              <div
                key={topic.id}
                className={cn(
                  "glass-interactive rounded-xl p-3",
                  actionMode ? "cursor-default" : "cursor-pointer"
                )}
                onClick={() => {
                  if (actionMode) {
                    toggleClusterSelection(topic.id)
                  } else {
                    setExpandedTopic(expandedTopic === topic.id ? null : topic.id)
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  {actionMode && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleClusterSelection(topic.id)
                      }}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      {selectedClusters.has(topic.id) ? (
                        <CheckSquare className="h-4 w-4 text-primary" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  )}
                  <div
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: topic.color }}
                  />
                    <div className="flex flex-1 flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      {editingTopicId === topic.id && topic.id !== -1 ? (
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
                        {editingTopicId !== topic.id && topic.id !== -1 && (
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
                        Przykłady
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
    </div>
  )
}
