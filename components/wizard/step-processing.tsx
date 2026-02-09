"use client"

import React from "react"

import { useEffect, useState, useRef, useCallback } from "react"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Cpu, Sparkles, Binary, Network, AlertTriangle, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ClusteringResult, ClusteringConfig, JobStatus } from "@/lib/clustering-types"
import {
  submitClusteringJob,
  submitRecluster,
  getJobStatus,
  runClustering,
} from "@/lib/api-client"

interface StepProcessingProps {
  texts: string[]
  config: ClusteringConfig
  iteration: number
  onComplete: (result: ClusteringResult, jobId: string) => void
  onError: (message: string) => void
}

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "W kolejce...",
  embedding: "Generowanie embeddingów",
  reducing: "Redukcja wymiarów",
  clustering: "Klasteryzacja",
  labeling: "Analiza LLM -- etykiety i sugestie",
  completed: "Zakonczono",
  failed: "Blad",
}

const STATUS_DETAILS: Record<JobStatus, string> = {
  queued: "Zlecenie oczekuje na przetworzenie...",
  embedding: "Kodowanie tekstów modelem ModernBERT-base...",
  reducing: "Rzutowanie wektorów do przestrzeni o niższej wymiarowości...",
  clustering: "Wykrywanie naturalnych skupien dokumentów...",
  labeling: "Generowanie etykiet i sugestii usprawnień...",
  completed: "Pipeline zakonczony pomyslnie.",
  failed: "Wystapil blad podczas przetwarzania.",
}

const STATUS_ICONS: Record<JobStatus, React.ElementType> = {
  queued: Cpu,
  embedding: Binary,
  reducing: Network,
  clustering: Cpu,
  labeling: Sparkles,
  completed: Sparkles,
  failed: AlertTriangle,
}

const STATUS_ORDER: JobStatus[] = ["queued", "embedding", "reducing", "clustering", "labeling", "completed"]

/** Mock pipeline -- simulates job stages locally when no backend is connected */
function useMockPipeline(
  texts: string[],
  config: ClusteringConfig,
  iteration: number,
  onComplete: (result: ClusteringResult, jobId: string) => void,
  onError: (message: string) => void,
) {
  const [status, setStatus] = useState<JobStatus>("queued")
  const [progress, setProgress] = useState(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    const stages: { status: JobStatus; durationMs: number }[] = [
      { status: "embedding", durationMs: config.useCachedEmbeddings ? 400 : 1800 },
      { status: "reducing", durationMs: config.dimReduction === "none" ? 200 : 1200 },
      { status: "clustering", durationMs: 1400 },
      { status: "labeling", durationMs: 1600 },
    ]

    let elapsed = 0
    const totalDuration = stages.reduce((sum, s) => sum + s.durationMs, 0)

    async function runStages() {
      for (const stage of stages) {
        if (!mountedRef.current) return
        setStatus(stage.status)

        const startProgress = (elapsed / totalDuration) * 100
        const endProgress = ((elapsed + stage.durationMs) / totalDuration) * 100
        const steps = 50
        const stepMs = stage.durationMs / steps

        for (let i = 0; i <= steps; i++) {
          if (!mountedRef.current) return
          await new Promise((r) => setTimeout(r, stepMs))
          const p = startProgress + ((endProgress - startProgress) * i) / steps
          setProgress(Math.min(p, 99))
        }

        elapsed += stage.durationMs
      }

      if (!mountedRef.current) return

      try {
        const result = await runClustering(texts, config.granularity, iteration)
        if (!mountedRef.current) return
        setStatus("completed")
        setProgress(100)
        const mockJobId = `mock-${Date.now()}`
        setTimeout(() => {
          if (mountedRef.current) onComplete(result, mockJobId)
        }, 600)
      } catch (err) {
        if (!mountedRef.current) return
        setStatus("failed")
        onError(err instanceof Error ? err.message : "Nieznany blad pipeline")
      }
    }

    runStages()

    return () => {
      mountedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { status, progress }
}

/** Real pipeline -- submits job and polls status from the backend */
function useRealPipeline(
  texts: string[],
  config: ClusteringConfig,
  iteration: number,
  onComplete: (result: ClusteringResult, jobId: string) => void,
  onError: (message: string) => void,
) {
  const [status, setStatus] = useState<JobStatus>("queued")
  const [progress, setProgress] = useState(0)
  const mountedRef = useRef(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    mountedRef.current = true

    async function startJob() {
      try {
        let jobId: string

        if (config.useCachedEmbeddings && config.cachedJobId) {
          const res = await submitRecluster(config.cachedJobId, config)
          jobId = res.jobId
        } else {
          const res = await submitClusteringJob(texts, config, iteration)
          jobId = res.jobId
        }

        // Poll every 1.5s
        pollRef.current = setInterval(async () => {
          if (!mountedRef.current) return

          try {
            const jobStatus = await getJobStatus(jobId)

            setStatus(jobStatus.status)
            setProgress(jobStatus.progress)

            if (jobStatus.status === "completed" && jobStatus.result) {
              if (pollRef.current) clearInterval(pollRef.current)
              onComplete(jobStatus.result, jobId)
            }

            if (jobStatus.status === "failed") {
              if (pollRef.current) clearInterval(pollRef.current)
              onError(jobStatus.error ?? "Nieznany blad pipeline")
            }
          } catch {
            // Polling error -- retry silently
          }
        }, 1500)
      } catch (err) {
        if (!mountedRef.current) return
        setStatus("failed")
        onError(err instanceof Error ? err.message : "Nie udalo sie zlecic zadania")
      }
    }

    startJob()

    return () => {
      mountedRef.current = false
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { status, progress }
}

export function StepProcessing({
  texts,
  config,
  iteration,
  onComplete,
  onError,
}: StepProcessingProps) {
  // In v0 preview (no backend) we always use mock pipeline.
  // With a backend, the api-client functions will talk to real endpoints.
  // We detect this by trying the real path first -- if it fails with a network
  // error or 404 on /api/cluster/job, the mock takes over.
  // For simplicity, we use mock pipeline always here (the proxy handles the real backend).
  const { status, progress } = useMockPipeline(texts, config, iteration, onComplete, onError)

  const currentIdx = STATUS_ORDER.indexOf(status)
  const failed = status === "failed"

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-8 py-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {failed ? "Wystapil problem" : "Analizuje Twoje dokumenty"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {failed
            ? "Sprobuj ponownie lub zmien parametry klasteryzacji."
            : config.useCachedEmbeddings
              ? "Uzywam zapisanych embeddingów -- to bedzie szybsze."
              : "Pipeline ML przetwarza dane. Nie zamykaj okna."}
        </p>
      </div>

      {/* Config summary pills */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-muted-foreground">
          {config.algorithm.toUpperCase()}
        </span>
        {config.dimReduction !== "none" && (
          <span className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-muted-foreground">
            {config.dimReduction.toUpperCase()} &rarr; {config.dimReductionTarget}D
          </span>
        )}
        {config.numClusters && (
          <span className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-muted-foreground">
            K={config.numClusters}
          </span>
        )}
        <span className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-muted-foreground">
          min {config.minClusterSize} dok./klaster
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

          // Skip embedding stage visually if using cache
          if (stageStatus === "embedding" && config.useCachedEmbeddings && isDone) {
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
                  <p className="text-xs text-muted-foreground">Pominieto -- uzyto cache</p>
                </div>
                <span className="text-xs font-medium text-accent">Cache</span>
              </div>
            )
          }

          // Skip dim reduction if "none"
          if (stageStatus === "reducing" && config.dimReduction === "none" && isDone) {
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
                  <p className="text-xs text-muted-foreground">Pominieto -- brak redukcji</p>
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
                isFuture && "bg-white/[0.02] border border-white/[0.04] opacity-25"
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
                <Icon className={cn("h-4 w-4", isActive && "animate-pulse")} />
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
                <p className="text-xs text-muted-foreground">{STATUS_DETAILS[stageStatus]}</p>
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
            Przetwarzanie nie powiodlo sie. Sprobuj zmienic parametry i uruchom ponownie.
          </p>
        </div>
      )}
    </div>
  )
}
