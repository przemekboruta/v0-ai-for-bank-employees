"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import type {
  CategoryDefinition,
  ClassificationResult,
  TrainingJobInfo,
} from "@/lib/clustering-types"
import { submitTrainingJob, getTrainingStatus } from "@/lib/api-client"
import {
  Brain,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  BarChart3,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { StepHelpBox } from "@/components/wizard/step-help-box"

interface StepTrainingProps {
  categories: CategoryDefinition[]
  texts: string[]
  taxonomyId?: string
  onTrainingComplete: (result: ClassificationResult, modelId: string, jobId: string) => void
  onError: (message: string) => void
}

const STEP_LABELS: Record<string, string> = {
  queued: "Oczekiwanie w kolejce...",
  loading_model: "Ladowanie modelu encodera...",
  training: "Trening klasyfikatora SetFit...",
  predicting: "Klasyfikacja dokumentow...",
  completed: "Zakonczone!",
  failed: "Blad treningu",
}

export function StepTraining({
  categories,
  texts,
  taxonomyId,
  onTrainingComplete,
  onError,
}: StepTrainingProps) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<TrainingJobInfo | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [numIterations, setNumIterations] = useState(20)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  const totalExamples = categories.reduce((sum, c) => sum + c.examples.length, 0)

  const startTraining = useCallback(async () => {
    setIsStarting(true)
    try {
      const response = await submitTrainingJob({
        taxonomyId: taxonomyId || undefined,
        categories: taxonomyId ? undefined : categories,
        numIterations,
        texts: texts.length > 0 ? texts : undefined,
      })
      setJobId(response.jobId)
    } catch (error) {
      onError(error instanceof Error ? error.message : "Nie udalo sie uruchomic treningu")
    } finally {
      setIsStarting(false)
    }
  }, [categories, taxonomyId, numIterations, texts, onError])

  // Poll for job status
  useEffect(() => {
    if (!jobId) return

    const poll = async () => {
      try {
        const status = await getTrainingStatus(jobId)
        setJobStatus(status)

        if (status.status === "completed") {
          if (pollingRef.current) clearInterval(pollingRef.current)
          if (status.result && status.modelId) {
            onTrainingComplete(status.result, status.modelId, jobId)
          }
        } else if (status.status === "failed") {
          if (pollingRef.current) clearInterval(pollingRef.current)
          onError(status.error || "Trening zakonczyl sie bledem")
        }
      } catch (error) {
        console.error("Failed to poll training status:", error)
      }
    }

    poll()
    pollingRef.current = setInterval(poll, 2000)

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [jobId, onTrainingComplete, onError])

  const isTraining = jobId && jobStatus && !["completed", "failed"].includes(jobStatus.status)
  const isCompleted = jobStatus?.status === "completed"
  const isFailed = jobStatus?.status === "failed"

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 glow-primary">
          <Brain className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-display text-xl font-semibold text-foreground">
            Trening klasyfikatora
          </h2>
          <p className="text-sm text-muted-foreground">
            SetFit few-shot learning — trenuj klasyfikator na podstawie przykladow
          </p>
        </div>
      </div>

      <StepHelpBox title="Jak dziala trening?">
        <p>System uczy sie rozpoznawac Twoje kategorie na podstawie podanych przykladow (metoda <strong>few-shot learning</strong>). Wystarczy kilka-kilkanascie przykladow na kategorie.</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Trening trwa zwykle <strong>1-5 minut</strong> w zaleznosci od ilosci danych.</li>
          <li>Po treningu model automatycznie sklasyfikuje wszystkie wgrane dokumenty.</li>
          <li>Model zostanie zapisany — bedziesz mogl go uzyc na nowych danych bez ponownego treningu.</li>
        </ul>
      </StepHelpBox>

      {/* Pre-training summary */}
      {!jobId && (
        <div className="glass rounded-2xl border border-white/[0.1] p-6">
          <h3 className="mb-4 text-sm font-semibold text-foreground">
            Podsumowanie przed treningiem
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-xl bg-white/[0.04] p-4 text-center">
              <p className="text-2xl font-bold text-primary">{categories.length}</p>
              <p className="text-xs text-muted-foreground">Kategorii</p>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-4 text-center">
              <p className="text-2xl font-bold text-chart-2">{totalExamples}</p>
              <p className="text-xs text-muted-foreground">Przykladow</p>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-4 text-center">
              <p className="text-2xl font-bold text-chart-4">{texts.length}</p>
              <p className="text-xs text-muted-foreground">Dok. do klasyfikacji</p>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-4 text-center">
              <p className="text-2xl font-bold text-chart-3">{numIterations}</p>
              <p className="text-xs text-muted-foreground">Iteracji treningu</p>
            </div>
          </div>

          {/* Categories preview */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {categories.map((cat) => (
              <Badge
                key={cat.id}
                variant="secondary"
                className="border-0 bg-white/[0.06] text-xs text-muted-foreground"
              >
                {cat.name} ({cat.examples.length})
              </Badge>
            ))}
          </div>

          {/* Advanced options */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {advancedOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Zaawansowane
            </button>
            {advancedOpen && (
              <div className="mt-3 grid grid-cols-1 gap-4 rounded-lg bg-white/[0.04] p-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">
                    Liczba iteracji
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={numIterations}
                    onChange={(e) => setNumIterations(parseInt(e.target.value) || 20)}
                    className="w-full rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Wiecej iteracji = lepsze wyniki, ale dluzszy trening
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Start button */}
          <Button
            onClick={startTraining}
            disabled={isStarting || categories.length < 2 || totalExamples < 4}
            className="mt-6 gap-2 bg-primary/90 text-primary-foreground hover:bg-primary glow-primary"
          >
            {isStarting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uruchamianie...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Trenuj klasyfikator
              </>
            )}
          </Button>

          {categories.length < 2 && (
            <p className="mt-2 text-xs text-destructive">
              Wymagane minimum 2 kategorie
            </p>
          )}
          {categories.length >= 2 && totalExamples < 4 && (
            <p className="mt-2 text-xs text-destructive">
              Wymagane minimum 4 przyklady lacznie
            </p>
          )}
        </div>
      )}

      {/* Training progress */}
      {jobId && jobStatus && (
        <div className="glass rounded-2xl border border-white/[0.1] p-6">
          <div className="mb-4 flex items-center gap-3">
            {isTraining && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
            {isCompleted && <CheckCircle2 className="h-5 w-5 text-accent" />}
            {isFailed && <XCircle className="h-5 w-5 text-destructive" />}
            <h3 className="text-sm font-semibold text-foreground">
              {STEP_LABELS[jobStatus.status] || jobStatus.currentStep}
            </h3>
          </div>

          <Progress value={jobStatus.progress} className="mb-4" />

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Postep: {Math.round(jobStatus.progress)}%</span>
            {jobStatus.status !== "queued" && (
              <span>Status: {jobStatus.status}</span>
            )}
          </div>

          {/* Results after completion */}
          {isCompleted && jobStatus.accuracy != null && (
            <div className="mt-6">
              <div className="flex items-center gap-3 mb-4">
                <BarChart3 className="h-5 w-5 text-accent" />
                <h3 className="text-sm font-semibold text-foreground">Wyniki treningu</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-accent/10 p-4 text-center">
                  <p className="text-3xl font-bold text-accent">
                    {Math.round(jobStatus.accuracy * 100)}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {jobStatus.accuracyType === "validation"
                      ? "Dokladnosc (walidacja)"
                      : "Dokladnosc (trening)"}
                  </p>
                  {jobStatus.accuracyType === "training" && (
                    <p className="mt-1 text-[10px] text-yellow-500">
                      Za malo przykladow na walidacje — metryka moze byc zawyzona
                    </p>
                  )}
                </div>
                <div className="rounded-xl bg-white/[0.04] p-4 text-center">
                  <p className="text-3xl font-bold text-foreground">
                    {jobStatus.categoryCount}
                  </p>
                  <p className="text-xs text-muted-foreground">Kategorii</p>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {isFailed && jobStatus.error && (
            <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/[0.08] p-4">
              <p className="text-sm text-destructive">{jobStatus.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
