"use client"

import { useState, useMemo, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ClassificationResult, ClassifiedDocument, CategoryMetrics } from "@/lib/clustering-types"
import { CLUSTER_COLORS } from "@/lib/clustering-types"
import {
  BarChart3,
  Download,
  Save,
  Upload,
  ArrowUpDown,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Pencil,
  ChevronDown,
  ChevronUp,
  Target,
  TrendingUp,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { StepHelpBox } from "@/components/wizard/step-help-box"
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"

interface StepClassificationResultsProps {
  result: ClassificationResult
  modelId: string
  onSaveModel?: () => void
  onClassifyNew?: () => void
  onExportCsv?: () => void
  onRetrain?: (corrections: Array<{ text: string; correctedCategoryName: string }>) => void
  isRetraining?: boolean
}

type SortField = "text" | "categoryName" | "confidence" | "margin"
type SortDir = "asc" | "desc"
type ViewTab = "all" | "review" | "metrics"

export function StepClassificationResults({
  result,
  modelId,
  onSaveModel,
  onClassifyNew,
  onExportCsv,
  onRetrain,
  isRetraining,
}: StepClassificationResultsProps) {
  const [filterCategory, setFilterCategory] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>("confidence")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [viewTab, setViewTab] = useState<ViewTab>("all")
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Active learning state: corrections map docId -> correctedCategoryName
  const [corrections, setCorrections] = useState<Record<string, string>>({})
  const [editingDocId, setEditingDocId] = useState<string | null>(null)

  const categoryColorMap = useMemo(() => {
    const map: Record<string, string> = {}
    result.categories.forEach((cat, idx) => {
      map[cat.name] = CLUSTER_COLORS[idx % CLUSTER_COLORS.length]
    })
    return map
  }, [result.categories])

  const categoryNames = useMemo(() => result.categories.map((c) => c.name), [result.categories])

  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir(sortDir === "asc" ? "desc" : "asc")
      } else {
        setSortField(field)
        setSortDir(field === "confidence" || field === "margin" ? "asc" : "asc")
      }
    },
    [sortField, sortDir]
  )

  const confidenceAvailable = result.confidenceAvailable !== false

  // Smart sampling: docs to review (low confidence OR low margin)
  const docsToReview = useMemo(() => {
    if (!confidenceAvailable) return []
    return result.documents
      .filter((d) => {
        const conf = d.confidence
        const margin = d.margin ?? 1
        // Low confidence OR near decision boundary (low margin)
        return (conf >= 0 && conf < 0.7) || (margin >= 0 && margin < 0.3)
      })
      .sort((a, b) => {
        // Sort by margin first (most uncertain), then confidence
        const marginA = a.margin ?? 1
        const marginB = b.margin ?? 1
        if (marginA !== marginB) return marginA - marginB
        return a.confidence - b.confidence
      })
  }, [result.documents, confidenceAvailable])

  const filteredDocs = useMemo(() => {
    let docs = viewTab === "review" ? [...docsToReview] : [...result.documents]
    if (filterCategory) {
      docs = docs.filter((d) => d.categoryName === filterCategory)
    }
    if (viewTab !== "review") {
      docs.sort((a, b) => {
        let cmp = 0
        if (sortField === "text") cmp = a.text.localeCompare(b.text)
        else if (sortField === "categoryName") cmp = a.categoryName.localeCompare(b.categoryName)
        else if (sortField === "margin") cmp = (a.margin ?? 1) - (b.margin ?? 1)
        else cmp = a.confidence - b.confidence
        return sortDir === "desc" ? -cmp : cmp
      })
    }
    return docs
  }, [result.documents, docsToReview, filterCategory, sortField, sortDir, viewTab])

  const categoryDistribution = useMemo(() => {
    const counts: Record<string, number> = {}
    result.documents.forEach((d) => {
      counts[d.categoryName] = (counts[d.categoryName] || 0) + 1
    })
    return Object.entries(counts)
      .map(([name, count]) => ({
        name: name.length > 20 ? name.slice(0, 20) + "..." : name,
        fullName: name,
        count,
        color: categoryColorMap[name] || CLUSTER_COLORS[0],
      }))
      .sort((a, b) => b.count - a.count)
  }, [result.documents, categoryColorMap])

  const lowConfidenceCount = confidenceAvailable
    ? result.documents.filter((d) => d.confidence >= 0 && d.confidence < 0.7).length
    : 0
  const avgConfidence = confidenceAvailable
    ? result.documents.filter(d => d.confidence >= 0).reduce((sum, d) => sum + d.confidence, 0) / (result.documents.filter(d => d.confidence >= 0).length || 1)
    : 0

  const correctionsCount = Object.keys(corrections).length

  const handleCorrection = useCallback((docId: string, newCategoryName: string) => {
    setCorrections((prev) => {
      // If correcting back to original, remove correction
      const doc = result.documents.find((d) => d.id === docId)
      if (doc && doc.categoryName === newCategoryName) {
        const next = { ...prev }
        delete next[docId]
        return next
      }
      return { ...prev, [docId]: newCategoryName }
    })
    setEditingDocId(null)
  }, [result.documents])

  const handleRetrain = useCallback(() => {
    if (!onRetrain || correctionsCount === 0) return
    const correctionsList = Object.entries(corrections).map(([docId, catName]) => {
      const doc = result.documents.find((d) => d.id === docId)
      return { text: doc?.text || "", correctedCategoryName: catName }
    }).filter((c) => c.text)
    onRetrain(correctionsList)
  }, [onRetrain, corrections, correctionsCount, result.documents])

  const handleExportCsv = useCallback(() => {
    if (onExportCsv) {
      onExportCsv()
      return
    }
    const header = "id,text,category,confidence\n"
    const rows = result.documents
      .map((d) => `"${d.id}","${d.text.replace(/"/g, '""')}","${corrections[d.id] || d.categoryName}",${d.confidence}`)
      .join("\n")
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `klasyfikacja_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [result.documents, onExportCsv, corrections])

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20">
          <BarChart3 className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h2 className="font-display text-xl font-semibold text-foreground">
            Wyniki klasyfikacji
          </h2>
          <p className="text-sm text-muted-foreground">
            {result.totalDocuments} dokumentow sklasyfikowanych do {result.categories.length} kategorii
            {result.iteration != null && result.iteration > 0 && (
              <span className="ml-2 text-primary">(iteracja {result.iteration + 1})</span>
            )}
          </p>
        </div>
      </div>

      <StepHelpBox title="Active Learning — jak ulepszac model?">
        <ul className="list-disc space-y-1 pl-4">
          <li>Przejrzyj zakladke <strong>&quot;Do weryfikacji&quot;</strong> — system sam wskazuje dokumenty, co do ktorych jest najmniej pewny.</li>
          <li>Kliknij kategorie w wierszu dokumentu, zeby <strong>poprawic przypisanie</strong>.</li>
          <li>Po wprowadzeniu poprawek kliknij <strong>&quot;Dotrenuj model&quot;</strong> — Twoje poprawki stana sie nowymi przykladami.</li>
          <li>Z kazda iteracja model uczy sie coraz lepiej rozpoznawac Twoje kategorie.</li>
          <li>Zakladka <strong>&quot;Metryki&quot;</strong> pokazuje jakosc per kategoria (precision, recall, F1).</li>
        </ul>
      </StepHelpBox>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <div className="glass rounded-xl border border-white/[0.1] p-4 text-center">
          <p className="text-2xl font-bold text-primary">{result.totalDocuments}</p>
          <p className="text-xs text-muted-foreground">Dokumentow</p>
        </div>
        <div className="glass rounded-xl border border-white/[0.1] p-4 text-center">
          <p className="text-2xl font-bold text-chart-2">{result.categories.length}</p>
          <p className="text-xs text-muted-foreground">Kategorii</p>
        </div>
        <div className="glass rounded-xl border border-white/[0.1] p-4 text-center">
          <p className="text-2xl font-bold text-accent">
            {confidenceAvailable ? `${Math.round(avgConfidence * 100)}%` : "—"}
          </p>
          <p className="text-xs text-muted-foreground">Sr. pewnosc</p>
        </div>
        <div className="glass rounded-xl border border-white/[0.1] p-4 text-center">
          <p className={cn(
            "text-2xl font-bold",
            docsToReview.length > 0 ? "text-yellow-500" : "text-accent"
          )}>
            {confidenceAvailable ? docsToReview.length : "—"}
          </p>
          <p className="text-xs text-muted-foreground">Do weryfikacji</p>
        </div>
        <div className="glass rounded-xl border border-white/[0.1] p-4 text-center">
          <p className={cn(
            "text-2xl font-bold",
            correctionsCount > 0 ? "text-primary" : "text-muted-foreground"
          )}>
            {correctionsCount}
          </p>
          <p className="text-xs text-muted-foreground">Poprawek</p>
        </div>
      </div>

      {/* Confidence warning */}
      {!confidenceAvailable && (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/[0.08] px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500" />
            <p className="text-xs text-yellow-500/90">
              Wskaznik pewnosci predykcji nie jest dostepny dla tego modelu. Klasyfikacja zostala wykonana, ale nie mozna okreslic pewnosci przypisania.
            </p>
          </div>
        </div>
      )}

      {/* Active Learning CTA */}
      {correctionsCount > 0 && onRetrain && (
        <div className="rounded-xl border border-primary/30 bg-primary/[0.08] px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {correctionsCount} {correctionsCount === 1 ? "poprawka gotowa" : "poprawek gotowych"} do dotrenowania
                </p>
                <p className="text-xs text-muted-foreground">
                  Poprawione dokumenty stana sie nowymi przykladami treningowymi
                </p>
              </div>
            </div>
            <Button
              onClick={handleRetrain}
              disabled={isRetraining}
              className="gap-2 bg-primary/90 text-primary-foreground hover:bg-primary glow-primary"
            >
              {isRetraining ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Dotrenowywanie...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Dotrenuj model
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Chart + actions row */}
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Bar chart */}
        <div className="glass flex-1 rounded-2xl border border-white/[0.1] p-6">
          <h3 className="mb-4 text-sm font-semibold text-foreground">Rozklad kategorii</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={categoryDistribution} layout="vertical">
              <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                formatter={(value: number, _name: string, props: { payload: { fullName: string } }) => [
                  `${value} dok.`,
                  props.payload.fullName,
                ]}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {categoryDistribution.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} fillOpacity={0.7} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Actions */}
        <div className="flex w-full flex-col gap-3 lg:w-64">
          <Button
            onClick={handleExportCsv}
            className="gap-2 bg-primary/90 text-primary-foreground hover:bg-primary glow-primary"
          >
            <Download className="h-4 w-4" />
            Eksport CSV
          </Button>
          {onSaveModel && (
            <Button
              variant="outline"
              onClick={onSaveModel}
              className="gap-2 border-white/[0.1] bg-transparent text-muted-foreground hover:text-foreground"
            >
              <Save className="h-4 w-4" />
              Zarzadzaj modelami
            </Button>
          )}
          {onClassifyNew && (
            <Button
              variant="outline"
              onClick={onClassifyNew}
              className="gap-2 border-white/[0.1] bg-transparent text-muted-foreground hover:text-foreground"
            >
              <Upload className="h-4 w-4" />
              Zaklasyfikuj nowe dane
            </Button>
          )}
        </div>
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 rounded-xl bg-white/[0.04] p-1">
        <button
          type="button"
          onClick={() => setViewTab("all")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors",
            viewTab === "all"
              ? "bg-white/[0.1] text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Wszystkie ({result.documents.length})
        </button>
        {confidenceAvailable && docsToReview.length > 0 && (
          <button
            type="button"
            onClick={() => setViewTab("review")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors",
              viewTab === "review"
                ? "bg-yellow-500/20 text-yellow-500"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Target className="h-3.5 w-3.5" />
            Do weryfikacji ({docsToReview.length})
          </button>
        )}
        {result.categoryMetrics && result.categoryMetrics.length > 0 && (
          <button
            type="button"
            onClick={() => setViewTab("metrics")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors",
              viewTab === "metrics"
                ? "bg-accent/20 text-accent"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <TrendingUp className="h-3.5 w-3.5" />
            Metryki
          </button>
        )}
      </div>

      {/* Metrics tab */}
      {viewTab === "metrics" && result.categoryMetrics && (
        <div className="glass overflow-hidden rounded-2xl border border-white/[0.1]">
          <div className="grid grid-cols-[1fr_80px_80px_80px_60px] gap-4 border-b border-white/[0.06] px-4 py-3">
            <span className="text-xs font-medium text-muted-foreground">Kategoria</span>
            <span className="text-xs font-medium text-muted-foreground text-center">Precision</span>
            <span className="text-xs font-medium text-muted-foreground text-center">Recall</span>
            <span className="text-xs font-medium text-muted-foreground text-center">F1</span>
            <span className="text-xs font-medium text-muted-foreground text-center">N</span>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {result.categoryMetrics.map((m) => (
              <div
                key={m.categoryId}
                className="grid grid-cols-[1fr_80px_80px_80px_60px] gap-4 px-4 py-3 hover:bg-white/[0.02]"
              >
                <div className="flex items-center gap-1.5">
                  <div
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: categoryColorMap[m.categoryName] || CLUSTER_COLORS[0] }}
                  />
                  <span className="truncate text-sm text-foreground">{m.categoryName}</span>
                </div>
                <span className={cn(
                  "text-center text-xs font-medium",
                  m.precision >= 0.8 ? "text-accent" : m.precision >= 0.6 ? "text-foreground" : "text-yellow-500"
                )}>
                  {Math.round(m.precision * 100)}%
                </span>
                <span className={cn(
                  "text-center text-xs font-medium",
                  m.recall >= 0.8 ? "text-accent" : m.recall >= 0.6 ? "text-foreground" : "text-yellow-500"
                )}>
                  {Math.round(m.recall * 100)}%
                </span>
                <span className={cn(
                  "text-center text-xs font-medium",
                  m.f1 >= 0.8 ? "text-accent" : m.f1 >= 0.6 ? "text-foreground" : "text-yellow-500"
                )}>
                  {Math.round(m.f1 * 100)}%
                </span>
                <span className="text-center text-xs text-muted-foreground">
                  {m.support}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category filter pills (for all/review tabs) */}
      {viewTab !== "metrics" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Filtr:</span>
            <button
              type="button"
              onClick={() => setFilterCategory(null)}
              className={cn(
                "rounded-full px-3 py-1 text-xs transition-colors",
                !filterCategory
                  ? "bg-primary/20 text-primary"
                  : "bg-white/[0.06] text-muted-foreground hover:text-foreground"
              )}
            >
              Wszystkie
            </button>
            {result.categories.map((cat) => {
              const docs = viewTab === "review" ? docsToReview : result.documents
              const count = docs.filter((d) => d.categoryName === cat.name).length
              if (viewTab === "review" && count === 0) return null
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setFilterCategory(filterCategory === cat.name ? null : cat.name)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
                    filterCategory === cat.name
                      ? "bg-primary/20 text-primary"
                      : "bg-white/[0.06] text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: categoryColorMap[cat.name] }}
                  />
                  {cat.name} ({count})
                </button>
              )
            })}
          </div>

          {/* Review mode hint */}
          {viewTab === "review" && (
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/[0.08] px-4 py-3">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 shrink-0 text-yellow-500" />
                <p className="text-xs text-yellow-500/90">
                  Ponizej dokumenty, co do ktorych model jest <strong>najmniej pewny</strong> — posortowane od najbardziej niepewnych.
                  Kliknij nazwe kategorii, zeby poprawic przypisanie.
                </p>
              </div>
            </div>
          )}

          {/* Documents table */}
          <div className="glass overflow-hidden rounded-2xl border border-white/[0.1]">
            {/* Table header */}
            <div className={cn(
              "grid gap-4 border-b border-white/[0.06] px-4 py-3",
              confidenceAvailable
                ? "grid-cols-[1fr_180px_80px_80px]"
                : "grid-cols-[1fr_180px_80px]"
            )}>
              <button
                type="button"
                onClick={() => toggleSort("text")}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Dokument
                <ArrowUpDown className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => toggleSort("categoryName")}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Kategoria
                <ArrowUpDown className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => toggleSort("confidence")}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Pewnosc
                <ArrowUpDown className="h-3 w-3" />
              </button>
              {confidenceAvailable && (
                <button
                  type="button"
                  onClick={() => toggleSort("margin")}
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Margines
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Table body */}
            <ScrollArea className="max-h-[500px]">
              <div className="divide-y divide-white/[0.04]">
                {filteredDocs.map((doc) => {
                  const isCorrected = corrections[doc.id] != null
                  const displayCategory = corrections[doc.id] || doc.categoryName
                  const isEditing = editingDocId === doc.id

                  return (
                    <div
                      key={doc.id}
                      className={cn(
                        "grid gap-4 px-4 py-3 transition-colors hover:bg-white/[0.02]",
                        confidenceAvailable
                          ? "grid-cols-[1fr_180px_80px_80px]"
                          : "grid-cols-[1fr_180px_80px]",
                        isCorrected && "bg-primary/[0.06]",
                        !isCorrected && doc.confidence >= 0 && doc.confidence < 0.5 && "bg-destructive/[0.04]",
                        !isCorrected && doc.confidence >= 0.5 && doc.confidence < 0.7 && "bg-yellow-500/[0.04]"
                      )}
                    >
                      <p className="truncate text-sm text-foreground/90">{doc.text}</p>

                      {/* Category cell — clickable for correction */}
                      <div className="relative">
                        {isEditing ? (
                          <select
                            autoFocus
                            value={displayCategory}
                            onChange={(e) => handleCorrection(doc.id, e.target.value)}
                            onBlur={() => setEditingDocId(null)}
                            className="w-full rounded-lg bg-white/[0.1] px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                          >
                            {categoryNames.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingDocId(doc.id)}
                            className="group flex w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-white/[0.06]"
                          >
                            {isCorrected ? (
                              <CheckCircle2 className="h-3 w-3 shrink-0 text-primary" />
                            ) : (
                              <div
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: categoryColorMap[displayCategory] }}
                              />
                            )}
                            <span className={cn(
                              "truncate text-xs",
                              isCorrected ? "font-medium text-primary" : "text-muted-foreground"
                            )}>
                              {displayCategory}
                            </span>
                            <Pencil className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100" />
                          </button>
                        )}
                      </div>

                      {/* Confidence */}
                      <div className="flex items-center gap-1.5">
                        {doc.confidence >= 0 && doc.confidence < 0.7 && !isCorrected && (
                          <AlertTriangle className="h-3 w-3 shrink-0 text-yellow-500" />
                        )}
                        <span
                          className={cn(
                            "text-xs font-medium",
                            isCorrected
                              ? "text-primary"
                              : doc.confidence < 0
                                ? "text-muted-foreground"
                                : doc.confidence >= 0.8
                                  ? "text-accent"
                                  : doc.confidence >= 0.7
                                    ? "text-foreground"
                                    : doc.confidence >= 0.5
                                      ? "text-yellow-500"
                                      : "text-destructive"
                          )}
                        >
                          {isCorrected ? "Poprawione" : doc.confidence < 0 ? "—" : `${Math.round(doc.confidence * 100)}%`}
                        </span>
                      </div>

                      {/* Margin */}
                      {confidenceAvailable && (
                        <div className="flex items-center">
                          <span className={cn(
                            "text-xs",
                            doc.margin == null || doc.margin < 0
                              ? "text-muted-foreground"
                              : doc.margin < 0.1
                                ? "text-destructive"
                                : doc.margin < 0.3
                                  ? "text-yellow-500"
                                  : "text-muted-foreground"
                          )}>
                            {doc.margin != null && doc.margin >= 0
                              ? `${Math.round(doc.margin * 100)}%`
                              : "—"}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        </>
      )}
    </div>
  )
}
