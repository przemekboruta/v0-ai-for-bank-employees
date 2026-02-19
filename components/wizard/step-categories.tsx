"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { CategoryDefinition, ClusteringResult } from "@/lib/clustering-types"
import { CLUSTER_COLORS } from "@/lib/clustering-types"
import {
  Plus,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  FileText,
  Sparkles,
  AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { StepHelpBox } from "@/components/wizard/step-help-box"
import { importTemplate } from "@/lib/api-client"

interface StepCategoriesProps {
  categories: CategoryDefinition[]
  onCategoriesChange: (categories: CategoryDefinition[]) => void
  taxonomyId?: string
  clusteringResult?: ClusteringResult | null
  onPromoteFromClustering?: () => void
  backendError?: string
}

const TEMPLATES = [
  { name: "reklamacje_bankowe", label: "Reklamacje bankowe (~8 kategorii)" },
  { name: "typy_zgloszen", label: "Typy zgloszen (~4 kategorie)" },
]

export function StepCategories({
  categories,
  onCategoriesChange,
  taxonomyId,
  clusteringResult,
  onPromoteFromClustering,
  backendError,
}: StepCategoriesProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editNameValue, setEditNameValue] = useState("")
  const [newExampleText, setNewExampleText] = useState("")
  const [isImporting, setIsImporting] = useState(false)

  const totalExamples = categories.reduce((sum, c) => sum + c.examples.length, 0)
  const categoriesWithFewExamples = categories.filter((c) => c.examples.length < 8)

  const addCategory = useCallback(() => {
    const id = `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const newCat: CategoryDefinition = {
      id,
      name: `Kategoria ${categories.length + 1}`,
      examples: [],
      description: "",
    }
    onCategoriesChange([...categories, newCat])
    setExpandedCategory(id)
    setEditingName(id)
    setEditNameValue(newCat.name)
  }, [categories, onCategoriesChange])

  const removeCategory = useCallback(
    (catId: string) => {
      onCategoriesChange(categories.filter((c) => c.id !== catId))
      if (expandedCategory === catId) setExpandedCategory(null)
    },
    [categories, onCategoriesChange, expandedCategory]
  )

  const updateCategory = useCallback(
    (catId: string, updates: Partial<CategoryDefinition>) => {
      onCategoriesChange(
        categories.map((c) => (c.id === catId ? { ...c, ...updates } : c))
      )
    },
    [categories, onCategoriesChange]
  )

  const addExamples = useCallback(
    (catId: string, text: string) => {
      const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
      if (lines.length === 0) return

      const cat = categories.find((c) => c.id === catId)
      if (!cat) return

      const existing = new Set(cat.examples)
      const newExamples = lines.filter((l) => !existing.has(l))
      if (newExamples.length === 0) return

      updateCategory(catId, { examples: [...cat.examples, ...newExamples] })
    },
    [categories, updateCategory]
  )

  const removeExample = useCallback(
    (catId: string, idx: number) => {
      const cat = categories.find((c) => c.id === catId)
      if (!cat) return
      const examples = cat.examples.filter((_, i) => i !== idx)
      updateCategory(catId, { examples })
    },
    [categories, updateCategory]
  )

  const handleImportTemplate = useCallback(
    async (templateName: string) => {
      if (!taxonomyId) return
      setIsImporting(true)
      try {
        const result = await importTemplate(taxonomyId, templateName)
        if (result.categories.length > 0) {
          onCategoriesChange([...categories, ...result.categories])
        }
      } catch (error) {
        console.error("Failed to import template:", error)
      } finally {
        setIsImporting(false)
      }
    },
    [taxonomyId, categories, onCategoriesChange]
  )

  const finishEditingName = useCallback(
    (catId: string) => {
      if (editNameValue.trim()) {
        updateCategory(catId, { name: editNameValue.trim() })
      }
      setEditingName(null)
    },
    [editNameValue, updateCategory]
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 glow-primary">
            <FolderOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Kategorie
            </h2>
            <p className="text-sm text-muted-foreground">
              Zdefiniuj kategorie i dodaj przyklady tekstow do kazdej z nich
            </p>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="glass rounded-xl border border-white/[0.1] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Badge variant="secondary" className="border-0 bg-primary/20 text-primary">
              {categories.length} {categories.length === 1 ? "kategoria" : "kategorii"}
            </Badge>
            <Badge variant="secondary" className="border-0 bg-white/[0.08] text-muted-foreground">
              {totalExamples} {totalExamples === 1 ? "przyklad" : "przykladow"}
            </Badge>
            {categories.length >= 2 && totalExamples >= 4 && categoriesWithFewExamples.length === 0 && (
              <Badge variant="secondary" className="border-0 bg-accent/20 text-accent">
                Gotowe do treningu
              </Badge>
            )}
            {categories.length >= 2 && totalExamples >= 4 && categoriesWithFewExamples.length > 0 && (
              <Badge variant="secondary" className="border-0 bg-yellow-500/20 text-yellow-500">
                Mozna trenowac, ale warto dodac przyklady
              </Badge>
            )}
          </div>
          {categoriesWithFewExamples.length > 0 && categories.length > 0 && (
            <div className="flex items-center gap-1.5 text-yellow-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="text-xs">
                {categoriesWithFewExamples.length} {categoriesWithFewExamples.length === 1 ? "kategoria ma" : "kategorii ma"} mniej niz 8 przykladow — dodaj wiecej dla lepszych wynikow
              </span>
            </div>
          )}
        </div>
      </div>

      <StepHelpBox title="Jak przygotowac dobre kategorie?" variant="tip">
        <ul className="list-disc space-y-1 pl-4">
          <li>Kazda kategoria potrzebuje <strong>min. 8-10 przykladow</strong> dla dobrych wynikow (im wiecej, tym lepiej).</li>
          <li>Przyklady powinny byc roznorodne — rozne sformulowania tego samego typu sprawy.</li>
          <li>Mozesz uzyc <strong>gotowego szablonu</strong> (np. &quot;Reklamacje bankowe&quot;) i dostosowac go do swoich potrzeb.</li>
          <li>Kliknij dwukrotnie nazwe kategorii, zeby ja zmienic.</li>
          <li>Jeden przyklad na linie — mozesz wkleic wiele naraz z Excela.</li>
        </ul>
      </StepHelpBox>

      {/* Backend warning */}
      {backendError && (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/[0.08] px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500" />
            <p className="text-xs text-yellow-500/90">{backendError}</p>
          </div>
        </div>
      )}

      {/* Source buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={addCategory}
          className="gap-1.5 bg-primary/90 text-primary-foreground hover:bg-primary glow-primary"
          size="sm"
        >
          <Plus className="h-3.5 w-3.5" />
          Dodaj recznie
        </Button>

        {clusteringResult && onPromoteFromClustering && (
          <Button
            variant="outline"
            size="sm"
            onClick={onPromoteFromClustering}
            className="gap-1.5 border-white/[0.1] bg-transparent text-muted-foreground hover:text-foreground"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Z wynikow clusteringu
          </Button>
        )}

        {taxonomyId && TEMPLATES.map((t) => (
          <Button
            key={t.name}
            variant="outline"
            size="sm"
            onClick={() => handleImportTemplate(t.name)}
            disabled={isImporting}
            className="gap-1.5 border-white/[0.1] bg-transparent text-muted-foreground hover:text-foreground"
          >
            <FileText className="h-3.5 w-3.5" />
            {t.label}
          </Button>
        ))}
      </div>

      {/* Categories list */}
      {categories.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl py-12">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.06]">
            <FolderOpen className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">Brak kategorii</p>
          <p className="text-xs text-muted-foreground">
            Dodaj kategorie recznie, z szablonu lub z wynikow clusteringu
          </p>
        </div>
      ) : (
        <ScrollArea className="max-h-[600px]">
          <div className="flex flex-col gap-3 pr-3">
            {categories.map((cat, catIdx) => {
              const color = CLUSTER_COLORS[catIdx % CLUSTER_COLORS.length]
              const isExpanded = expandedCategory === cat.id

              return (
                <div
                  key={cat.id}
                  className="glass-interactive rounded-xl overflow-hidden"
                >
                  {/* Category header */}
                  <div
                    className="flex items-center gap-3 p-4 cursor-pointer"
                    onClick={() => setExpandedCategory(isExpanded ? null : cat.id)}
                  >
                    <div
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <div className="flex-1 min-w-0">
                      {editingName === cat.id ? (
                        <input
                          type="text"
                          value={editNameValue}
                          onChange={(e) => setEditNameValue(e.target.value)}
                          onBlur={() => finishEditingName(cat.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") finishEditingName(cat.id)
                            if (e.key === "Escape") setEditingName(null)
                          }}
                          className="w-full rounded-lg bg-white/[0.06] px-2 py-1 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="text-sm font-medium text-foreground cursor-text"
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            setEditingName(cat.id)
                            setEditNameValue(cat.name)
                          }}
                        >
                          {cat.name}
                        </span>
                      )}
                    </div>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "border-0 text-[10px]",
                        cat.examples.length >= 8
                          ? "bg-accent/20 text-accent"
                          : cat.examples.length >= 3
                            ? "bg-yellow-500/20 text-yellow-500"
                            : "bg-white/[0.06] text-muted-foreground"
                      )}
                    >
                      {cat.examples.length}/8 przyk.
                    </Badge>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeCategory(cat.id)
                      }}
                      className="shrink-0 rounded-md p-1 text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="border-t border-white/[0.06] p-4">
                      {/* Description */}
                      <div className="mb-4">
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                          Opis kategorii (opcjonalny)
                        </label>
                        <input
                          type="text"
                          value={cat.description}
                          onChange={(e) => updateCategory(cat.id, { description: e.target.value })}
                          placeholder="Np. reklamacje dotyczace problemow z kartami platniczymi..."
                          className="w-full rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                        />
                      </div>

                      {/* Examples */}
                      <div className="mb-3">
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                          Przyklady ({cat.examples.length})
                        </label>
                        {cat.examples.length > 0 && (
                          <div className="mb-3 flex flex-wrap gap-1.5">
                            {cat.examples.map((ex, exIdx) => (
                              <div
                                key={exIdx}
                                className="group flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs text-foreground/80"
                              >
                                <span className="max-w-[300px] truncate">{ex}</span>
                                <button
                                  type="button"
                                  onClick={() => removeExample(cat.id, exIdx)}
                                  className="shrink-0 rounded p-0.5 text-muted-foreground/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Add examples textarea */}
                      <div>
                        <textarea
                          value={newExampleText}
                          onChange={(e) => setNewExampleText(e.target.value)}
                          placeholder={"Wklej przyklady (jeden na linie), np.:\nMoja karta zostala zablokowana bez powodu\nNie moge placic karta w internecie\nTerminal nie akceptuje mojej karty"}
                          rows={3}
                          className="w-full rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            addExamples(cat.id, newExampleText)
                            setNewExampleText("")
                          }}
                          disabled={!newExampleText.trim()}
                          className="mt-2 gap-1.5 border-white/[0.1] bg-transparent text-muted-foreground hover:text-foreground"
                        >
                          <Plus className="h-3 w-3" />
                          Dodaj przyklady
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
