"use client"

import React, { useState, useEffect } from "react"

import { cn } from "@/lib/utils"
import { listEncoders } from "@/lib/api-client"
import type {
  Granularity,
  ClusteringConfig,
  ClusteringAlgorithm,
  DimReductionMethod,
  CategoryPreset,
} from "@/lib/clustering-types"
import {
  Layers,
  LayoutGrid,
  Grid3X3,
  Settings2,
  ChevronDown,
  ChevronUp,
  Info,
  HelpCircle,
  SlidersHorizontal,
} from "lucide-react"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface StepConfigureProps {
  config: ClusteringConfig
  onConfigChange: (config: ClusteringConfig) => void
  textCount: number
  lastJobId: string | null
}

/** Preset: few/medium/many use KMeans with this many clusters. */
function presetNumClusters(preset: "few" | "medium" | "many", textCount: number): number {
  const cap = (min: number, max: number) => Math.max(min, Math.min(max, Math.floor(textCount / 10)))
  switch (preset) {
    case "few":
      return Math.max(2, Math.min(5, cap(2, 5)))
    case "medium":
      return Math.max(3, Math.min(10, cap(3, 10)))
    case "many":
      return Math.max(5, Math.min(15, cap(5, 15)))
    default:
      return 7
  }
}

const CATEGORY_PRESET_OPTIONS: {
  value: CategoryPreset
  label: string
  description: string
  icon: React.ElementType
  detail: string
}[] = [
  {
    value: "few",
    label: "Mało kategorii",
    description: "Szerokie, ogólne tematy (K-Means).",
    icon: Layers,
    detail: "~2–5 kategorii",
  },
  {
    value: "medium",
    label: "Średnio kategorii",
    description: "Zrównoważony podział (K-Means).",
    icon: LayoutGrid,
    detail: "~3–10 kategorii",
  },
  {
    value: "many",
    label: "Dużo kategorii",
    description: "Szczegółowy podział (K-Means).",
    icon: Grid3X3,
    detail: "~5–15 kategorii",
  },
  {
    value: "auto",
    label: "Nie wiem",
    description: "Algorytm sam wykryje klastry i szum (HDBSCAN).",
    icon: HelpCircle,
    detail: "automatycznie + szum",
  },
  {
    value: "advanced",
    label: "Zaawansowane",
    description: "Pełna kontrola: algorytm, liczba klastrów, parametry.",
    icon: SlidersHorizontal,
    detail: "własne ustawienia",
  },
]

const ALGORITHM_OPTIONS: { value: ClusteringAlgorithm; label: string; description: string }[] = [
  { value: "hdbscan", label: "HDBSCAN", description: "Automatycznie wykrywa liczbe klastrow i szum" },
  { value: "kmeans", label: "K-Means", description: "Wymaga podania liczby klastrow, szybki" },
  { value: "agglomerative", label: "Aglomeracyjny", description: "Hierarchiczny, dobry dla małych zbiorów" },
]

const DIM_REDUCTION_OPTIONS: { value: DimReductionMethod; label: string; description: string }[] = [
  { value: "umap", label: "UMAP", description: "Najlepsza jakosc, zachowuje strukture lokalna i globalna" },
  { value: "pca", label: "PCA", description: "Szybki, liniowy, dobry do wstepnej redukcji" },
  { value: "tsne", label: "t-SNE", description: "Dobra wizualizacja, wolniejszy" },
  { value: "none", label: "Brak", description: "Klasteryzacja na pełnych embeddingach" },
]

function InfoTooltip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="ml-1 inline h-3.5 w-3.5 cursor-help text-muted-foreground/60" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function StepConfigure({
  config,
  onConfigChange,
  textCount,
  lastJobId,
}: StepConfigureProps) {
  const [encoderModels, setEncoderModels] = useState<string[]>([])

  useEffect(() => {
    listEncoders().then((res) => setEncoderModels(res.models ?? []))
  }, [])

  const preset = config.categoryPreset ?? "auto"
  const updateConfig = (partial: Partial<ClusteringConfig>) => {
    onConfigChange({ ...config, ...partial })
  }

  const setPreset = (value: CategoryPreset) => {
    if (value === "advanced") {
      updateConfig({ categoryPreset: "advanced" })
      return
    }
    if (value === "auto") {
      updateConfig({
        categoryPreset: "auto",
        algorithm: "hdbscan",
        numClusters: null,
        granularity: "medium",
      })
      return
    }
    if (value === "few" || value === "medium" || value === "many") {
      const n = presetNumClusters(value, textCount)
      updateConfig({
        categoryPreset: value,
        algorithm: "kmeans",
        numClusters: n,
        granularity: value === "few" ? "low" : value === "medium" ? "medium" : "high",
      })
    }
  }

  const effectiveNumClusters =
    preset === "few" || preset === "medium" || preset === "many"
      ? presetNumClusters(preset, textCount)
      : config.numClusters
  const needsNumClusters = config.algorithm === "kmeans" || config.algorithm === "agglomerative"

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Liczba kategorii
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Wybierz, jak wiele tematów chcesz wykryć w{" "}
          <span className="font-medium text-foreground">{textCount}</span>{" "}
          dokumentach.
        </p>
      </div>

      {/* Category preset: 5 options */}
      <div className="flex flex-col gap-3">
        {CATEGORY_PRESET_OPTIONS.map((opt) => {
          const Icon = opt.icon
          const selected = preset === opt.value
          return (
            <div
              key={opt.value}
              className={cn(
                "glass-interactive flex cursor-pointer items-center gap-4 rounded-2xl p-5",
                selected && "border-primary/25 bg-primary/[0.06] glow-primary"
              )}
              onClick={() => setPreset(opt.value)}
              role="radio"
              aria-checked={selected}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  setPreset(opt.value)
                }
              }}
            >
              <div
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-all duration-300",
                  selected
                    ? "bg-primary/20 text-primary glow-primary"
                    : "bg-white/[0.06] text-muted-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">
                    {opt.label}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors duration-300",
                      selected
                        ? "bg-primary/15 text-primary"
                        : "bg-white/[0.06] text-muted-foreground"
                    )}
                  >
                    {opt.detail}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {opt.description}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* For "Nie wiem" (auto): explanation + optional target cluster count */}
      {preset === "auto" && (
        <div className="glass rounded-2xl border border-primary/15 bg-primary/[0.04] p-5">
          <p className="mb-3 text-sm leading-relaxed text-foreground/90">
            <strong>HDBSCAN</strong> sam określa liczbę klastrów i wykrywa <strong>szum</strong> (dokumenty nieskategoryzowane).
            Nie musisz podawać liczby kategorii — algorytm znajduje naturalne grupy. Możesz opcjonalnie podać orientacyjną liczbę kategorii; wtedy parametry będą dostosowane tak, aby dążyć do takiej liczby + szum.
          </p>
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-medium text-muted-foreground">
              Orientacyjna liczba kategorii (opcjonalnie)
            </Label>
            <input
              type="number"
              min={2}
              max={30}
              value={config.hdbscanTargetClusters ?? ""}
              onChange={(e) => {
                const v = e.target.value.trim()
                updateConfig({
                  hdbscanTargetClusters: v === "" ? null : Math.max(2, Math.min(30, parseInt(v, 10) || 2)),
                })
              }}
              placeholder="np. 5 — algorytm będzie dążył do ~5 kategorii + szum"
              className="rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
          </div>
        </div>
      )}

      {/* For few/medium/many: show computed cluster count */}
      {(preset === "few" || preset === "medium" || preset === "many") && (
        <p className="text-center text-sm text-muted-foreground">
          Będzie wykrywanych <span className="font-semibold text-primary">~{effectiveNumClusters} kategorii</span> (K-Means).
        </p>
      )}

      {/* Cache embeddings toggle */}
      {lastJobId && (
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <Label className="text-sm font-semibold text-foreground">
                Użyj zapisanych embeddingów
                <InfoTooltip text="Embeddingi z poprzedniego uruchomienia są zapisane w cache. Ponowne klasteryzowanie z nowymi parametrami będzie znacznie szybsze." />
              </Label>
              <p className="text-xs text-muted-foreground">
                Pomiń kosztowny krok generowania embeddingów
              </p>
            </div>
            <Switch
              checked={config.useCachedEmbeddings}
              onCheckedChange={(checked) =>
                updateConfig({
                  useCachedEmbeddings: checked,
                  cachedJobId: checked ? lastJobId : null,
                })
              }
            />
          </div>
        </div>
      )}

      {/* Advanced settings: only when preset is "advanced" */}
      {preset === "advanced" && (
        <div className="glass rounded-2xl p-6">
          <div className="flex flex-col gap-6">
            {/* Algorithm selection */}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium text-foreground">
                Algorytm klasteryzacji
                <InfoTooltip text="HDBSCAN automatycznie znajduje klastry i identyfikuje szum. K-Means wymaga podania liczby klastrow. Aglomeracyjny tworzy hierarchie." />
              </Label>
              <Select
                value={config.algorithm}
                onValueChange={(v: ClusteringAlgorithm) => {
                  const updates: Partial<ClusteringConfig> = { algorithm: v }
                  if (v === "hdbscan") {
                    updates.numClusters = null
                  } else if (config.numClusters === null) {
                    updates.numClusters = { low: 4, medium: 7, high: 12 }[config.granularity]
                  }
                  updateConfig(updates)
                }}
              >
                <SelectTrigger className="w-full border-white/[0.1] bg-white/[0.04] text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALGORITHM_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex flex-col">
                        <span>{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Number of clusters (for kmeans/agglomerative) */}
            {needsNumClusters && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-foreground">
                    Liczba klastrów
                    <InfoTooltip text="Docelowa liczba klastrów. Dla HDBSCAN ta wartość jest ignorowana." />
                  </Label>
                  <span className="text-sm font-semibold text-primary">
                    {config.numClusters ?? "auto"}
                  </span>
                </div>
                <Slider
                  value={[config.numClusters ?? 7]}
                  onValueChange={([v]) => updateConfig({ numClusters: v })}
                  min={2}
                  max={30}
                  step={1}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>2</span>
                  <span>30</span>
                </div>
              </div>
            )}

            {/* Min cluster size */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-foreground">
                  Min. dokumentów w klastrze
                  <InfoTooltip text="Minimalna liczba dokumentów potrzebna do utworzenia klastra. Mniejsze wartości wykrywają więcej małych klastrów." />
                </Label>
                <span className="text-sm font-semibold text-primary">
                  {config.minClusterSize}
                </span>
              </div>
              <Slider
                value={[config.minClusterSize]}
                onValueChange={([v]) => updateConfig({ minClusterSize: v })}
                min={2}
                max={50}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>2</span>
                <span>50</span>
              </div>
            </div>

            {/* Dimensionality reduction */}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium text-foreground">
                Redukcja wymiarowosci (przed klastrowaniem)
                <InfoTooltip text="Metoda redukcji wymiarowosci stosowana przed klastrowaniem. Redukcja do 2D do wizualizacji jest zawsze wykonywana osobno." />
              </Label>
              <Select
                value={config.dimReduction}
                onValueChange={(v: DimReductionMethod) =>
                  updateConfig({ dimReduction: v })
                }
              >
                <SelectTrigger className="w-full border-white/[0.1] bg-white/[0.04] text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIM_REDUCTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex flex-col">
                        <span>{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Dim reduction target */}
            {config.dimReduction !== "none" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-foreground">
                    Docelowa liczba wymiarow
                    <InfoTooltip text="Do ilu wymiarow zredukowac dane przed klastrowaniem. Mniejsza wartosc = szybsze klasteryzowanie, ale moze utracic informacje." />
                  </Label>
                  <span className="text-sm font-semibold text-primary">
                    {config.dimReductionTarget}
                  </span>
                </div>
                <Slider
                  value={[config.dimReductionTarget]}
                  onValueChange={([v]) => updateConfig({ dimReductionTarget: v })}
                  min={5}
                  max={200}
                  step={5}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>5</span>
                  <span>200</span>
                </div>
              </div>
            )}

            {/* Encoder model (only when not using cached embeddings) */}
            {!config.useCachedEmbeddings && (
              <>
                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-medium text-foreground">
                    Model encodera
                    <InfoTooltip text="Model do generowania embeddingów. Domyślny = ustawiony na backendzie." />
                  </Label>
                  <Select
                    value={config.encoderModel ?? "__default__"}
                    onValueChange={(v) =>
                      updateConfig({
                        encoderModel: v === "__default__" ? null : v,
                      })
                    }
                  >
                    <SelectTrigger className="w-full border-white/[0.1] bg-white/[0.04] text-foreground">
                      <SelectValue placeholder="Domyślny (z backendu)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">
                        <span className="text-muted-foreground">
                          Domyślny (z backendu)
                        </span>
                      </SelectItem>
                      {encoderModels.map((m) => (
                        <SelectItem key={m} value={m}>
                          <span className="font-mono text-xs">{m}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-medium text-foreground">
                    Prefix encodera (opcjonalnie)
                    <InfoTooltip text="Tekst dodany na początek każdego dokumentu przed embeddowaniem. Spacja po prefiksie jest dodawana automatycznie (np. 'query:' → 'query: Przykładowy tekst')." />
                  </Label>
                  <input
                    type="text"
                    value={config.encoderPrefix ?? ""}
                    onChange={(e) =>
                      updateConfig({
                        encoderPrefix: e.target.value.trim() || null,
                      })
                    }
                    placeholder="np. query:"
                    className="rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/20"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
