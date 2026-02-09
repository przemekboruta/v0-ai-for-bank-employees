"use client"

import React from "react"
import { Clock } from "lucide-react"

import { useEffect, useState, useRef, useCallback } from "react"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import {
  Cpu,
  Sparkles,
  Binary,
  Network,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  ClusteringResult,
  ClusteringConfig,
  JobStatus,
  SavedJob,
} from "@/lib/clustering-types"
import {
  runClustering,
  saveJob,
  updateJob as updateJobStore,
  getJob,
} from "@/lib/api-client"

interface StepProcessingProps {
  texts: string[]
  config: ClusteringConfig
  iteration: number
  jobName: string
  onComplete: (result: ClusteringResult, jobId: string) => void
  onError: (message: string) => void
  onBackToDashboard: () => void
}

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "W kolejce...",
  embedding: "Generowanie embeddingów",
  reducing: "Redukcja wymiarów",
  clustering: "Klasteryzacja",
  labeling: "Analiza LLM -- etykiety i sugestie",
  completed: "Zakonczono",
  failed: "Blad",
  interrupted: "Przerwano",
}

const STATUS_DETAILS: Record<JobStatus, string> = {
  queued: "Zlecenie oczekuje na przetworzenie...",
  embedding: "Kodowanie tekstów modelem ModernBERT-base...",
  reducing: "Rzutowanie wektorów do przestrzeni o niższej wymiarowości...",
  clustering: "Wykrywanie naturalnych skupien dokumentów...",
  labeling: "Generowanie etykiet i sugestii usprawnien...",
  completed: "Pipeline zakonczony pomyslnie.",
  failed: "Wystapil blad podczas przetwarzania.",
  interrupted: "Przetwarzanie zostalo przerwane.",
}

const STATUS_ICONS: Record<JobStatus, React.ElementType> = {
  queued: Cpu,
  embedding: Binary,
  reducing: Network,
  clustering: Cpu,
  labeling: Sparkles,
  completed: CheckCircle2,
  failed: AlertTriangle,
  interrupted: Clock,
}

const STATUS_ORDER: JobStatus[] = [
  "queued",
  "embedding",
  "reducing",
  "clustering",
  "labeling",
  "completed",
]

export function StepProcessing({
  texts,
  config,
  iteration,
  jobName,
  onComplete,
  onError,
  onBackToDashboard,
}: StepProcessingProps) {
  const [status, setStatus] = useState<JobStatus>("queued")
  const [progress, setProgress] = useState(0)
  const [jobId, setJobId] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  // Guard against StrictMode double-invoke and multiple mounts
  const hasStartedRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    // Prevent double execution (React StrictMode calls effects twice)
    if (hasStartedRef.current) return
    hasStartedRef.current = true

    const abort = new AbortController()
    abortRef.current = abort

    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setJobId(id)

    // Save initial job entry
    const newJob: SavedJob = {
      jobId: id,
      name: jobName,
      status: "queued",
      progress: 0,
      textCount: texts.length,
      topicCount: null,
      config,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      result: null,
    }
    saveJob(newJob)
    setSubmitted(true)

    // Run mock pipeline stages
    const stages: { status: JobStatus; durationMs: number }[] = [
      {
        status: "embedding",
        durationMs: config.useCachedEmbeddings ? 400 : 1800,
      },
      {
        status: "reducing",
        durationMs: config.dimReduction === "none" ? 200 : 1200,
      },
      { status: "clustering", durationMs: 1400 },
      { status: "labeling", durationMs: 1600 },
    ]

    let elapsed = 0
    const totalDuration = stages.reduce((sum, s) => sum + s.durationMs, 0)

    async function runStages() {
      for (const stage of stages) {
        if (abort.signal.aborted) return
        setStatus(stage.status)
        updateJobStore(id, { status: stage.status })

        const startProgress = (elapsed / totalDuration) * 100
        const endProgress =
          ((elapsed + stage.durationMs) / totalDuration) * 100
        const steps = 40
        const stepMs = stage.durationMs / steps

        for (let i = 0; i <= steps; i++) {
          if (abort.signal.aborted) return
          await new Promise((r) => setTimeout(r, stepMs))
          const p = startProgress + ((endProgress - startProgress) * i) / steps
          const rounded = Math.min(p, 99)
          setProgress(rounded)
          updateJobStore(id, { progress: rounded })
        }
        elapsed += stage.durationMs
      }

      if (abort.signal.aborted) return

      try {
        const result = await runClustering(
          texts,
          config.granularity,
          iteration
        )
        if (abort.signal.aborted) return

        setStatus("completed")
        setProgress(100)
        updateJobStore(id, {
          status: "completed",
          progress: 100,
          result,
          topicCount: result.topics.length,
        })

        // Auto-transition if user is still on this screen
        setTimeout(() => {
          if (!abort.signal.aborted) onComplete(result, id)
        }, 800)
      } catch (err) {
        if (abort.signal.aborted) return
        const errMsg =
          err instanceof Error ? err.message : "Nieznany blad pipeline"
        setStatus("failed")
        updateJobStore(id, { status: "failed", error: errMsg })
        onError(errMsg)
      }
    }

    runStages()

    return () => {
      abort.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When user navigates away and back, and the pipeline finished while
  // they were on the dashboard, auto-complete immediately
  useEffect(() => {
    if (!jobId) return
    const saved = getJob(jobId)
    if (saved?.status === "completed" && saved.result) {
      setStatus("completed")
      setProgress(100)
      setTimeout(() => onComplete(saved.result!, jobId), 300)
    }
  }, [jobId, onComplete])

  const currentIdx = STATUS_ORDER.indexOf(status)
  const failed = status === "failed"
  const completed = status === "completed"

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-8 py-8">
      {/* Header */}
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {completed
            ? "Analiza zakonczona"
            : failed
              ? "Wystapil problem"
              : "Analizuje Twoje dokumenty"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {completed
            ? "Wyniki sa gotowe. Za chwile przejdziesz do przegladu."
            : failed
              ? "Sprobuj ponownie lub zmien parametry klasteryzacji."
              : "Mozesz wrocic do panelu i kontynuowac pozniej -- przetwarzanie jest kolejkowane w tle."}
        </p>
      </div>

      {/* Config summary pills */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-muted-foreground">
          {config.algorithm.toUpperCase()}
        </span>
        {config.dimReduction !== "none" && (
          <span className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-muted-foreground">
            {config.dimReduction.toUpperCase()} &rarr;{" "}
            {config.dimReductionTarget}D
          </span>
        )}
        {config.numClusters && (
          <span className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-muted-foreground">
            K={config.numClusters}
          </span>
        )}
        <span className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-muted-foreground">
          {texts.length} dok.
        </span>
        {config.useCachedEmbeddings && (
          <span className="rounded-full bg-accent/15 px-3 py-1 text-xs font-medium text-accent">
            cache embeddingów
          </span>
        )}
      </div>

      {/* Progress bar */}
      {!failed && (
        <div className="glass w-full rounded-2xl p-6">
          <Progress value={progress} className="h-1.5 bg-white/[0.06]" />
          <p className="mt-3 text-right text-xs font-medium text-primary">
            {Math.round(progress)}%
          </p>
        </div>
      )}

      {/* Pipeline stages */}
      <div className="flex w-full flex-col gap-3">
        {STATUS_ORDER.slice(0, -1).map((stageStatus, idx) => {
          const Icon = STATUS_ICONS[stageStatus]
          const isActive = stageStatus === status
          const isDone = currentIdx > idx
          const isFuture = currentIdx < idx

          if (
            stageStatus === "embedding" &&
            config.useCachedEmbeddings &&
            isDone
          ) {
            return (
              <div
                key={stageStatus}
                className="flex items-center gap-4 rounded-xl p-4 glass-subtle opacity-40"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-muted-foreground line-through">
                    {STATUS_LABELS[stageStatus]}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Pominieto -- uzyto cache
                  </p>
                </div>
                <span className="text-xs font-medium text-accent">Cache</span>
              </div>
            )
          }

          if (
            stageStatus === "reducing" &&
            config.dimReduction === "none" &&
            isDone
          ) {
            return (
              <div
                key={stageStatus}
                className="flex items-center gap-4 rounded-xl p-4 glass-subtle opacity-40"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-muted-foreground line-through">
                    {STATUS_LABELS[stageStatus]}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Pominieto -- brak redukcji
                  </p>
                </div>
              </div>
            )
          }

          return (
            <div
              key={stageStatus}
              className={cn(
                "flex items-center gap-4 rounded-xl p-4 transition-all duration-500",
                isActive && "glass border-primary/20 glow-primary",
                isDone && "glass-subtle opacity-50",
                isFuture &&
                  "bg-white/[0.02] border border-white/[0.04] opacity-25"
              )}
            >
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-500",
                  isActive && "bg-primary/20 text-primary",
                  isDone && "bg-accent/15 text-accent",
                  isFuture && "bg-white/[0.04] text-muted-foreground"
                )}
              >
                <Icon
                  className={cn("h-4 w-4", isActive && "animate-pulse")}
                />
              </div>
              <div className="flex-1">
                <p
                  className={cn(
                    "text-sm font-medium transition-colors duration-300",
                    isActive ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {STATUS_LABELS[stageStatus]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {STATUS_DETAILS[stageStatus]}
                </p>
              </div>
              {isDone && (
                <span className="text-xs font-medium text-accent">Gotowe</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Failed state */}
      {failed && (
        <div className="glass flex w-full flex-col items-center gap-4 rounded-2xl border-destructive/20 p-6">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <p className="text-center text-sm text-destructive">
            Przetwarzanie nie powiodlo sie. Sprobuj zmienic parametry i uruchom
            ponownie.
          </p>
        </div>
      )}

      {/* Action bar: go back to dashboard (non-blocking) */}
      {!completed && !failed && submitted && (
        <div className="glass w-full rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-foreground">
                Nie musisz czekac
              </p>
              <p className="text-xs text-muted-foreground">
                Wroc do panelu -- zlecenie bedzie kontynuowane w tle. Wyniki
                beda dostepne w liscie analiz.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={onBackToDashboard}
              className="shrink-0 gap-2 border-white/[0.1] bg-transparent text-muted-foreground hover:border-white/[0.2] hover:text-foreground hover:bg-white/[0.04]"
            >
              <ArrowLeft className="h-4 w-4" />
              Panel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
