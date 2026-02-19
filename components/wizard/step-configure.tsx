"use client"

import React, { useState, useEffect } from "react"

import { cn } from "@/lib/utils"
import { listEncoders } from "@/lib/api-client"
import type {
  Granularity,
  ClusteringConfig,
  ClusteringAlgorithm,
  DimReductionMethod,
} from "@/lib/clustering-types"
import {
  Layers,
  LayoutGrid,
  Grid3X3,
  Settings2,
  ChevronDown,
  ChevronUp,
  Info,
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
import { StepHelpBox } from "@/components/wizard/step-help-box"

interface StepConfigureProps {
  config: ClusteringConfig
  onConfigChange: (config: ClusteringConfig) => void
  textCount: number
  lastJobId: string | null
}

const GRANULARITY_OPTIONS: {
  value: Granularity
  label: string
  description: string
  icon: React.ElementType
  example: string
}[] = [
  {
    value: "low",
    label: "Malo kategorii",
    description: "Szerokie, ogólne tematy. Najlepsze do przeglądu ogólnego.",
    icon: Layers,
    example: "3-5 kategorii",
  },
  {
    value: "medium",
    label: "Srednio kategorii",
    description:
      "Zrownowazony podzial. Dobre rozroznienie bez nadmiernej szczegolowosci.",
    icon: LayoutGrid,
    example: "5-8 kategorii",
  },
  {
    value: "high",
    label: "Duzo kategorii",
    description:
      "Szczegolowy podzial. Wychwytuje niuanse i mniejsze podtematy.",
    icon: Grid3X3,
    example: "8-12 kategorii",
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
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [encoderModels, setEncoderModels] = useState<string[]>([])

  useEffect(() => {
    listEncoders().then((res) => setEncoderModels(res.models ?? []))
  }, [])

  const updateConfig = (partial: Partial<ClusteringConfig>) => {
    onConfigChange({ ...config, ...partial })
  }

  const needsNumClusters = config.algorithm === "kmeans" || config.algorithm === "agglomerative"

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Jak szczegolowo grupowac?
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Wybierz poziom szczegolowosci dla Twoich{" "}
          <span className="font-medium text-foreground">{textCount}</span>{" "}
          dokumentow. Mozesz zawsze wrocic i zmienic ustawienia.
        </p>
      </div>

      <StepHelpBox title="Ktory poziom wybrac?">
        <ul className="list-disc space-y-1 pl-4">
          <li><strong>Malo kategorii</strong> — dobrze na poczatek, zeby zobaczyc ogolny obraz. Wystarczy gdy masz kilka glownych typow spraw.</li>
          <li><strong>Srednio</strong> — najczesciej najlepszy wybor. Laczy ogolnosc z przydatnymi szczegolami.</li>
          <li><strong>Duzo kategorii</strong> — gdy podejrzewasz, ze w danych kryja sie rzadkie, ale wazne tematy (np. nietypowe reklamacje).</li>
        </ul>
        <p className="mt-2">Jesli wyniki nie beda satysfakcjonujace, zawsze mozesz wrocic i zmienic ustawienia — embeddingi beda juz w cache, wiec reklasteryzacja bedzie szybka.</p>
      </StepHelpBox>

      {/* Granularity selection */}
      <div className="flex flex-col gap-3">
        {GRANULARITY_OPTIONS.map((opt) => {
          const Icon = opt.icon
          const selected = config.granularity === opt.value
          return (
            <div
              key={opt.value}
              className={cn(
                "glass-interactive flex cursor-pointer items-center gap-4 rounded-2xl p-5",
                selected && "border-primary/25 bg-primary/[0.06] glow-primary"
              )}
              onClick={() => updateConfig({ granularity: opt.value })}
              role="radio"
              aria-checked={selected}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  updateConfig({ granularity: opt.value })
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
                    {opt.example}
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

      {/* Advanced settings toggle */}
      <button
        type="button"
        className="glass-interactive flex items-center justify-between rounded-2xl px-5 py-4 text-left"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        <div className="flex items-center gap-3">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            Zaawansowane ustawienia
          </span>
        </div>
        {showAdvanced ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Advanced settings panel */}
      {showAdvanced && (
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
